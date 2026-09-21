const DEFAULT_PROXY_PORT = 25565;
const DEFAULT_BACKEND_PORT = 25566;
const DEFAULT_RCON_PORT = 25575;

const requireString = (environment: NodeJS.ProcessEnv, name: string): string => {
  const value = environment[name];

  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const parsePort = (name: string, value: string): number => {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return port;
};

const parsePositiveInteger = (name: string, value: string): number => {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return number;
};

const optional = (environment: NodeJS.ProcessEnv, name: string, fallback: number): string =>
  environment[name] ?? String(fallback);

const parseUrl = (name: string, value: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }

  return url.toString();
};

export type PlayerProviderConfig =
  | {
      type: "management";
      host: string;
      port: number;
      secret: string;
      connectTimeoutMs: number;
      requestTimeoutMs: number;
    }
  | {
      type: "rcon";
      host: string;
      port: number;
      password: string;
      connectTimeoutMs: number;
      requestTimeoutMs: number;
    };

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env) => {
  const backendStartTimeoutMs = parsePositiveInteger(
    "BACKEND_START_TIMEOUT_MS",
    optional(environment, "BACKEND_START_TIMEOUT_MS", 120_000),
  );

  const backendStopTimeoutMs = parsePositiveInteger(
    "BACKEND_STOP_TIMEOUT_MS",
    optional(environment, "BACKEND_STOP_TIMEOUT_MS", 120_000),
  );

  const versionName = environment.MINECRAFT_VERSION_NAME;
  if (!versionName || versionName.trim().length === 0) {
    throw new Error("Missing required environment variable: MINECRAFT_VERSION_NAME");
  }

  const protocolVersion = parsePositiveInteger(
    "MINECRAFT_PROTOCOL_VERSION",
    environment.MINECRAFT_PROTOCOL_VERSION ?? "",
  );

  const provider = environment.PLAYER_PROVIDER ?? "management";
  let playerProvider: PlayerProviderConfig;

  if (provider === "management") {
    playerProvider = {
      type: "management",
      host: requireString(environment, "MANAGEMENT_HOST"),
      port: parsePort("MANAGEMENT_PORT", requireString(environment, "MANAGEMENT_PORT")),
      secret: requireString(environment, "MANAGEMENT_SECRET"),
      connectTimeoutMs: parsePositiveInteger(
        "MANAGEMENT_CONNECT_TIMEOUT_MS",
        optional(environment, "MANAGEMENT_CONNECT_TIMEOUT_MS", 2_000),
      ),
      requestTimeoutMs: parsePositiveInteger(
        "MANAGEMENT_REQUEST_TIMEOUT_MS",
        optional(environment, "MANAGEMENT_REQUEST_TIMEOUT_MS", 3_000),
      ),
    };
  } else if (provider === "rcon") {
    playerProvider = {
      type: "rcon",
      host: requireString(environment, "RCON_HOST"),
      port: parsePort("RCON_PORT", optional(environment, "RCON_PORT", DEFAULT_RCON_PORT)),
      password: requireString(environment, "RCON_PASSWORD"),
      connectTimeoutMs: parsePositiveInteger(
        "RCON_CONNECT_TIMEOUT_MS",
        optional(environment, "RCON_CONNECT_TIMEOUT_MS", 2_000),
      ),
      requestTimeoutMs: parsePositiveInteger(
        "RCON_REQUEST_TIMEOUT_MS",
        optional(environment, "RCON_REQUEST_TIMEOUT_MS", 3_000),
      ),
    };
  } else {
    throw new Error(`PLAYER_PROVIDER must be either management or rcon, got: ${provider}`);
  }

  return {
    minecraft: {
      versionName,
      protocolVersion,
    },
    proxy: {
      host: environment.PROXY_HOST ?? "0.0.0.0",
      port: parsePort("PROXY_PORT", optional(environment, "PROXY_PORT", DEFAULT_PROXY_PORT)),
    },

    backend: {
      host: environment.BACKEND_HOST ?? "192.168.1.100",
      port: parsePort(
        "BACKEND_PORT",
        optional(environment, "BACKEND_PORT", DEFAULT_BACKEND_PORT),
      ),
      connectTimeoutMs: parsePositiveInteger(
        "BACKEND_CONNECT_TIMEOUT_MS",
        optional(environment, "BACKEND_CONNECT_TIMEOUT_MS", 750),
      ),
      startTimeoutMs: backendStartTimeoutMs,
      stopTimeoutMs: backendStopTimeoutMs,
      readinessFailureThreshold: parsePositiveInteger(
        "BACKEND_READINESS_FAILURE_THRESHOLD",
        optional(environment, "BACKEND_READINESS_FAILURE_THRESHOLD", 3),
      ),
    },

    pelican: {
      baseUrl: parseUrl("PELICAN_BASE_URL", requireString(environment, "PELICAN_BASE_URL")),
      apiKey: requireString(environment, "PELICAN_API_KEY"),
      serverId: requireString(environment, "PELICAN_SERVER_ID"),
      requestTimeoutMs: parsePositiveInteger(
        "PELICAN_REQUEST_TIMEOUT_MS",
        optional(environment, "PELICAN_REQUEST_TIMEOUT_MS", 5_000),
      ),
    },

    playerProvider,

    idle: {
      timeoutMs: parsePositiveInteger(
        "IDLE_TIMEOUT_MS",
        optional(environment, "IDLE_TIMEOUT_MS", 60 * 60 * 1000),
      ),

      checkIntervalMs: parsePositiveInteger(
        "IDLE_CHECK_INTERVAL_MS",
        optional(environment, "IDLE_CHECK_INTERVAL_MS", 60 * 1000),
      ),
    },
  } as const;
};

export const config = loadConfig();
