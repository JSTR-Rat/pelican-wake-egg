import type { Socket } from "node:net";

export type BackendState =
  | "offline"
  | "starting"
  | "online"
  | "stopping";

export type MinecraftReadiness = "ready" | "not-ready";

export type PelicanPowerState =
  | "offline"
  | "starting"
  | "running"
  | "stopping"
  | "unknown";

export type PowerSignal = "start" | "stop";

export type Player = {
  id?: string;
  name: string;
};

export type MinecraftStatus = {
  version: {
    name: string;
    protocol: number;
  };
  players: {
    online: number;
    max: number;
  };
  description: unknown;
  favicon?: string;
};

export type BackendObservations = {
  minecraft: MinecraftReadiness;
  pelican: PelicanPowerState;
};

export interface BackendReadiness {
  queryStatus(signal?: AbortSignal): Promise<MinecraftStatus>;
}

export interface PelicanClient {
  getPowerState(signal?: AbortSignal): Promise<PelicanPowerState>;
  start(signal?: AbortSignal): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
}

export interface PlayerDirectory {
  getPlayers(signal?: AbortSignal): Promise<readonly Player[]>;
}

export type BackendConnection = {
  client: Socket;
  initialData?: Buffer<ArrayBufferLike>;
};
