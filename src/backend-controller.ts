import { config } from "./config.js";
import type {
  BackendObservations,
  BackendReadiness,
  BackendState,
  PelicanClient,
} from "./types.js";

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class BackendController {
  private state: BackendState = "offline";
  private observations: BackendObservations = {
    minecraft: "not-ready",
    pelican: "unknown",
  };
  private readinessFailures = 0;
  private lifecycleOperation: Promise<void> | null = null;
  private reconciliationOperation: Promise<void> | null = null;
  private reconciliationRequested = false;

  public constructor(
    private readonly readiness: BackendReadiness,
    private readonly pelican: PelicanClient,
  ) {}

  public getState(): BackendState {
    return this.state;
  }

  public getObservations(): BackendObservations {
    return { ...this.observations };
  }

  public isForwardingAllowed(): boolean {
    return this.state === "online";
  }

  public async initialize(): Promise<void> {
    await this.reconcileInternal(true);
  }

  public ensureStarting(): Promise<void> {
    if (this.state === "online" || this.state === "stopping") {
      return Promise.resolve();
    }

    if (this.state === "starting" || this.lifecycleOperation) {
      return this.lifecycleOperation ?? Promise.resolve();
    }

    const operation = this.startInternal();
    this.lifecycleOperation = operation;

    void operation.then(() => {
      if (this.lifecycleOperation === operation) {
        this.lifecycleOperation = null;
      }
      if (this.reconciliationRequested) {
        this.requestReconciliation();
      }
    }, (error: unknown) => {
      if (this.lifecycleOperation === operation) {
        this.lifecycleOperation = null;
      }
      if (this.reconciliationRequested) {
        this.requestReconciliation();
      }
      console.error("[state] lifecycle operation failed:", error);
    });

    return operation;
  }

  public requestStop(): Promise<void> {
    if (this.state === "offline" || this.state === "stopping") {
      return this.lifecycleOperation ?? Promise.resolve();
    }

    if (this.state !== "online") {
      return Promise.resolve();
    }

    if (this.lifecycleOperation) {
      return this.lifecycleOperation;
    }

    this.transition("stopping", "stop requested");
    const operation = this.stopInternal();
    this.lifecycleOperation = operation;

    void operation.then(() => {
      if (this.lifecycleOperation === operation) {
        this.lifecycleOperation = null;
      }
      if (this.reconciliationRequested) {
        this.requestReconciliation();
      }
    }, (error: unknown) => {
      if (this.lifecycleOperation === operation) {
        this.lifecycleOperation = null;
      }
      if (this.reconciliationRequested) {
        this.requestReconciliation();
      }
      console.error("[state] lifecycle operation failed:", error);
    });

    return operation;
  }

  public requestReconciliation(): void {
    this.reconciliationRequested = true;

    if (this.lifecycleOperation || this.reconciliationOperation) {
      return;
    }

    const operation = this.runRequestedReconciliation();
    this.reconciliationOperation = operation;
    void operation.then(() => {
      if (this.reconciliationOperation === operation) {
        this.reconciliationOperation = null;
      }
    }, (error: unknown) => {
      if (this.reconciliationOperation === operation) {
        this.reconciliationOperation = null;
      }
      console.error("[state] requested reconciliation failed:", error);
    });
  }

  public async reconcile(): Promise<void> {
    if (this.lifecycleOperation || this.reconciliationOperation) {
      return;
    }

    await this.reconcileInternal(false);
  }

  private async runRequestedReconciliation(): Promise<void> {
    while (this.reconciliationRequested) {
      this.reconciliationRequested = false;

      if (this.lifecycleOperation) {
        return;
      }

      await this.reconcileInternal(false);
    }
  }

  private async startInternal(): Promise<void> {
    this.transition("starting", "start requested");

    try {
      await this.pelican.start();
    } catch (error: unknown) {
      console.error("[pelican] start outcome is ambiguous:", error);
      await this.resolveAmbiguousStart();
      return;
    }

    console.log("[state] Pelican accepted start; waiting for Minecraft");

    try {
      await this.waitForReadiness(config.backend.startTimeoutMs);
      this.observations.minecraft = "ready";
      this.transition("online", "Minecraft status became ready");
    } catch (error: unknown) {
      console.error("[state] startup readiness is unresolved:", error);
      await this.resolveAmbiguousStart();
    }
  }

  private async resolveAmbiguousStart(): Promise<void> {
    try {
      const power = await this.pelican.getPowerState();
      this.observations.pelican = power;

      if (power === "offline") {
        this.transition("offline", "Pelican confirmed backend offline");
      } else if (power === "running" || power === "starting") {
        console.warn("[state] start outcome ambiguous; retaining starting");
        this.transition("starting", "Pelican indicates startup may continue");
      }
    } catch (error: unknown) {
      console.error("[state] could not resolve start outcome:", error);
      console.warn("[state] retaining starting until reconciliation");
    }
  }

  private async stopInternal(): Promise<void> {
    try {
      await this.pelican.stop();
    } catch (error: unknown) {
      console.error("[pelican] stop outcome is ambiguous:", error);
      await this.resolveAmbiguousStop();
      return;
    }

    console.log("[state] Pelican accepted stop; waiting for Minecraft");

    try {
      await this.waitForNotReady(config.backend.stopTimeoutMs);
      this.observations.minecraft = "not-ready";
      await this.finalizeStopAfterReadiness();
    } catch (error: unknown) {
      console.error("[state] shutdown outcome is unresolved:", error);
      await this.resolveAmbiguousStop();
    }
  }

  private async finalizeStopAfterReadiness(): Promise<void> {
    try {
      const power = await this.pelican.getPowerState();
      this.observations.pelican = power;

      if (power === "offline") {
        this.transition("offline", "Pelican and Minecraft confirmed stopped");
        return;
      }

      console.warn(
        `[state] Minecraft is unavailable but Pelican reports ${power}; retaining stopping`,
      );
    } catch (error: unknown) {
      console.error("[state] could not confirm Pelican stop state:", error);
      console.warn("[state] retaining stopping until reconciliation");
    }
  }

  private async resolveAmbiguousStop(): Promise<void> {
    try {
      const [power, minecraft] = await Promise.all([
        this.pelican.getPowerState(),
        this.checkReadiness(),
      ]);

      this.observations.pelican = power;
      this.observations.minecraft = minecraft;

      if (power === "stopping" || power === "starting") {
        this.transition("stopping", "Pelican indicates shutdown may continue");
      } else if (minecraft === "ready" && power === "running") {
        this.transition("online", "stop did not take effect");
      } else if (minecraft === "not-ready" && power === "offline") {
        this.transition("offline", "backend confirmed offline");
      } else {
        console.warn("[state] stop outcome ambiguous; retaining stopping");
      }
    } catch (error: unknown) {
      console.error("[state] could not resolve stop outcome:", error);
      console.warn("[state] retaining stopping until reconciliation");
    }
  }

  private async waitForReadiness(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        await this.readiness.queryStatus();
        return;
      } catch {
        await sleep(Math.min(1_000, Math.max(10, deadline - Date.now())));
      }
    }

    throw new Error(`Minecraft did not become ready within ${timeoutMs}ms`);
  }

  private async waitForNotReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        await this.readiness.queryStatus();
        await sleep(Math.min(1_000, Math.max(10, deadline - Date.now())));
      } catch {
        return;
      }
    }

    throw new Error(`Minecraft did not stop within ${timeoutMs}ms`);
  }

  private async checkReadiness(): Promise<"ready" | "not-ready"> {
    try {
      await this.readiness.queryStatus();
      return "ready";
    } catch {
      return "not-ready";
    }
  }

  private async reconcileInternal(initial: boolean): Promise<void> {
    const [pelican, minecraft] = await Promise.allSettled([
      this.pelican.getPowerState(),
      this.readiness.queryStatus(),
    ]);

    if (pelican.status === "fulfilled") {
      this.observations.pelican = pelican.value;
    } else {
      console.warn("[state] Pelican reconciliation failed:", pelican.reason);
    }

    if (minecraft.status === "fulfilled") {
      this.observations.minecraft = "ready";
      this.readinessFailures = 0;
    } else {
      this.observations.minecraft = "not-ready";
      this.readinessFailures++;
      if (!initial && this.readinessFailures < config.backend.readinessFailureThreshold) {
        console.warn(`[state] Minecraft readiness probe failed (${this.readinessFailures}/${config.backend.readinessFailureThreshold})`);
      }
    }

    this.applyObservations(initial);
  }

  private applyObservations(initial: boolean): void {
    const { minecraft, pelican } = this.observations;

    if (this.state === "stopping") {
      if (minecraft === "not-ready" && pelican === "offline") {
        this.transition("offline", "reconciliation confirmed backend stopped");
      } else if (minecraft === "ready" && pelican === "running") {
        this.transition("online", "reconciliation confirmed stop failed");
      }
      return;
    }

    if (pelican === "stopping") {
      this.transition("stopping", "Pelican reports backend stopping");
      return;
    }

    if (minecraft === "ready") {
      this.transition("online", "Minecraft status is ready");
      return;
    }

    if (
      this.state === "online" &&
      this.readinessFailures < config.backend.readinessFailureThreshold
    ) {
      return;
    }

    if (pelican === "starting" || pelican === "running") {
      this.transition("starting", "Pelican reports backend active but Minecraft is not ready");
      return;
    }

    if (pelican === "offline") {
      if (this.state === "online" && this.readinessFailures < config.backend.readinessFailureThreshold) {
        return;
      }

      this.transition("offline", "reconciliation confirmed backend offline");
      return;
    }

    if (initial) {
      console.warn("[state] startup reconciliation is incomplete; retaining offline until resolved");
    }
  }

  private transition(next: BackendState, reason: string): void {
    if (this.state === next) {
      return;
    }

    const allowed: Record<BackendState, readonly BackendState[]> = {
      offline: ["starting", "online", "stopping"],
      starting: ["online", "offline", "stopping"],
      online: ["stopping", "offline", "starting"],
      stopping: ["offline", "online"],
    };

    if (!allowed[this.state].includes(next)) {
      throw new Error(`Invalid backend transition ${this.state} -> ${next}`);
    }

    console.log(`[state] ${this.state} -> ${next} (${reason})`);
    this.state = next;
  }
}
