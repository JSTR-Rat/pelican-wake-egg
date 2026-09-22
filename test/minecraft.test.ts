import { strict as assert } from "node:assert";
import net from "node:net";
import { test } from "node:test";

process.env.PELICAN_BASE_URL = "http://127.0.0.1:8080";
process.env.PELICAN_API_KEY = "test-key";
process.env.PELICAN_SERVER_ID = "test-server";
process.env.MINECRAFT_VERSION_NAME = "26.3";
process.env.MINECRAFT_PROTOCOL_VERSION = "777";
process.env.BACKEND_HOST = "127.0.0.1";
process.env.MANAGEMENT_HOST = "127.0.0.1";
process.env.MANAGEMENT_PORT = "25585";
process.env.MANAGEMENT_SECRET = "test-secret";

const { PacketBuffer, createStatusPacket, queryMinecraftStatus, writeVarInt } = await import("../src/minecraft.js");

const packet = (id: number, payload: Buffer): Buffer => {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
};

test("PacketBuffer preserves fragmented packets", () => {
  const buffer = new PacketBuffer();
  const value = packet(0x01, Buffer.from([1, 2, 3]));

  buffer.append(value.subarray(0, 1));
  assert.equal(buffer.readPacket(), null);
  buffer.append(value.subarray(1));

  assert.deepEqual(buffer.readPacket(), {
    id: 0x01,
    payload: Buffer.from([1, 2, 3]),
  });
});

test("PacketBuffer extracts coalesced packets", () => {
  const buffer = new PacketBuffer();
  buffer.append(Buffer.concat([
    packet(0x00, Buffer.from([1])),
    packet(0x01, Buffer.from([2, 3])),
  ]));

  assert.deepEqual(buffer.readPacket(), {
    id: 0x00,
    payload: Buffer.from([1]),
  });
  assert.deepEqual(buffer.readPacket(), {
    id: 0x01,
    payload: Buffer.from([2, 3]),
  });
  assert.equal(buffer.readPacket(), null);
});

test("locally generated status uses the configured Minecraft version", () => {
  for (const [name, protocol] of [["26.3", 777], ["1.20.1", 763]] as const) {
    const packets = new PacketBuffer();
    packets.append(createStatusPacket("sleeping", name, protocol));
    const status = packets.readPacket();
    assert.ok(status);
    const length = (() => {
      const value = status.payload[0];
      assert.notEqual(value, undefined);
      return value;
    })();
    const json = status.payload.toString("utf8", 1, length + 1);
    assert.deepEqual(JSON.parse(json) as unknown, {
      version: { name, protocol },
      players: { max: 10, online: 0 },
      description: { text: "sleeping" },
    });
  }
});

const listen = async (server: net.Server): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
};

test("status response timeout starts after TCP connect", async () => {
  const server = net.createServer((socket) => {
    setTimeout(() => {
      socket.end(createStatusPacket("ready", "test", 1));
      setTimeout(() => socket.destroy(), 20);
    }, 40);
  });
  const port = await listen(server);

  try {
    const status = await queryMinecraftStatus(undefined, {
      host: "127.0.0.1",
      port,
      connectTimeoutMs: 10,
      statusTimeoutMs: 100,
    });
    assert.equal(status.description && typeof status.description === "object", true);
  } finally {
    server.close();
  }
});

test("status query times out using the status timeout", async () => {
  const server = net.createServer();
  const port = await listen(server);
  const startedAt = Date.now();

  try {
    await assert.rejects(
      queryMinecraftStatus(undefined, {
        host: "127.0.0.1",
        port,
        connectTimeoutMs: 10,
        statusTimeoutMs: 60,
      }),
      /status query timed out/,
    );
    assert.ok(Date.now() - startedAt >= 50);
  } finally {
    server.close();
  }
});
