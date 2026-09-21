import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.PELICAN_BASE_URL = "http://127.0.0.1:8080";
process.env.PELICAN_API_KEY = "test-key";
process.env.PELICAN_SERVER_ID = "test-server";
process.env.MINECRAFT_VERSION_NAME = "26.3";
process.env.MINECRAFT_PROTOCOL_VERSION = "777";
process.env.MANAGEMENT_HOST = "127.0.0.1";
process.env.MANAGEMENT_PORT = "25585";
process.env.MANAGEMENT_SECRET = "secret";

const { loadConfig } = await import("../src/config.js");

const base = {
  PELICAN_BASE_URL: "http://127.0.0.1:8080",
  PELICAN_API_KEY: "test-key",
  PELICAN_SERVER_ID: "test-server",
  MINECRAFT_VERSION_NAME: "26.3",
  MINECRAFT_PROTOCOL_VERSION: "777",
};

test("management and rcon configurations validate independently", () => {
  const management = loadConfig({
    ...base,
    PLAYER_PROVIDER: "management",
    MANAGEMENT_HOST: "127.0.0.1",
    MANAGEMENT_PORT: "25585",
    MANAGEMENT_SECRET: "secret",
  });
  assert.equal(management.playerProvider.type, "management");

  const rcon = loadConfig({
    ...base,
    PLAYER_PROVIDER: "rcon",
    RCON_HOST: "127.0.0.1",
    RCON_PASSWORD: "secret",
  });
  assert.equal(rcon.playerProvider.type, "rcon");
  assert.equal(rcon.playerProvider.port, 25575);
});

test("invalid provider and missing selected credentials fail", () => {
  assert.throws(() => loadConfig({ ...base, PLAYER_PROVIDER: "other" }), /PLAYER_PROVIDER/);
  assert.throws(() => loadConfig({ ...base, PLAYER_PROVIDER: "rcon" }), /RCON_HOST/);
  assert.throws(() => loadConfig({ ...base, PLAYER_PROVIDER: "management" }), /MANAGEMENT_HOST/);
});

test("Minecraft version and protocol are configurable", () => {
  const config = loadConfig({
    ...base,
    MINECRAFT_VERSION_NAME: "1.20.1",
    MINECRAFT_PROTOCOL_VERSION: "763",
    PLAYER_PROVIDER: "rcon",
    RCON_HOST: "127.0.0.1",
    RCON_PASSWORD: "secret",
  });
  assert.deepEqual(config.minecraft, { versionName: "1.20.1", protocolVersion: 763 });
});
