import { strict as assert } from "node:assert";
import net from "node:net";
import { test } from "node:test";

import { RconPlayerDirectory, parseRconPlayers } from "../src/rcon.js";

const responsePacket = (id: number, type: number, body = ""): Buffer => {
  const payload = Buffer.from(body);
  const packet = Buffer.alloc(payload.length + 14);
  packet.writeInt32LE(payload.length + 10, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  payload.copy(packet, 12);
  return packet;
};

const settings = (port: number, requestTimeoutMs = 100): ConstructorParameters<typeof RconPlayerDirectory>[0] => ({
  type: "rcon",
  host: "127.0.0.1",
  port,
  password: "secret",
  connectTimeoutMs: 100,
  requestTimeoutMs,
});

test("RCON list response parses zero players", () => {
  assert.deepEqual(parseRconPlayers("There are 0 of a max of 10 players online:"), []);
});

test("RCON list response parses one and multiple players", () => {
  assert.deepEqual(parseRconPlayers("There are 1 of a max of 10 players online: Wade"), [{ name: "Wade" }]);
  assert.deepEqual(parseRconPlayers("There are 2 of a max of 10 players online: Wade, Vada"), [
    { name: "Wade" },
    { name: "Vada" },
  ]);
});

test("malformed RCON list response rejects", () => {
  assert.throws(() => parseRconPlayers("server is healthy"), /unrecognized format/);
  assert.throws(() => parseRconPlayers("There are 2 of a max of 10 players online: Wade"), /did not match/);
});

test("RCON authentication failure rejects", async () => {
  const server = net.createServer((socket) => {
    socket.once("data", () => socket.write(responsePacket(-1, 2)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  await assert.rejects(
    new RconPlayerDirectory(settings(address.port)).getPlayers(),
    /authentication failed/,
  );
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("RCON request timeout rejects", async () => {
  let connection: net.Socket | undefined;
  const server = net.createServer((socket) => {
    connection = socket;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  await assert.rejects(
    new RconPlayerDirectory(settings(address.port, 20)).getPlayers(),
    /timed out/,
  );
  connection?.destroy();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
