import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit
} from "@nestjs/common";

import {
  INTAKE_PARSER,
  INTAKE_STORE
} from "../application/tokens.js";
import { DomainValidationError } from "../domain/errors.js";
import type { IntakeParser } from "../domain/intake.js";
import type {
  IntakeJob,
  IntakeStore
} from "../storage/intake-repository.js";

const leaseMs = 30_000;
const retryDelayMs = 1_000;
const idleDelayMs = 100;

/** Durable Intake worker hosted by the existing API runtime. */
@Injectable()
export class IntakeWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(IntakeWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<boolean> | undefined;
  private stopping = false;

  public constructor(
    @Inject(INTAKE_STORE) private readonly store: IntakeStore,
    @Inject(INTAKE_PARSER) private readonly parser: IntakeParser | null
  ) {}

  /** Starts polling only when a concrete parser adapter is configured. */
  public onModuleInit(): void {
    if (this.parser) {
      this.schedule(0);
    }
  }

  /** Stops polling and waits for the current leased job attempt. */
  public async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    await this.active;
  }

  /** Processes at most one available job, primarily for deterministic tests. */
  public async processNext(): Promise<boolean> {
    if (!this.parser) {
      return false;
    }
    const job = await this.store.claimNextJob(leaseMs);
    if (!job) {
      return false;
    }
    try {
      await this.process(job, this.parser);
    } catch (error) {
      const code =
        error instanceof DomainValidationError
          ? "INVALID_PARSER_OUTPUT"
          : job.kind === "route_item"
            ? "ROUTING_FAILED"
            : "PARSER_FAILED";
      this.logger.warn({ jobId: job.id, code }, "Intake job attempt failed");
      await this.store.failJob(job, code, retryDelayMs);
    }
    return true;
  }

  private async process(job: IntakeJob, parser: IntakeParser): Promise<void> {
    if (job.kind === "parse_request") {
      const request = await this.store.loadParseRequest(job);
      await this.store.completeParse(job, await parser.parse(request));
      return;
    }
    if (job.kind === "parse_clarification") {
      const request = await this.store.loadClarificationRequest(job);
      await this.store.completeClarification(
        job,
        await parser.clarify(request)
      );
      return;
    }
    await this.store.routeWeight(job);
  }

  private schedule(delay: number): void {
    if (this.stopping) {
      return;
    }
    this.timer = setTimeout(() => {
      this.active = this.processNext()
        .catch(() => {
          this.logger.error("Intake worker polling failed");
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
