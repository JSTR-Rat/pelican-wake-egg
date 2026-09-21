import { config } from "./config.js";
import type {
  PelicanClient,
  PelicanPowerState,
  PowerSignal,
} from "./types.js";

const asObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Pelican response was not an object");
  }

  return value as Record<string, unknown>;
};

const mapPowerState = (value: unknown): PelicanPowerState => {
  if (value === "offline" || value === "starting" || value === "running" || value === "stopping") {
    return value;
  }

  return "unknown";
};

const request = async (
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.pelican.requestTimeoutMs);

  const abort = (): void => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    return await fetch(new URL(path, config.pelican.baseUrl), {
      ...init,
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      throw new Error(`Pelican request timed out or was cancelled: ${path}`);
    }

    throw new Error(
      `Pelican request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
};

const sendPowerSignal = async (
  signalName: PowerSignal,
  signal?: AbortSignal,
): Promise<void> => {
  console.log(`[pelican] requesting ${signalName}`);

  const response = await request(
    `/api/client/servers/${encodeURIComponent(config.pelican.serverId)}/power`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.pelican.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ signal: signalName }),
    },
    signal,
  );

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(
      `Pelican ${signalName} rejected: HTTP ${response.status} ${response.statusText}${body ? `: ${body}` : ""}`,
    );
  }

  console.log(`[pelican] ${signalName} request accepted`);
};

export const pelicanClient: PelicanClient = {
  start: (signal) => sendPowerSignal("start", signal),
  stop: (signal) => sendPowerSignal("stop", signal),

  getPowerState: async (signal) => {
    const response = await request(
      `/api/client/servers/${encodeURIComponent(config.pelican.serverId)}/resources`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.pelican.apiKey}`,
          Accept: "application/json",
        },
      },
      signal,
    );

    if (!response.ok) {
      throw new Error(
        `Pelican power-state query failed: HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = asObject((await response.json()) as unknown);
    const attributes = asObject(body.attributes);

    return mapPowerState(attributes.current_state);
  },
};

export const startServer = (signal?: AbortSignal): Promise<void> =>
  pelicanClient.start(signal);

export const stopServer = (signal?: AbortSignal): Promise<void> =>
  pelicanClient.stop(signal);
