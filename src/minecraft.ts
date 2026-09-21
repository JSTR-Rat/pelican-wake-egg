import net, { type Socket } from "node:net";

import { config } from "./config.js";
import type { MinecraftStatus } from "./types.js";

export enum ClientIntent {
  Status = 1,
  Login = 2,
  Transfer = 3,
}

export type Handshake = {
  protocolVersion: number;
  host: string;
  port: number;
  intent: ClientIntent;
};

export type MinecraftPacket = {
  id: number;
  payload: Buffer<ArrayBufferLike>;
};

export const readVarInt = (
  buffer: Buffer<ArrayBufferLike>,
  offset = 0,
): { value: number; bytesRead: number } | null => {
  let value = 0;
  let position = 0;

  while (position < 5) {
    const index = offset + position;

    if (index >= buffer.length) {
      return null;
    }

    const byte = buffer[index];

    if (byte === undefined) {
      return null;
    }

    value |= (byte & 0x7f) << (7 * position);
    position++;

    if ((byte & 0x80) === 0) {
      return {
        value,
        bytesRead: position,
      };
    }
  }

  throw new Error("VarInt is too large");
};

export const writeVarInt = (value: number): Buffer<ArrayBufferLike> => {
  const bytes: number[] = [];
  let remaining = value >>> 0;

  do {
    let byte = remaining & 0x7f;
    remaining >>>= 7;

    if (remaining !== 0) {
      byte |= 0x80;
    }

    bytes.push(byte);
  } while (remaining !== 0);

  return Buffer.from(bytes);
};

export class PacketBuffer {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  public constructor(
    private readonly maxPacketSize = 2 * 1024 * 1024,
    private readonly maxBufferSize = 4 * 1024 * 1024,
  ) {}

  public append(data: Buffer<ArrayBufferLike>): void {
    if (this.buffer.length + data.length > this.maxBufferSize) {
      throw new Error("Minecraft packet buffer is too large");
    }

    this.buffer = Buffer.concat([this.buffer, data]);
  }

  public readPacket(): MinecraftPacket | null {
    const packetLength = readVarInt(this.buffer);

    if (!packetLength) {
      return null;
    }

    if (packetLength.value > this.maxPacketSize) {
      throw new Error("Minecraft packet is too large");
    }

    const packetStart = packetLength.bytesRead;
    const packetEnd = packetStart + packetLength.value;

    if (this.buffer.length < packetEnd) {
      return null;
    }

    const packetId = readVarInt(this.buffer, packetStart);

    if (!packetId) {
      throw new Error("Minecraft packet has no packet ID");
    }

    const payloadStart = packetStart + packetId.bytesRead;
    const payload = this.buffer.subarray(payloadStart, packetEnd);

    this.buffer = this.buffer.subarray(packetEnd);

    return {
      id: packetId.value,
      payload,
    };
  }
}

const readString = (
  buffer: Buffer<ArrayBufferLike>,
  offset: number,
): { value: string; bytesRead: number } | null => {
  const length = readVarInt(buffer, offset);

  if (!length) {
    return null;
  }

  const start = offset + length.bytesRead;
  const end = start + length.value;

  if (buffer.length < end) {
    return null;
  }

  return {
    value: buffer.toString("utf8", start, end),
    bytesRead: length.bytesRead + length.value,
  };
};

const writeString = (value: string): Buffer<ArrayBufferLike> => {
  const data = Buffer.from(value, "utf8");

  return Buffer.concat([
    writeVarInt(data.length),
    data,
  ]);
};

export const parseHandshakePacket = (
  packet: MinecraftPacket,
): Handshake => {
  if (packet.id !== 0x00) {
    throw new Error(`Expected handshake packet 0x00, got ${packet.id}`);
  }

  let offset = 0;
  const payload = packet.payload;

  const protocolVersion = readVarInt(payload, offset);

  if (!protocolVersion) {
    throw new Error("Handshake has no protocol version");
  }

  offset += protocolVersion.bytesRead;

  const host = readString(payload, offset);

  if (!host) {
    throw new Error("Handshake has no host");
  }

  offset += host.bytesRead;

  if (payload.length < offset + 2) {
    throw new Error("Handshake has no server port");
  }

  const port = payload.readUInt16BE(offset);
  offset += 2;

  const intent = readVarInt(payload, offset);

  if (!intent) {
    throw new Error("Handshake has no intent");
  }

  return {
    protocolVersion: protocolVersion.value,
    host: host.value,
    port,
    intent: intent.value as ClientIntent,
  };
};

export const parseHandshake = (buffer: Buffer<ArrayBufferLike>): Handshake | null => {
  const packets = new PacketBuffer();
  packets.append(buffer);
  const packet = packets.readPacket();

  return packet ? parseHandshakePacket(packet) : null;
};

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Minecraft status response is not an object");
  }

  return value as Record<string, unknown>;
};

const parseStatus = (value: unknown): MinecraftStatus => {
  const object = parseJsonObject(value);
  const version = parseJsonObject(object.version);
  const players = parseJsonObject(object.players);

  if (
    typeof version.name !== "string" ||
    typeof version.protocol !== "number" ||
    typeof players.online !== "number" ||
    typeof players.max !== "number" ||
    !("description" in object)
  ) {
    throw new Error("Minecraft status response has an invalid shape");
  }

  return {
    version: {
      name: version.name,
      protocol: version.protocol,
    },
    players: {
      online: players.online,
      max: players.max,
    },
    description: object.description,
    ...(typeof object.favicon === "string"
      ? { favicon: object.favicon }
      : {}),
  };
};

const createStatusHandshake = (): Buffer<ArrayBufferLike> => {
  const payload = Buffer.concat([
    writeVarInt(config.minecraft.protocolVersion),
    writeString(config.backend.host),
    Buffer.from([(config.backend.port >> 8) & 0xff, config.backend.port & 0xff]),
    writeVarInt(ClientIntent.Status),
  ]);

  return createPacket(0x00, payload);
};

const createStatusRequest = (): Buffer<ArrayBufferLike> => createPacket(0x00);

export const queryMinecraftStatus = (
  signal?: AbortSignal,
): Promise<MinecraftStatus> => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: config.backend.host,
      port: config.backend.port,
    });
    const packets = new PacketBuffer();
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (error?: unknown, status?: MinecraftStatus): void => {
      if (settled) {
        return;
      }

      settled = true;

      if (timer) {
        clearTimeout(timer);
      }

      signal?.removeEventListener("abort", abort);
      socket.destroy();

      if (error !== undefined) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else if (status) {
        resolve(status);
      } else {
        reject(new Error("Minecraft status query returned no status"));
      }
    };

    const abort = (): void => {
      finish(new Error("Minecraft status query was cancelled"));
    };

    timer = setTimeout(() => {
      finish(new Error("Minecraft status query timed out"));
    }, config.backend.connectTimeoutMs);

    if (signal?.aborted) {
      abort();
      return;
    }

    signal?.addEventListener("abort", abort, { once: true });

    socket.on("connect", () => {
      socket.write(createStatusHandshake());
      socket.write(createStatusRequest());
    });

    socket.on("data", (data: Buffer) => {
      try {
        packets.append(data);

        let packet = packets.readPacket();

        while (packet) {
          if (packet.id !== 0x00) {
            throw new Error(`Expected Minecraft status response, got ${packet.id}`);
          }

          const length = readVarInt(packet.payload);

          if (!length || packet.payload.length < length.bytesRead + length.value) {
            throw new Error("Minecraft status response has invalid JSON payload");
          }

          const json = packet.payload.toString(
            "utf8",
            length.bytesRead,
            length.bytesRead + length.value,
          );

          finish(undefined, parseStatus(JSON.parse(json) as unknown));
          return;
        }
      } catch (error: unknown) {
        finish(error);
      }
    });

    socket.once("timeout", () => {
      finish(new Error("Minecraft status connection timed out"));
    });
    socket.setTimeout(config.backend.connectTimeoutMs);
    socket.once("error", (error) => finish(error));
    socket.once("close", () => {
      if (!settled) {
        finish(new Error("Minecraft status connection closed"));
      }
    });
  });
};

const createPacket = (
  packetId: number,
  payload: Buffer<ArrayBufferLike> = Buffer.alloc(0),
): Buffer<ArrayBufferLike> => {
  const packetIdBuffer = writeVarInt(packetId);

  const body = Buffer.concat([
    packetIdBuffer,
    payload,
  ]);

  return Buffer.concat([
    writeVarInt(body.length),
    body,
  ]);
};

export const createStatusPacket = (
  description: string,
  versionName: string,
  protocolVersion: number,
): Buffer<ArrayBufferLike> => {
  const response = JSON.stringify({
    version: {
      name: versionName,
      protocol: protocolVersion,
    },

    players: {
      max: 10,
      online: 0,
    },

    description: {
      text: description,
    },
  });

  return createPacket(
    0x00,
    writeString(response),
  );
};

export const sendStatus = (socket: Socket, description: string): void => {
  socket.write(createStatusPacket(
    description,
    config.minecraft.versionName,
    config.minecraft.protocolVersion,
  ));
};

export const sendLoginDisconnect = (
  socket: Socket,
  component: unknown,
): void => {
  socket.end(
    createPacket(
      0x00,
      writeString(JSON.stringify(component)),
    ),
  );
};

export const sendPong = (
  socket: Socket,
  payload: Buffer<ArrayBufferLike>,
): void => {
  socket.write(
    createPacket(
      0x01,
      payload,
    ),
  );
};
