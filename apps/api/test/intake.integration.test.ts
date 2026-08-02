import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";
import type { CreateIntakeRequest } from "@shape-of-you/contracts";

import { buildApp, getFastifyInstance } from "../src/app.js";
import {
  createDatabase,
  type DatabaseContext
} from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import type {
  IntakeClarificationRequest,
  IntakeParser,
  ParsedIntakeItem
} from "../src/domain/intake.js";
import { IntakeWorker } from "../src/intake/intake.worker.js";
import {
  IntakeRepository,
  type IntakeJob
} from "../src/storage/intake-repository.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
let repository: IntakeRepository;
let worker: IntakeWorker;

const personId = "00000000-0000-4000-8000-000000000001";

const requestPayload = {
  text: "Вес 82.4 кг. Вчера весил примерно восемьдесят один.",
  locale: "ru-RU",
  timezone: "Europe/Moscow",
  idempotencyKey: "intake:integration:message-1",
  sourceReference: {
    channel: "manual",
    externalSystem: null,
    externalRecordId: null,
    occurredAt: "2026-08-02T06:00:00.000Z"
  }
} satisfies CreateIntakeRequest;

class SyntheticParser implements IntakeParser {
  public async parse(): Promise<readonly ParsedIntakeItem[]> {
    return [
      {
        kind: "weight_measurement",
        status: "awaiting_confirmation",
        confidence: 0.99,
        measuredAt: "2026-08-02T06:00:00.000Z",
        timezone: "Europe/Moscow",
        weightKg: 82.4,
        dedupeKey: "intake:weight:message-1:0"
      },
      {
        kind: "weight_measurement",
        status: "needs_clarification",
        confidence: 0.45,
        clarificationQuestion: "Какой точный вес нужно записать?"
      }
    ];
  }

  public async clarify(
    request: IntakeClarificationRequest
  ): Promise<ParsedIntakeItem> {
    expect(request.answer).toBe("81.2 кг");
    return {
      kind: "weight_measurement",
      status: "awaiting_confirmation",
      confidence: 0.98,
      measuredAt: "2026-08-01T06:00:00.000Z",
      timezone: request.timezone,
      weightKg: 81.2,
      dedupeKey: "intake:weight:message-1:1"
    };
  }
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_intake_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  const databaseUrl = container.getConnectionUri();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = personId;
  await runMigrations(databaseUrl);

  const config: AppConfig = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3_000,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: personId,
    SHUTDOWN_TIMEOUT_MS: 1_000
  };
  database = createDatabase(config);
  repository = new IntakeRepository(database);
  worker = new IntakeWorker(repository, new SyntheticParser());
  app = await buildApp({ config, database });
});

afterAll(async () => {
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

describe("Intake PostgreSQL queue", () => {
  it("creates the typed queue schema from the migration chain", async () => {
    const relations = await database.pool.query<{
      requests: string | null;
      items: string | null;
      jobs: string | null;
      timeline: string | null;
      weight_details: string | null;
    }>(
      `select
         to_regclass('public.intake_requests')::text as requests,
         to_regclass('public.intake_items')::text as items,
         to_regclass('public.intake_jobs')::text as jobs,
         to_regclass('public.intake_timeline_entries')::text as timeline,
         to_regclass('public.intake_weight_details')::text as weight_details`
    );
    expect(relations.rows[0]).toEqual({
      requests: "intake_requests",
      items: "intake_items",
      jobs: "intake_jobs",
      timeline: "intake_timeline_entries",
      weight_details: "intake_weight_details"
    });
  });

  it("deduplicates input, clarifies one item and routes siblings independently", async () => {
    const fastify = getFastifyInstance(app);
    const accepted = await Promise.all(
      Array.from({ length: 6 }, () =>
        fastify.inject({
          method: "POST",
          url: "/v1/intake/requests",
          payload: requestPayload
        })
      )
    );
    const requestIds = new Set(
      accepted.map((response) => response.json().id as string)
    );
    expect(accepted.every((response) => response.statusCode === 202)).toBe(true);
    expect(requestIds.size).toBe(1);
    const requestId = [...requestIds][0] as string;

    expect(await worker.processNext()).toBe(true);
    const parsed = await fastify.inject({
      method: "GET",
      url: `/v1/intake/requests/${requestId}`
    });
    expect(parsed.statusCode).toBe(200);
    expect(parsed.json().status).toBe("awaiting_action");
    expect(parsed.json().items).toHaveLength(2);
    expect(parsed.json().items[0].status).toBe("awaiting_confirmation");
    expect(parsed.json().items[1].status).toBe("needs_clarification");
    const firstItemId = parsed.json().items[0].id as string;
    const secondItemId = parsed.json().items[1].id as string;

    const clarificationPayload = {
      answer: "81.2 кг",
      idempotencyKey: "intake:clarification:message-1:1"
    };
    const clarification = await fastify.inject({
      method: "POST",
      url: `/v1/intake/requests/${requestId}/items/${secondItemId}/clarification`,
      payload: clarificationPayload
    });
    const clarificationRetry = await fastify.inject({
      method: "POST",
      url: `/v1/intake/requests/${requestId}/items/${secondItemId}/clarification`,
      payload: clarificationPayload
    });
    expect(clarification.statusCode).toBe(202);
    expect(clarificationRetry.statusCode).toBe(202);
    expect(await worker.processNext()).toBe(true);

    const decisionPayload = {
      decision: "confirm",
      idempotencyKey: "intake:decision:message-1:0"
    };
    const decisions = await Promise.all(
      Array.from({ length: 4 }, () =>
        fastify.inject({
          method: "POST",
          url: `/v1/intake/requests/${requestId}/items/${firstItemId}/decision`,
          payload: decisionPayload
        })
      )
    );
    expect(decisions.every((response) => response.statusCode === 202)).toBe(true);
    expect(await worker.processNext()).toBe(true);

    const partial = await fastify.inject({
      method: "GET",
      url: `/v1/intake/requests/${requestId}`
    });
    expect(partial.json().status).toBe("partial");
    expect(partial.json().items[0].status).toBe("completed");
    expect(partial.json().items[1].status).toBe("awaiting_confirmation");

    const secondDecision = await fastify.inject({
      method: "POST",
      url: `/v1/intake/requests/${requestId}/items/${secondItemId}/decision`,
      payload: {
        decision: "confirm",
        idempotencyKey: "intake:decision:message-1:1"
      }
    });
    expect(secondDecision.statusCode).toBe(202);
    expect(await worker.processNext()).toBe(true);

    const completed = await fastify.inject({
      method: "GET",
      url: `/v1/intake/requests/${requestId}`
    });
    const weights = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from weight_measurements
        where dedupe_key like 'intake:weight:message-1:%'`
    );
    const jobs = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from intake_jobs
        where request_id = $1 and kind = 'route_item'`,
      [requestId]
    );
    expect(completed.json().status).toBe("completed");
    expect(
      completed.json().items.every(
        (item: { status: string; detail: { measurementId: string } }) =>
          item.status === "completed" && Boolean(item.detail.measurementId)
      )
    ).toBe(true);
    expect(weights.rows[0]?.count).toBe("2");
    expect(jobs.rows[0]?.count).toBe("2");
  });

  it("leases one job to only one concurrent worker and reclaims an expired lease", async () => {
    const claimRequest = await repository.create(personId, {
      ...requestPayload,
      text: "Вес для проверки блокировки",
      idempotencyKey: "intake:integration:claim"
    });
    const claims = await Promise.all([
      repository.claimNextJob(30_000),
      repository.claimNextJob(30_000)
    ]);
    const leased = claims.filter((job): job is IntakeJob => job !== null);
    expect(leased).toHaveLength(1);
    expect(leased[0]?.requestId).toBe(claimRequest.request.id);

    await database.pool.query(
      "update intake_jobs set leased_until = now() - interval '1 second' where id = $1",
      [leased[0]?.id]
    );
    const reclaimed = await repository.claimNextJob(30_000);
    expect(reclaimed?.id).toBe(leased[0]?.id);
    expect(reclaimed?.attempts).toBe(2);
    await repository.completeParse(reclaimed as IntakeJob, []);
  });

  it("moves exhausted work to a safe terminal failure without storing source text", async () => {
    const failed = await repository.create(personId, {
      ...requestPayload,
      text: "Секретный исходный текст не должен попасть в диагностику",
      idempotencyKey: "intake:integration:terminal-failure"
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const job = await repository.claimNextJob(30_000);
      expect(job?.requestId).toBe(failed.request.id);
      await repository.failJob(job as IntakeJob, "PARSER_UNAVAILABLE", 0);
    }
    const projection = await repository.find(personId, failed.request.id);
    const diagnostics = await database.pool.query<{
      error_code: string | null;
      detail_code: string | null;
    }>(
      `select j.error_code, t.detail_code
         from intake_jobs j
         join intake_timeline_entries t on t.request_id = j.request_id
        where j.request_id = $1 and t.event = 'failed'`,
      [failed.request.id]
    );
    expect(projection?.status).toBe("failed");
    expect(projection?.failureCode).toBe("PARSER_UNAVAILABLE");
    expect(diagnostics.rows).toEqual([
      {
        error_code: "PARSER_UNAVAILABLE",
        detail_code: "PARSER_UNAVAILABLE"
      }
    ]);
  });

  it("keeps requests isolated by Person", async () => {
    const otherPersonId = "00000000-0000-4000-8000-000000000099";
    await database.pool.query(
      "insert into persons (id, kind) values ($1, 'synthetic')",
      [otherPersonId]
    );
    const other = await repository.create(otherPersonId, {
      ...requestPayload,
      idempotencyKey: "intake:integration:other-person"
    });
    const response = await getFastifyInstance(app).inject({
      method: "GET",
      url: `/v1/intake/requests/${other.request.id}`
    });
    expect(response.statusCode).toBe(404);
  });
});
