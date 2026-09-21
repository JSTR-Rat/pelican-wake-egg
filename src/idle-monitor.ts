import { config } from "./config.js";
import type { BackendController } from "./backend-controller.js";
import type { PlayerDirectory } from "./types.js";

export class IdleMonitor {
  private emptySince: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private checking = false;
  private stopped = false;

  public constructor(
    private readonly controller: BackendController,
    private readonly players: PlayerDirectory,
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }

    this.stopped = false;
    void this.check();
    this.schedule();
  }

  public stop(): void {
    this.stopped = true;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.emptySince = null;
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check().then(
        () => this.schedule(),
        () => this.schedule(),
      );
    }, config.idle.checkIntervalMs);
  }

  private async check(): Promise<void> {
    if (this.checking || this.controller.getState() !== "online") {
      if (this.controller.getState() !== "online") {
        this.emptySince = null;
      }

      return;
    }

    this.checking = true;

    try {
      const currentPlayers = await this.players.getPlayers();

      if (currentPlayers.length > 0) {
        if (this.emptySince !== null) {
          console.log(`[idle] ${currentPlayers.length} player(s) online; timer cancelled`);
        }

        this.emptySince = null;
        return;
      }

      if (this.emptySince === null) {
        this.emptySince = performance.now();
        console.log("[idle] server empty; timer started");
        return;
      }

      const idleFor = performance.now() - this.emptySince;
      console.log(`[idle] server empty for ${Math.floor(idleFor / 60_000)} minute(s)`);

      if (idleFor < config.idle.timeoutMs || this.controller.getState() !== "online") {
        return;
      }

      const finalPlayers = await this.players.getPlayers();

      if (finalPlayers.length > 0) {
        console.log("[idle] player detected before shutdown; timer cancelled");
        this.emptySince = null;
        return;
      }

      if (this.controller.getState() !== "online") {
        this.emptySince = null;
        return;
      }

      console.log("[idle] idle timeout reached; requesting stop");
      await this.controller.requestStop();
      this.emptySince = null;
    } catch (error: unknown) {
      console.error("[idle] failed to query player count or stop backend:", error);
    } finally {
      this.checking = false;
    }
  }
}
