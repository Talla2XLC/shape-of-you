import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";

import { INTEGRATION_STORE, INTEGRATION_WORKER_ENABLED } from "../application/tokens.js";
import type { IntegrationStore } from "./integration-store.js";
import { GarminPersonalService } from "./garmin-personal.service.js";
import { IntegrationService } from "./integration.service.js";
import { GarminCutoverService } from "./garmin-cutover.service.js";

const idleMs = 30_000;
// Covers two bounded reconciliations plus the shared twenty-download FIT budget.
const leaseMs = 15 * 60_000;

/** Bounded reconciliation loop hosted by the existing API deployable. */
@Injectable()
export class IntegrationWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly workerId = randomUUID();
  private readonly logger = new Logger(IntegrationWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopping = false;
  private preferDirect = false;

  public constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore | null,
    @Inject(INTEGRATION_WORKER_ENABLED) private readonly enabled: boolean,
    @Inject(IntegrationService) private readonly service: IntegrationService,
    @Optional() @Inject(GarminPersonalService) private readonly garmin: GarminPersonalService | null = null,
    @Optional() @Inject(GarminCutoverService) private readonly cutover: GarminCutoverService | null = null
  ) {}

  public onModuleInit(): void { if (this.enabled && (this.store || this.garmin)) this.schedule(0); }
  public async onApplicationShutdown(): Promise<void> { this.stopping = true; if (this.timer) clearTimeout(this.timer); await this.running; }

  /** Claims and reconciles at most one durable connection. */
  public async processNext(): Promise<boolean> {
    if (await this.cutover?.processNext()) return true;
    this.preferDirect = !this.preferDirect;
    if (this.preferDirect && await this.garmin?.processNext(this.workerId, leaseMs)) return true;
    if (!this.store || !this.service.isConfigured()) return await this.garmin?.processNext(this.workerId, leaseMs) ?? false;
    const disconnect = await this.store.claimRemoteDisconnectDue(this.workerId, leaseMs);
    if (disconnect) {
      await this.service.retryRemoteDisconnect(disconnect);
      return true;
    }
    const connection = await this.store.claimDue(this.workerId, leaseMs);
    if (!connection) return await this.garmin?.processNext(this.workerId, leaseMs) ?? false;
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
