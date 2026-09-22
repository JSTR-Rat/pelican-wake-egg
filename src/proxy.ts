import net, { type Socket } from "node:net";

export type ProxyBackendSettings = {
  host: string;
  port: number;
  connectTimeoutMs: number;
};

export type ProxyController = {
  requestReconciliation: () => void;
};

export const proxyToBackend = (
  client: Socket,
  connectionId: number,
  backendSettings: ProxyBackendSettings,
  controller: ProxyController,
): void => {
  const startedAt = Date.now();
  const backend = net.createConnection({
    host: backendSettings.host,
    port: backendSettings.port,
  });
  let connected = false;
  let settled = false;
  let clientClosed = false;
  let backendHadError = false;
  let clientBytes = 0;
  let backendBytes = 0;
  let loggedClosed = false;

  const logClosed = (): void => {
    if (loggedClosed) {
      return;
    }

    loggedClosed = true;
    console.log(
      `[proxy][conn=${connectionId}] closed lifetime=${Date.now() - startedAt}ms ` +
      `c2s=${clientBytes} s2c=${backendBytes}`,
    );
  };

  const forwardingFailure = (error: unknown): void => {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(connectTimer);
    console.error(
      `[proxy][conn=${connectionId}] backend forwarding failed: ` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
    client.destroy();
    backend.destroy();
    controller.requestReconciliation();
  };

  const connectTimer = setTimeout(() => {
    if (!connected) {
      forwardingFailure(new Error("backend connection timed out"));
    }
  }, backendSettings.connectTimeoutMs);

  client.on("data", (chunk) => {
    clientBytes += chunk.length;
  });
  backend.on("data", (chunk) => {
    backendBytes += chunk.length;
  });

  console.log(
    `[proxy][conn=${connectionId}] connecting backend=${backendSettings.host}:${backendSettings.port}`,
  );

  backend.once("connect", () => {
    if (settled) {
      backend.destroy();
      return;
    }

    connected = true;
    clearTimeout(connectTimer);
    console.log(
      `[proxy][conn=${connectionId}] backend connected after ${Date.now() - startedAt}ms`,
    );
    client.pipe(backend);
    backend.pipe(client);
    client.resume();
  });

  backend.once("error", (error) => {
    backendHadError = true;
    if (!connected) {
      forwardingFailure(error);
      return;
    }

    console.error(`[proxy][conn=${connectionId}] backend error: ${error.message}`);
    settled = true;
    client.destroy();
  });

  client.once("error", (error) => {
    console.error(`[proxy][conn=${connectionId}] client error: ${error.message}`);
  });
  client.once("end", () => {
    console.log(`[proxy][conn=${connectionId}] client ended`);
  });
  backend.once("end", () => {
    console.log(`[proxy][conn=${connectionId}] backend ended`);
  });

  client.once("close", () => {
    clientClosed = true;
    clearTimeout(connectTimer);
    settled = true;
    backend.destroy();
    logClosed();
  });
  backend.once("close", () => {
    clearTimeout(connectTimer);
    console.log(
      `[proxy][conn=${connectionId}] backend closed hadError=${backendHadError}`,
    );

    if (!connected && !settled) {
      forwardingFailure(new Error("backend connection closed before connect"));
      return;
    }

    settled = true;
    if (!clientClosed && !client.destroyed) {
      client.destroy();
    }
    logClosed();
  });
};
