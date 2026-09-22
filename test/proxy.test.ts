import { strict as assert } from "node:assert";
import net from "node:net";
import { test } from "node:test";

const { proxyToBackend } = await import("../src/proxy.js");

const listen = async (server: net.Server): Promise<number> => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
};

test("established backend sessions are not killed by connect timeout", async () => {
  const backend = net.createServer();
  const backendPort = await listen(backend);
  const clientListener = net.createServer((client) => {
    proxyToBackend(client, 1, {
      host: "127.0.0.1",
      port: backendPort,
      connectTimeoutMs: 20,
    }, { requestReconciliation: () => undefined });
  });
  const clientPort = await listen(clientListener);
  const client = net.createConnection({ host: "127.0.0.1", port: clientPort });

  try {
    await new Promise<void>((resolve) => client.once("connect", resolve));
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    assert.equal(client.destroyed, false);
  } finally {
    client.destroy();
    clientListener.close();
    backend.close();
  }
});

test("pre-connect backend failure closes the client and requests reconciliation", async () => {
  let reconciliations = 0;
  const unavailable = net.createServer();
  const backendPort = await listen(unavailable);
  unavailable.close();
  const clientListener = net.createServer((client) => {
    proxyToBackend(client, 3, {
      host: "127.0.0.1",
      port: backendPort,
      connectTimeoutMs: 100,
    }, { requestReconciliation: () => { reconciliations++; } });
  });
  const clientPort = await listen(clientListener);
  const client = net.createConnection({ host: "127.0.0.1", port: clientPort });

  try {
    await new Promise<void>((resolve) => client.once("close", () => resolve()));
    assert.equal(reconciliations, 1);
  } finally {
    client.destroy();
    clientListener.close();
  }
});

test("established backend close does not request reconciliation", async () => {
  let reconciliations = 0;
  const backend = net.createServer((socket) => socket.end());
  const backendPort = await listen(backend);
  const clientListener = net.createServer((client) => {
    proxyToBackend(client, 2, {
      host: "127.0.0.1",
      port: backendPort,
      connectTimeoutMs: 100,
    }, { requestReconciliation: () => { reconciliations++; } });
  });
  const clientPort = await listen(clientListener);
  const client = net.createConnection({ host: "127.0.0.1", port: clientPort });

  try {
    await new Promise<void>((resolve) => client.once("close", () => resolve()));
    assert.equal(reconciliations, 0);
  } finally {
    client.destroy();
    clientListener.close();
    backend.close();
  }
});
