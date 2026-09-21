import net from "node:net";

import type { PlayerProviderConfig } from "./config.js";
import type { Player, PlayerDirectory } from "./types.js";

const SERVERDATA_RESPONSE_VALUE = 0;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_AUTH = 3;

const packet = (id: number, type: number, body: string): Buffer => {
  const payload = Buffer.from(body, "utf8");
  const data = Buffer.alloc(14 + payload.length);
  data.writeInt32LE(payload.length + 10, 0);
  data.writeInt32LE(id, 4);
  data.writeInt32LE(type, 8);
  payload.copy(data, 12);
  data.writeInt16LE(0, 12 + payload.length);
  return data;
};

const readPacket = (buffer: Buffer): { id: number; type: number; body: string; remaining: Buffer } | null => {
  if (buffer.length < 4) {
    return null;
  }

  const length = buffer.readInt32LE(0);
  if (length < 10 || length > 4 * 1024 * 1024 || buffer.length < length + 4) {
    return null;
  }

  const end = length + 4;
  return {
    id: buffer.readInt32LE(4),
    type: buffer.readInt32LE(8),
    body: buffer.toString("utf8", 12, end - 2),
    remaining: buffer.subarray(end),
  };
};

export const parseRconPlayers = (response: string): Player[] => {
  const match = /^\s*There are (\d+) of a max of (\d+) players online:\s*(.*?)\s*$/i.exec(response);
  if (!match) {
    throw new Error("RCON list response had an unrecognized format");
  }

  const count = Number(match[1]);
  const namesText = match[3];
  if (!Number.isInteger(count) || count < 0 || namesText === undefined) {
    throw new Error("RCON list response had an invalid player count");
  }

  const names = namesText === "" ? [] : namesText.split(",").map((name) => name.trim());
  if (names.some((name) => name.length === 0) || names.length !== count) {
    throw new Error("RCON list response player count did not match player names");
  }

  return names.map((name) => ({ name }));
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export class RconPlayerDirectory implements PlayerDirectory {
  public constructor(private readonly settings: Extract<PlayerProviderConfig, { type: "rcon" }>) {}

  public getPlayers(signal?: AbortSignal): Promise<readonly Player[]> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.settings.host, port: this.settings.port });
      let settled = false;
      let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      let phase: "auth" | "command" = "auth";
      const authId = 1;
      const commandId = 2;

      const finish = (error?: unknown, players?: readonly Player[]): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        socket.destroy();

        if (error !== undefined) {
          const failure = asError(error);
          console.error(`[rcon] player query failed: ${failure.message}`);
          reject(failure);
        } else if (players === undefined) {
          reject(new Error("RCON query returned no players"));
        } else {
          console.log(`[rcon] queried ${players.length} player(s)`);
          resolve(players);
        }
      };

      const abort = (): void => finish(new Error("RCON player query was cancelled"));
      const timer = setTimeout(
        () => finish(new Error("RCON request timed out")),
        this.settings.requestTimeoutMs,
      );

      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });

      socket.setTimeout(this.settings.connectTimeoutMs);
      socket.once("connect", () => {
        socket.setTimeout(0);
        socket.write(packet(authId, SERVERDATA_AUTH, this.settings.password));
      });
      socket.on("timeout", () => finish(new Error("RCON connection timed out")));
      socket.on("error", (error) => finish(error));
      socket.on("close", () => {
        if (!settled) {
          finish(new Error("RCON connection closed before response"));
        }
      });
      socket.on("data", (data: Buffer) => {
        try {
          buffer = Buffer.concat([buffer, data]);
          let current = readPacket(buffer);
          while (current) {
            buffer = current.remaining;
            if (phase === "auth") {
              if (current.id === -1) {
                throw new Error("RCON authentication failed");
              }
              if (current.id !== authId) {
                throw new Error("RCON authentication response was invalid");
              }
              phase = "command";
              socket.write(packet(commandId, SERVERDATA_EXECCOMMAND, "list"));
            } else {
              if (current.id !== commandId || current.type !== SERVERDATA_RESPONSE_VALUE) {
                throw new Error("RCON command response was invalid");
              }
              finish(undefined, parseRconPlayers(current.body));
              return;
            }
            current = readPacket(buffer);
          }
        } catch (error: unknown) {
          finish(error);
        }
      });
    });
  }
}
