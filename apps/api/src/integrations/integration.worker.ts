import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";

import { INTEGRATION_STORE, INTEGRATION_WORKER_ENABLED } from "../application/tokens.js";
import type { IntegrationStore } from "./integration-store.js";
import { IntegrationService } from "./integration.service.js";

const idleMs = 30_000;
const leaseMs = 60_000;

/** Bounded reconciliation loop hosted by the existing API deployable. */
@Injectable()
export class IntegrationWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly workerId = randomUUID();
  private readonly logger = new Logger(IntegrationWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopping = false;

  public constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore | null,
    @Inject(INTEGRATION_WORKER_ENABLED) private readonly enabled: boolean,
    @Inject(IntegrationService) private readonly service: IntegrationService
  ) {}

  public onModuleInit(): void { if (this.enabled && this.store) this.schedule(0); }
  public async onApplicationShutdown(): Promise<void> { this.stopping = true; if (this.timer) clearTimeout(this.timer); await this.running; }

  /** Claims and reconciles at most one durable connection. */
  public async processNext(): Promise<boolean> {
    if (!this.store) return false;
    const disconnect = await this.store.claimRemoteDisconnectDue(this.workerId, leaseMs);
    if (disconnect) {
      await this.service.retryRemoteDisconnect(disconnect);
      return true;
    }
    const connection = await this.store.claimDue(this.workerId, leaseMs);
    if (!connection) return false;
    await this.service.reconcileConnection(connection);
    return true;
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.running = this.processNext().then(() => undefined).catch(() => {
        this.logger.warn("Integration reconciliation attempt failed");
      }).finally(() => {
        this.running = undefined;
        this.schedule(idleMs);
      });
    }, delay);
    this.timer.unref();
  }
}
