import WebSocket from "ws";

import type { PlayerProviderConfig } from "./config.js";
import type { Player, PlayerDirectory } from "./types.js";

type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: JsonRpcError;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsePlayers = (value: unknown): Player[] => {
  if (!Array.isArray(value)) {
    throw new Error("Minecraft management result was not a player array");
  }

  return value.map((player, index) => {
    if (!isObject(player) || typeof player.id !== "string" || typeof player.name !== "string") {
      throw new Error(`Minecraft management player ${index} was invalid`);
    }

    return { id: player.id, name: player.name };
  });
};

const parseResponse = (value: unknown, id: number): JsonRpcResponse => {
  if (!isObject(value) || value.jsonrpc !== "2.0" || value.id !== id) {
    throw new Error("Minecraft management response was invalid");
  }

  if (value.error !== undefined) {
    if (!isObject(value.error) || typeof value.error.code !== "number" || typeof value.error.message !== "string") {
      throw new Error("Minecraft management error response was invalid");
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: value.error.code,
        message: value.error.message,
        ...(value.error.data !== undefined ? { data: value.error.data } : {}),
      },
    };
  }

  if (!("result" in value)) {
    throw new Error("Minecraft management response had no result");
  }

  return { jsonrpc: "2.0", id, result: value.result };
};

export class ManagementPlayerDirectory implements PlayerDirectory {
  public constructor(private readonly settings: Extract<PlayerProviderConfig, { type: "management" }>) {}

  public async getPlayers(signal?: AbortSignal): Promise<readonly Player[]> {
  const id = Date.now();

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://${this.settings.host}:${this.settings.port}`,
      {
        headers: {
          Authorization: `Bearer ${this.settings.secret}`,
        },
        handshakeTimeout: this.settings.connectTimeoutMs,
      },
    );
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("Minecraft management request timed out")), this.settings.requestTimeoutMs);

    const finish = (error?: unknown, players?: readonly Player[]): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      socket.removeAllListeners();

      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }

      if (error !== undefined) {
        const failure = error instanceof Error ? error : new Error(String(error));
        console.error(`[management] player query failed: ${failure.message}`);
        reject(failure);
      } else {
        if (players === undefined) {
          reject(new Error("Minecraft management query returned no players"));
        } else {
          console.log(`[management] queried ${players.length} player(s)`);
          resolve(players);
        }
      }
    };

    const abort = (): void => finish(new Error("Minecraft management request was cancelled"));

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener("abort", abort, { once: true });

    socket.once("open", () => {
      socket.send(JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "minecraft:players",
      }));
    });

    socket.on("message", (data) => {
      try {
        const response = parseResponse(JSON.parse(data.toString()) as unknown, id);

        if (response.error) {
          throw new Error(
            `Minecraft management error ${response.error.code}: ${response.error.message}`,
          );
        }

        finish(undefined, parsePlayers(response.result));
      } catch (error: unknown) {
        finish(error);
      }
    });

    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled) {
        finish(new Error("Minecraft management socket closed before response"));
      }
    });
  });
  }
}
