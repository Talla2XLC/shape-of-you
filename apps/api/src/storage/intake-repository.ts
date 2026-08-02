import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  eq,
  sql
} from "drizzle-orm";

import type {
  ClarifyIntakeItem,
  CreateIntakeRequest,
  CreateWeightMeasurement,
  DecideIntakeItem,
  IntakeItem,
  IntakeRequest
} from "@shape-of-you/contracts";

import type { DatabaseContext } from "../database/context.js";
import {
  intakeItems,
  intakeJobs,
  intakeRequests,
  intakeTimelineEntries,
  intakeWeightDetails,
  sourceReferences,
  type IntakeItemRow,
  type IntakeJobRow,
  type IntakeRequestRow,
  type IntakeWeightDetailRow,
  type SourceReferenceRow
} from "../database/schema.js";
import {
  deriveIntakeRequestStatus,
  type IntakeClarificationRequest,
  type IntakeParseRequest,
  type ParsedIntakeItem
} from "../domain/intake.js";
import {
  ConflictError,
  DomainValidationError,
  NotFoundError
} from "../domain/errors.js";
import { deriveLocalDate } from "../domain/weight-measurement.js";
import { toSourceReference } from "../domain/source-reference.js";
import {
  discardUnusedSourceReference,
  ensureSourceReference,
  type DatabaseTransaction
} from "./source-reference-repository.js";
import { createWeightMeasurementInTransaction } from "./weight-measurement-repository.js";

/** Durable queue job leased to one Intake worker. */
export interface IntakeJob {
  readonly id: string;
  readonly personId: string;
  readonly requestId: string;
  readonly itemId: string | null;
  readonly kind: "parse_request" | "parse_clarification" | "route_item";
  readonly leaseToken: string;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** Idempotent result of accepting one IntakeRequest. */
export interface CreateIntakeRequestResult {
  readonly created: boolean;
  readonly request: IntakeRequest;
}

/** Persistence and durable-work boundary for the Intake capability. */
export interface IntakeStore {
  /** Accepts and queues one idempotent Person-owned source message. */
  create(
    personId: string,
    input: CreateIntakeRequest
  ): Promise<CreateIntakeRequestResult>;
  /** Reads the current request projection inside one Person boundary. */
  find(personId: string, id: string): Promise<IntakeRequest | null>;
  /** Saves one clarification answer and schedules its parsing job. */
  clarify(
    personId: string,
    requestId: string,
    itemId: string,
    input: ClarifyIntakeItem
  ): Promise<IntakeRequest>;
  /** Confirms or rejects one independently actionable item. */
  decide(
    personId: string,
    requestId: string,
    itemId: string,
    input: DecideIntakeItem
  ): Promise<IntakeRequest>;
  /** Loads private source text for a currently leased parser job. */
  loadParseRequest(job: IntakeJob): Promise<IntakeParseRequest>;
  /** Loads private source text and answer for a clarification parser job. */
  loadClarificationRequest(job: IntakeJob): Promise<IntakeClarificationRequest>;
  /** Atomically leases the next available job, or returns null when idle. */
  claimNextJob(leaseMs: number): Promise<IntakeJob | null>;
  /** Persists typed parser output and completes the active lease. */
  completeParse(
    job: IntakeJob,
    parsedItems: readonly ParsedIntakeItem[]
  ): Promise<void>;
  /** Replaces one ambiguous item with its clarified typed result. */
  completeClarification(
    job: IntakeJob,
    parsedItem: ParsedIntakeItem
  ): Promise<void>;
  /** Routes a confirmed typed weight item in the lease-owning transaction. */
  routeWeight(job: IntakeJob): Promise<void>;
  /** Reschedules a failed attempt or records a terminal safe error code. */
  failJob(job: IntakeJob, errorCode: string, retryDelayMs: number): Promise<void>;
}

interface RequestProjectionRow {
  readonly request: IntakeRequestRow;
  readonly sourceReference: SourceReferenceRow;
}

interface ItemProjectionRow {
  readonly item: IntakeItemRow;
  readonly detail: IntakeWeightDetailRow | null;
}

function serializeItem(row: ItemProjectionRow): IntakeItem {
  return {
    id: row.item.id,
    position: row.item.position,
    kind: row.item.kind,
    status: row.item.status,
    confidence:
      row.item.confidence === null ? null : Number(row.item.confidence),
    clarificationQuestion: row.item.clarificationQuestion,
    detail: row.detail
      ? {
          measuredAt: row.detail.measuredAt.toISOString(),
          timezone: row.detail.timezone,
          weightKg: Number(row.detail.weightKg),
          dedupeKey: row.detail.dedupeKey,
          measurementId: row.detail.measurementId
        }
      : null,
    createdAt: row.item.createdAt.toISOString(),
    updatedAt: row.item.updatedAt.toISOString()
  };
}

function serializeRequest(
  row: RequestProjectionRow,
  items: readonly IntakeItem[]
): IntakeRequest {
  return {
    id: row.request.id,
    personId: row.request.personId,
    text: row.request.originalText,
    locale: row.request.locale,
    timezone: row.request.timezone,
    sourceReference: toSourceReference(row.sourceReference),
    idempotencyKey: row.request.idempotencyKey,
    parsingStatus: row.request.parsingStatus,
    status: deriveIntakeRequestStatus(row.request.parsingStatus, items),
    failureCode: row.request.failureCode,
    items: [...items],
    receivedAt: row.request.receivedAt.toISOString()
  };
}

async function appendTimeline(
  transaction: DatabaseTransaction,
  values: typeof intakeTimelineEntries.$inferInsert
): Promise<void> {
  await transaction.insert(intakeTimelineEntries).values(values);
}

async function insertJob(
  transaction: DatabaseTransaction,
  values: typeof intakeJobs.$inferInsert
): Promise<void> {
  await transaction
    .insert(intakeJobs)
    .values(values)
    .onConflictDoNothing();
}

function validateParsedItem(item: ParsedIntakeItem): void {
  if (
    item.confidence !== null &&
    (item.confidence < 0 || item.confidence > 1)
  ) {
    throw new DomainValidationError("Parser confidence is out of range");
  }
  if (item.status === "needs_clarification") {
    if (
      item.clarificationQuestion.length === 0 ||
      item.clarificationQuestion.length > 2_000
    ) {
      throw new DomainValidationError("Parser clarification is invalid");
    }
    return;
  }

  const measuredAt = new Date(item.measuredAt);
  if (Number.isNaN(measuredAt.valueOf())) {
    throw new DomainValidationError("Parser measuredAt is invalid");
  }
  deriveLocalDate(measuredAt, item.timezone);
  if (item.weightKg < 0.5 || item.weightKg > 700) {
    throw new DomainValidationError("Parser weight is out of range");
  }
  if (item.dedupeKey.length === 0 || item.dedupeKey.length > 256) {
    throw new DomainValidationError("Parser dedupe key is invalid");
  }
}

/** PostgreSQL implementation of durable Intake orchestration state. */
export class IntakeRepository implements IntakeStore {
  public constructor(private readonly database: DatabaseContext) {}

  /** {@inheritDoc IntakeStore.create} */
  public async create(
    personId: string,
    input: CreateIntakeRequest
  ): Promise<CreateIntakeRequestResult> {
    deriveLocalDate(new Date(), input.timezone);
    const outcome = await this.database.db.transaction(async (transaction) => {
      const sourceReference = await ensureSourceReference(
        transaction,
        personId,
        input.sourceReference
      );
      const inserted = await transaction
        .insert(intakeRequests)
        .values({
          personId,
          source: input.sourceReference.channel,
          sourceReferenceId: sourceReference.row.id,
          originalText: input.text,
          locale: input.locale,
          timezone: input.timezone,
          idempotencyKey: input.idempotencyKey
        })
        .onConflictDoNothing()
        .returning({ id: intakeRequests.id });

      if (!inserted[0]) {
        await discardUnusedSourceReference(transaction, sourceReference);
        const existing = await transaction.query.intakeRequests.findFirst({
          where: and(
            eq(intakeRequests.personId, personId),
            eq(intakeRequests.source, input.sourceReference.channel),
            eq(intakeRequests.idempotencyKey, input.idempotencyKey)
          )
        });
        if (!existing) {
          throw new Error("IntakeRequest dedupe conflict did not resolve");
        }
        return { created: false, id: existing.id };
      }

      await insertJob(transaction, {
        personId,
        requestId: inserted[0].id,
        kind: "parse_request",
        jobKey: `parse:${inserted[0].id}`
      });
      await appendTimeline(transaction, {
        personId,
        requestId: inserted[0].id,
        event: "received"
      });
      return { created: true, id: inserted[0].id };
    });

    const request = await this.find(personId, outcome.id);
    if (!request) {
      throw new Error("Created IntakeRequest could not be read");
    }
    return { created: outcome.created, request };
  }

  /** {@inheritDoc IntakeStore.find} */
  public async find(personId: string, id: string): Promise<IntakeRequest | null> {
    const requestRows = await this.database.db
      .select({ request: intakeRequests, sourceReference: sourceReferences })
      .from(intakeRequests)
      .innerJoin(
        sourceReferences,
        eq(intakeRequests.sourceReferenceId, sourceReferences.id)
      )
      .where(and(eq(intakeRequests.id, id), eq(intakeRequests.personId, personId)))
      .limit(1);
    if (!requestRows[0]) {
      return null;
    }

    const rows = await this.database.db
      .select({ item: intakeItems, detail: intakeWeightDetails })
      .from(intakeItems)
      .leftJoin(
        intakeWeightDetails,
        eq(intakeItems.id, intakeWeightDetails.itemId)
      )
      .where(
        and(
          eq(intakeItems.requestId, id),
          eq(intakeItems.personId, personId)
        )
      )
      .orderBy(asc(intakeItems.position));
    return serializeRequest(requestRows[0], rows.map(serializeItem));
  }

  /** {@inheritDoc IntakeStore.clarify} */
  public async clarify(
    personId: string,
    requestId: string,
    itemId: string,
    input: ClarifyIntakeItem
  ): Promise<IntakeRequest> {
    await this.database.db.transaction(async (transaction) => {
      const locked = await transaction.execute(sql`
        select id from ${intakeItems}
         where ${intakeItems.id} = ${itemId}
           and ${intakeItems.requestId} = ${requestId}
           and ${intakeItems.personId} = ${personId}
         for update
      `);
      if (locked.rows.length === 0) {
        throw new NotFoundError("Intake item was not found");
      }
      const item = await transaction.query.intakeItems.findFirst({
        where: and(
          eq(intakeItems.id, itemId),
          eq(intakeItems.personId, personId)
        )
      });
      if (!item) {
        throw new NotFoundError("Intake item was not found");
      }
      if (item.clarificationIdempotencyKey) {
        if (item.clarificationIdempotencyKey === input.idempotencyKey) {
          return;
        }
        throw new ConflictError("Intake clarification was already submitted");
      }
      if (item.status !== "needs_clarification") {
        throw new ConflictError("Intake item does not require clarification");
      }

      await transaction
        .update(intakeItems)
        .set({
          status: "queued",
          clarificationQuestion: null,
          clarificationAnswer: input.answer,
          clarificationIdempotencyKey: input.idempotencyKey,
          updatedAt: new Date()
        })
        .where(eq(intakeItems.id, itemId));
      await insertJob(transaction, {
        personId,
        requestId,
        itemId,
        kind: "parse_clarification",
        jobKey: `clarify:${itemId}:${input.idempotencyKey}`
      });
      await appendTimeline(transaction, {
        personId,
        requestId,
        itemId,
        event: "clarification_submitted"
      });
    });
    return this.requireRequest(personId, requestId);
  }

  /** {@inheritDoc IntakeStore.decide} */
  public async decide(
    personId: string,
    requestId: string,
    itemId: string,
    input: DecideIntakeItem
  ): Promise<IntakeRequest> {
    await this.database.db.transaction(async (transaction) => {
      const locked = await transaction.execute(sql`
        select id from ${intakeItems}
         where ${intakeItems.id} = ${itemId}
           and ${intakeItems.requestId} = ${requestId}
           and ${intakeItems.personId} = ${personId}
         for update
      `);
      if (locked.rows.length === 0) {
        throw new NotFoundError("Intake item was not found");
      }
      const item = await transaction.query.intakeItems.findFirst({
        where: and(
          eq(intakeItems.id, itemId),
          eq(intakeItems.personId, personId)
        )
      });
      if (!item) {
        throw new NotFoundError("Intake item was not found");
      }
      if (item.decisionIdempotencyKey) {
        if (item.decisionIdempotencyKey === input.idempotencyKey) {
          return;
        }
        throw new ConflictError("Intake item already has a decision");
      }
      if (item.status !== "awaiting_confirmation") {
        throw new ConflictError("Intake item is not awaiting confirmation");
      }

      const confirmed = input.decision === "confirm";
      await transaction
        .update(intakeItems)
        .set({
          status: confirmed ? "queued" : "rejected",
          decisionIdempotencyKey: input.idempotencyKey,
          updatedAt: new Date()
        })
        .where(eq(intakeItems.id, itemId));
      if (confirmed) {
        await insertJob(transaction, {
          personId,
          requestId,
          itemId,
          kind: "route_item",
          jobKey: `route:${itemId}`
        });
      }
      await appendTimeline(transaction, {
        personId,
        requestId,
        itemId,
        event: confirmed ? "confirmed" : "rejected"
      });
    });
    return this.requireRequest(personId, requestId);
  }

  /** {@inheritDoc IntakeStore.loadParseRequest} */
  public async loadParseRequest(job: IntakeJob): Promise<IntakeParseRequest> {
    const request = await this.database.db.query.intakeRequests.findFirst({
      where: and(
        eq(intakeRequests.id, job.requestId),
        eq(intakeRequests.personId, job.personId)
      )
    });
    if (!request) {
      throw new NotFoundError("Intake request was not found");
    }
    return {
      requestId: request.id,
      personId: request.personId,
      text: request.originalText,
      locale: request.locale,
      timezone: request.timezone
    };
  }

  /** {@inheritDoc IntakeStore.loadClarificationRequest} */
  public async loadClarificationRequest(
    job: IntakeJob
  ): Promise<IntakeClarificationRequest> {
    if (!job.itemId) {
      throw new Error("Clarification job has no item");
    }
    const request = await this.loadParseRequest(job);
    const item = await this.database.db.query.intakeItems.findFirst({
      where: and(
        eq(intakeItems.id, job.itemId),
        eq(intakeItems.requestId, job.requestId),
        eq(intakeItems.personId, job.personId)
      )
    });
    if (!item?.clarificationAnswer) {
      throw new Error("Clarification answer was not found");
    }
    return {
      ...request,
      itemId: job.itemId,
      answer: item.clarificationAnswer
    };
  }

  /** {@inheritDoc IntakeStore.claimNextJob} */
  public claimNextJob(leaseMs: number): Promise<IntakeJob | null> {
    return this.database.db.transaction(async (transaction) => {
      const now = new Date();
      const exhausted = await transaction
        .select()
        .from(intakeJobs)
        .where(
          and(
            eq(intakeJobs.status, "leased"),
            sql`${intakeJobs.leasedUntil} <= now()`,
            sql`${intakeJobs.attempts} >= ${intakeJobs.maxAttempts}`
          )
        );
      for (const expired of exhausted) {
        if (!expired.leaseToken) {
          continue;
        }
        const terminal = await transaction
          .update(intakeJobs)
          .set({
            status: "dead",
            leasedUntil: null,
            leaseToken: null,
            errorCode: "LEASE_EXPIRED",
            updatedAt: now
          })
          .where(
            and(
              eq(intakeJobs.id, expired.id),
              eq(intakeJobs.status, "leased"),
              eq(intakeJobs.leaseToken, expired.leaseToken)
            )
          )
          .returning({ id: intakeJobs.id });
        if (!terminal[0]) {
          continue;
        }
        if (expired.kind === "parse_request") {
          await transaction
            .update(intakeRequests)
            .set({
              parsingStatus: "failed",
              failureCode: "LEASE_EXPIRED",
              updatedAt: now
            })
            .where(eq(intakeRequests.id, expired.requestId));
        } else if (expired.itemId) {
          await transaction
            .update(intakeItems)
            .set({ status: "failed", updatedAt: now })
            .where(eq(intakeItems.id, expired.itemId));
        }
        await appendTimeline(transaction, {
          personId: expired.personId,
          requestId: expired.requestId,
          itemId: expired.itemId,
          event: "failed",
          detailCode: "LEASE_EXPIRED"
        });
      }
      await transaction
        .update(intakeJobs)
        .set({
          status: "available",
          leasedUntil: null,
          leaseToken: null,
          availableAt: sql`now()`,
          updatedAt: now
        })
        .where(
          and(
            eq(intakeJobs.status, "leased"),
            sql`${intakeJobs.leasedUntil} <= now()`,
            sql`${intakeJobs.attempts} < ${intakeJobs.maxAttempts}`
          )
        );

      const selected = await transaction.execute<{ id: string }>(sql`
        select ${intakeJobs.id} as id
          from ${intakeJobs}
         where ${intakeJobs.status} = 'available'
           and ${intakeJobs.availableAt} <= now()
           and ${intakeJobs.attempts} < ${intakeJobs.maxAttempts}
         order by ${intakeJobs.availableAt}, ${intakeJobs.createdAt}, ${intakeJobs.id}
         for update skip locked
         limit 1
      `);
      const selectedId = selected.rows[0]?.id;
      if (!selectedId) {
        return null;
      }

      const leaseToken = randomUUID();
      const leasedUntil = new Date(now.valueOf() + leaseMs);
      const rows = await transaction
        .update(intakeJobs)
        .set({
          status: "leased",
          leaseToken,
          leasedUntil,
          attempts: sql`${intakeJobs.attempts} + 1`,
          updatedAt: now
        })
        .where(eq(intakeJobs.id, selectedId))
        .returning();
      const job = rows[0];
      if (!job) {
        return null;
      }

      if (job.kind === "parse_request") {
        await transaction
          .update(intakeRequests)
          .set({ parsingStatus: "processing", updatedAt: now })
          .where(eq(intakeRequests.id, job.requestId));
        await appendTimeline(transaction, {
          personId: job.personId,
          requestId: job.requestId,
          event: "parsing_started"
        });
      } else if (job.itemId) {
        await transaction
          .update(intakeItems)
          .set({ status: "processing", updatedAt: now })
          .where(eq(intakeItems.id, job.itemId));
        if (job.kind === "route_item") {
          await appendTimeline(transaction, {
            personId: job.personId,
            requestId: job.requestId,
            itemId: job.itemId,
            event: "routing_started"
          });
        }
      }
      return this.toJob(job, leaseToken);
    });
  }

  /** {@inheritDoc IntakeStore.completeParse} */
  public async completeParse(
    job: IntakeJob,
    parsedItems: readonly ParsedIntakeItem[]
  ): Promise<void> {
    if (job.kind !== "parse_request") {
      throw new Error("Expected a parse_request job");
    }
    parsedItems.forEach(validateParsedItem);
    await this.database.db.transaction(async (transaction) => {
      await this.requireLease(transaction, job);
      for (const [position, parsed] of parsedItems.entries()) {
        const itemId = randomUUID();
        await transaction.insert(intakeItems).values({
          id: itemId,
          requestId: job.requestId,
          personId: job.personId,
          position,
          kind: parsed.kind,
          status: parsed.status,
          confidence:
            parsed.confidence === null
              ? null
              : parsed.confidence.toFixed(3),
          clarificationQuestion:
            parsed.status === "needs_clarification"
              ? parsed.clarificationQuestion
              : null
        });
        if (parsed.status === "awaiting_confirmation") {
          await transaction.insert(intakeWeightDetails).values({
            itemId,
            personId: job.personId,
            measuredAt: new Date(parsed.measuredAt),
            timezone: parsed.timezone,
            weightKg: parsed.weightKg.toFixed(3),
            dedupeKey: parsed.dedupeKey
          });
        } else {
          await appendTimeline(transaction, {
            personId: job.personId,
            requestId: job.requestId,
            itemId,
            event: "clarification_requested"
          });
        }
      }
      await transaction
        .update(intakeRequests)
        .set({ parsingStatus: "parsed", failureCode: null, updatedAt: new Date() })
        .where(eq(intakeRequests.id, job.requestId));
      await this.completeJob(transaction, job);
      await appendTimeline(transaction, {
        personId: job.personId,
        requestId: job.requestId,
        event: "items_parsed"
      });
    });
  }

  /** {@inheritDoc IntakeStore.completeClarification} */
  public async completeClarification(
    job: IntakeJob,
    parsedItem: ParsedIntakeItem
  ): Promise<void> {
    if (job.kind !== "parse_clarification" || !job.itemId) {
      throw new Error("Expected a parse_clarification job");
    }
    const itemId = job.itemId;
    validateParsedItem(parsedItem);
    await this.database.db.transaction(async (transaction) => {
      await this.requireLease(transaction, job);
      await transaction
        .update(intakeItems)
        .set({
          status: parsedItem.status,
          confidence:
            parsedItem.confidence === null
              ? null
              : parsedItem.confidence.toFixed(3),
          clarificationQuestion:
            parsedItem.status === "needs_clarification"
              ? parsedItem.clarificationQuestion
              : null,
          updatedAt: new Date()
        })
        .where(eq(intakeItems.id, itemId));
      if (parsedItem.status === "awaiting_confirmation") {
        await transaction
          .insert(intakeWeightDetails)
          .values({
            itemId,
            personId: job.personId,
            measuredAt: new Date(parsedItem.measuredAt),
            timezone: parsedItem.timezone,
            weightKg: parsedItem.weightKg.toFixed(3),
            dedupeKey: parsedItem.dedupeKey
          })
          .onConflictDoUpdate({
            target: intakeWeightDetails.itemId,
            set: {
              measuredAt: new Date(parsedItem.measuredAt),
              timezone: parsedItem.timezone,
              weightKg: parsedItem.weightKg.toFixed(3),
              dedupeKey: parsedItem.dedupeKey
            }
          });
      } else {
        await appendTimeline(transaction, {
          personId: job.personId,
          requestId: job.requestId,
          itemId,
          event: "clarification_requested"
        });
      }
      await this.completeJob(transaction, job);
    });
  }

  /** {@inheritDoc IntakeStore.routeWeight} */
  public async routeWeight(job: IntakeJob): Promise<void> {
    if (job.kind !== "route_item" || !job.itemId) {
      throw new Error("Expected a route_item job");
    }
    const itemId = job.itemId;
    await this.database.db.transaction(async (transaction) => {
      await this.requireLease(transaction, job);
      const rows = await transaction
        .select({
          item: intakeItems,
          detail: intakeWeightDetails,
          request: intakeRequests,
          sourceReference: sourceReferences
        })
        .from(intakeItems)
        .innerJoin(
          intakeWeightDetails,
          eq(intakeItems.id, intakeWeightDetails.itemId)
        )
        .innerJoin(
          intakeRequests,
          eq(intakeItems.requestId, intakeRequests.id)
        )
        .innerJoin(
          sourceReferences,
          eq(intakeRequests.sourceReferenceId, sourceReferences.id)
        )
        .where(
          and(
            eq(intakeItems.id, itemId),
            eq(intakeItems.personId, job.personId)
          )
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new Error("Typed Intake weight item could not be loaded");
      }
      if (row.sourceReference.channel === "device") {
        throw new DomainValidationError("Device source is not supported by Intake");
      }
      const input: CreateWeightMeasurement = {
        measuredAt: row.detail.measuredAt.toISOString(),
        timezone: row.detail.timezone,
        weightKg: Number(row.detail.weightKg),
        dedupeKey: row.detail.dedupeKey,
        confidence:
          row.item.confidence === null ? null : Number(row.item.confidence),
        sourceReference: {
          channel: row.sourceReference.channel,
          externalSystem: row.sourceReference.externalSystem,
          externalRecordId: row.sourceReference.externalRecordId,
          occurredAt: row.sourceReference.occurredAt?.toISOString() ?? null
        }
      };
      const result = await createWeightMeasurementInTransaction(
        transaction,
        job.personId,
        input,
        row.sourceReference
      );
      await transaction
        .update(intakeWeightDetails)
        .set({ measurementId: result.measurement.id })
        .where(eq(intakeWeightDetails.itemId, itemId));
      await transaction
        .update(intakeItems)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(intakeItems.id, itemId));
      await this.completeJob(transaction, job);
      await appendTimeline(transaction, {
        personId: job.personId,
        requestId: job.requestId,
        itemId,
        event: "completed"
      });
    });
  }

  /** {@inheritDoc IntakeStore.failJob} */
  public async failJob(
    job: IntakeJob,
    errorCode: string,
    retryDelayMs: number
  ): Promise<void> {
    await this.database.db.transaction(async (transaction) => {
      await this.requireLease(transaction, job);
      const terminal = job.attempts >= job.maxAttempts;
      const now = new Date();
      await transaction
        .update(intakeJobs)
        .set({
          status: terminal ? "dead" : "available",
          errorCode,
          availableAt: terminal
            ? sql`now()`
            : sql`now() + (${retryDelayMs} * interval '1 millisecond')`,
          leasedUntil: null,
          leaseToken: null,
          updatedAt: now
        })
        .where(eq(intakeJobs.id, job.id));

      if (job.kind === "parse_request") {
        await transaction
          .update(intakeRequests)
          .set({
            parsingStatus: terminal ? "failed" : "queued",
            failureCode: terminal ? errorCode : null,
            updatedAt: now
          })
          .where(eq(intakeRequests.id, job.requestId));
      } else if (job.itemId) {
        await transaction
          .update(intakeItems)
          .set({ status: terminal ? "failed" : "queued", updatedAt: now })
          .where(eq(intakeItems.id, job.itemId));
      }
      await appendTimeline(transaction, {
        personId: job.personId,
        requestId: job.requestId,
        itemId: job.itemId,
        event: terminal ? "failed" : "retry_scheduled",
        detailCode: errorCode
      });
    });
  }

  private async requireRequest(
    personId: string,
    requestId: string
  ): Promise<IntakeRequest> {
    const request = await this.find(personId, requestId);
    if (!request) {
      throw new NotFoundError("Intake request was not found");
    }
    return request;
  }

  private toJob(row: IntakeJobRow, leaseToken: string): IntakeJob {
    return {
      id: row.id,
      personId: row.personId,
      requestId: row.requestId,
      itemId: row.itemId,
      kind: row.kind,
      leaseToken,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts
    };
  }

  private async requireLease(
    transaction: DatabaseTransaction,
    job: IntakeJob
  ): Promise<IntakeJobRow> {
    const row = await transaction.query.intakeJobs.findFirst({
      where: and(
        eq(intakeJobs.id, job.id),
        eq(intakeJobs.status, "leased"),
        eq(intakeJobs.leaseToken, job.leaseToken)
      )
    });
    if (!row) {
      throw new ConflictError("Intake job lease is no longer active");
    }
    return row;
  }

  private async completeJob(
    transaction: DatabaseTransaction,
    job: IntakeJob
  ): Promise<void> {
    await transaction
      .update(intakeJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        leasedUntil: null,
        leaseToken: null,
        errorCode: null,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(intakeJobs.id, job.id),
          eq(intakeJobs.leaseToken, job.leaseToken)
        )
      );
  }
}
