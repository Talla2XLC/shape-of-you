import { randomUUID } from "node:crypto";

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit
} from "@nestjs/common";

import {
  RECOVERY_ERASURE_WORKER_ENABLED,
  RECOVERY_STORE
} from "../application/tokens.js";
import type { RecoveryStore } from "../storage/recovery-repository.js";

const leaseMs = 30_000;
const retryDelayMs = 5_000;
const idleDelayMs = 5_000;
const expiryBatchSize = 25;

/** Durable Recovery retention and erasure worker hosted by the API process. */
@Injectable()
export class RecoveryErasureWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RecoveryErasureWorker.name);
  private readonly workerId = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<boolean> | undefined;
  private stopping = false;

  public constructor(
    @Inject(RECOVERY_STORE) private readonly store: RecoveryStore,
    @Inject(RECOVERY_ERASURE_WORKER_ENABLED) private readonly enabled: boolean
  ) {}

  /** Starts fail-safe polling without creating another deployable boundary. */
  public onModuleInit(): void {
    if (this.enabled) this.schedule(0);
  }

  /** Stops polling and waits for the current transactional deletion attempt. */
  public async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active;
  }

  /** Enqueues expired retention and processes at most one durable request. */
  public async processNext(): Promise<boolean> {
    await this.store.enqueueExpiredRetention(expiryBatchSize);
    const job = await this.store.claimErasure(this.workerId, leaseMs);
    if (!job) return false;
    try {
      await this.store.completeErasure(job);
    } catch {
      this.logger.warn("Recovery erasure attempt failed");
      await this.store.failErasure(job, "ERASURE_ATTEMPT_FAILED", retryDelayMs);
    }
    return true;
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.active = this.processNext()
        .catch(() => {
          this.logger.error("Recovery erasure polling failed");
          return false;
        })
        .finally(() => {
          this.active = undefined;
          this.schedule(idleDelayMs);
        });
    }, delay);
    this.timer.unref();
  }
}
