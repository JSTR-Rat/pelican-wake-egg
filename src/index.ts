import net, { type Server, type Socket } from "node:net";

import { BackendController } from "./backend-controller.js";
import { config } from "./config.js";
import { IdleMonitor } from "./idle-monitor.js";
import {
  ClientIntent,
  PacketBuffer,
  parseHandshakePacket,
  queryMinecraftStatus,
  sendLoginDisconnect,
  sendPong,
  sendStatus,
} from "./minecraft.js";
import { ManagementPlayerDirectory } from "./minecraft-management.js";
import { RconPlayerDirectory } from "./rcon.js";
import { pelicanClient } from "./pelican.js";
import type { BackendState } from "./types.js";

const playerDirectory = config.playerProvider.type === "management"
  ? new ManagementPlayerDirectory(config.playerProvider)
  : new RconPlayerDirectory(config.playerProvider);

const controller = new BackendController(
  { queryStatus: queryMinecraftStatus },
  pelicanClient,
);
const idleMonitor = new IdleMonitor(controller, playerDirectory);
const clients = new Set<Socket>();

const stateDescription = (state: BackendState): string => {
  switch (state) {
    case "starting":
      return "⏳ Server starting — please wait";
    case "stopping":
      return "🛑 Server stopping — please wait";
    case "online":
      return "";
    case "offline":
      return "💤 Server sleeping — connect to wake";
  }
};

const disconnectMessage = (state: BackendState): unknown => {
  switch (state) {
    case "offline":
      return {
        text: "Waking server...\n",
        color: "yellow",
        extra: [{ text: "Please try connecting again shortly.", color: "gray" }],
      };
    case "starting":
      return {
        text: "Server is starting...\n",
        color: "yellow",
        extra: [{ text: "Please try connecting again shortly.", color: "gray" }],
      };
    case "stopping":
      return {
        text: "Server is stopping...\n",
        color: "red",
        extra: [{ text: "Please try connecting again shortly.", color: "gray" }],
      };
    case "online":
      return { text: "Unable to connect to the server." };
  }
};

const proxyToBackend = (client: Socket): void => {
  const backend = net.createConnection({
    host: config.backend.host,
    port: config.backend.port,
  });
  let connected = false;
  let settled = false;
  let clientClosed = false;
  let clientEnded = false;

  backend.setTimeout(config.backend.connectTimeoutMs);

  const forwardingFailure = (error: unknown): void => {
    if (settled) {
      return;
    }

    settled = true;
    console.error(
      `[proxy] backend forwarding failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    client.destroy();
    backend.destroy();
    controller.requestReconciliation();
  };

  backend.once("connect", () => {
    connected = true;
    console.log(`[proxy] forwarding to backend ${config.backend.host}:${config.backend.port}`);
    client.pipe(backend);
    backend.pipe(client);
    client.resume();
  });

  backend.once("timeout", () => forwardingFailure(new Error("backend connection timed out")));
  backend.once("error", forwardingFailure);
  client.once("error", (error) => console.error(`[proxy] client error: ${error.message}`));
  client.once("close", () => {
    clientClosed = true;
    backend.destroy();
  });
  client.once("end", () => {
    clientEnded = true;
  });
  backend.once("close", () => {
    if (!connected && !settled) {
      forwardingFailure(new Error("backend connection closed before connect"));
    } else if (!clientClosed && !clientEnded && !client.destroyed && !settled) {
      forwardingFailure(new Error("backend connection closed unexpectedly"));
    } else if (!client.destroyed) {
      client.destroy();
    }
  });
};

const handleLocalConnection = (client: Socket): void => {
  const packets = new PacketBuffer();
  let handshake: ReturnType<typeof parseHandshakePacket> | null = null;
  let statusSent = false;
  const handshakeTimeout = setTimeout(() => client.destroy(), config.backend.connectTimeoutMs);

  client.on("data", (chunk) => {
    try {
      packets.append(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));

      let packet = packets.readPacket();
      while (packet) {
        if (!handshake) {
          handshake = parseHandshakePacket(packet);
          clearTimeout(handshakeTimeout);

          console.log(
            `[proxy] handshake protocol=${handshake.protocolVersion} ` +
            `host=${handshake.host}:${handshake.port} intent=${handshake.intent}`,
          );

          if (handshake.intent === ClientIntent.Login) {
            const state = controller.getState();

            if (state === "offline") {
              void controller.ensureStarting().catch((error: unknown) => {
                console.error("[proxy] failed to start backend:", error);
              });
            }

            sendLoginDisconnect(client, disconnectMessage(state));
            return;
          }

          if (handshake.intent !== ClientIntent.Status) {
            client.destroy();
            return;
          }

          const state = controller.getState();
          if (state === "online") {
            client.destroy();
            return;
          }

          sendStatus(client, stateDescription(state));
          statusSent = true;
        } else if (statusSent && packet.id === 0x01) {
          if (packet.payload.length < 8) {
            throw new Error("Minecraft ping payload was incomplete");
          }

          sendPong(client, packet.payload.subarray(0, 8));
          client.end();
          return;
        }

        packet = packets.readPacket();
      }
    } catch (error: unknown) {
      console.error("[proxy] invalid local Minecraft packet:", error);
      client.destroy();
    }
  });

  client.once("error", (error) => {
    console.error(`[proxy] local client error: ${error.message}`);
  });
  client.once("close", () => clearTimeout(handshakeTimeout));
};

const server: Server = net.createServer((client) => {
  clients.add(client);
  client.pause();

  client.once("close", () => clients.delete(client));

  if (controller.isForwardingAllowed()) {
    proxyToBackend(client);
  } else {
    handleLocalConnection(client);
    client.resume();
  }
});

server.on("error", (error) => {
  console.error("[proxy] server error:", error);
  process.exitCode = 1;
});

let reconciliationTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

const scheduleReconciliation = (): void => {
  if (shuttingDown) {
    return;
  }

  reconciliationTimer = setTimeout(() => {
    reconciliationTimer = null;
    void controller.reconcile().catch((error: unknown) => {
      console.error("[state] periodic reconciliation failed:", error);
    }).then(scheduleReconciliation, scheduleReconciliation);
  }, config.idle.checkIntervalMs);
};

const shutdown = (): void => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log("[proxy] shutting down");

  if (reconciliationTimer) {
    clearTimeout(reconciliationTimer);
    reconciliationTimer = null;
  }

  idleMonitor.stop();
  server.close();

  for (const client of clients) {
    client.destroy();
  }
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

const start = async (): Promise<void> => {
  await controller.initialize();

  server.listen(config.proxy.port, config.proxy.host, () => {
    console.log(`[proxy] listening on ${config.proxy.host}:${config.proxy.port}`);
    console.log(`[proxy] backend ${config.backend.host}:${config.backend.port}`);
  });

  idleMonitor.start();
  scheduleReconciliation();
};

void start().catch((error: unknown) => {
  console.error("[proxy] startup failed:", error);
  process.exitCode = 1;
});
