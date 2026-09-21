import { strict as assert } from "node:assert";
import { test } from "node:test";

process.env.PELICAN_BASE_URL = "http://127.0.0.1:8080";
process.env.PELICAN_API_KEY = "test-key";
process.env.PELICAN_SERVER_ID = "test-server";
process.env.MINECRAFT_VERSION_NAME = "26.3";
process.env.MINECRAFT_PROTOCOL_VERSION = "777";
process.env.MANAGEMENT_HOST = "127.0.0.1";
process.env.MANAGEMENT_PORT = "25585";
process.env.MANAGEMENT_SECRET = "test-secret";
process.env.BACKEND_START_TIMEOUT_MS = "20";
process.env.BACKEND_STOP_TIMEOUT_MS = "20";

const { BackendController } = await import("../src/backend-controller.js");

test("controller deduplicates start requests", async () => {
  let starts = 0;
  let ready = false;

  const controller = new BackendController(
    {
      queryStatus: async () => {
        if (!ready) {
          throw new Error("not ready");
        }

        return {
          version: { name: "test", protocol: 1 },
          players: { online: 0, max: 1 },
          description: { text: "test" },
        };
      },
    },
    {
      start: async () => {
        starts++;
        ready = true;
      },
      stop: async () => undefined,
      getPowerState: async () => (ready ? "running" : "offline"),
    },
  );

  await controller.initialize();
  await Promise.all([controller.ensureStarting(), controller.ensureStarting()]);

  assert.equal(starts, 1);
  assert.equal(controller.getState(), "online");
});

test("ambiguous start does not immediately issue another start", async () => {
  let starts = 0;
  let powerState: "offline" | "starting" = "offline";

  const controller = new BackendController(
    { queryStatus: async () => { throw new Error("not ready"); } },
    {
      start: async () => {
        starts++;
        powerState = "starting";
        throw new Error("timeout");
      },
      stop: async () => undefined,
      getPowerState: async () => powerState,
    },
  );

  await controller.initialize();
  await controller.ensureStarting();
  await controller.ensureStarting();

  assert.equal(starts, 1);
  assert.equal(controller.getState(), "starting");
});

test("requestStop transitions before issuing the stop request", async () => {
  let stateDuringStop = "";
  let stopCalls = 0;

  const controller = new BackendController(
    { queryStatus: async () => ({
      version: { name: "test", protocol: 1 },
      players: { online: 0, max: 1 },
      description: { text: "test" },
    }) },
    {
      start: async () => undefined,
      stop: async () => {
        stopCalls++;
        stateDuringStop = controller.getState();
      },
      getPowerState: async () => "running",
    },
  );

  await controller.initialize();
  await controller.requestStop();

  assert.equal(stopCalls, 1);
  assert.equal(stateDuringStop, "stopping");
});

test("one readiness failure does not take an online backend offline", async () => {
  let ready = true;

  const controller = new BackendController(
    {
      queryStatus: async () => {
        if (!ready) {
          throw new Error("temporary probe failure");
        }

        return {
          version: { name: "test", protocol: 1 },
          players: { online: 0, max: 1 },
          description: { text: "test" },
        };
      },
    },
    {
      start: async () => undefined,
      stop: async () => undefined,
      getPowerState: async () => "running",
    },
  );

  await controller.initialize();
  ready = false;
  await controller.reconcile();

  assert.equal(controller.getState(), "online");
});
