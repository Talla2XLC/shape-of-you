import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";

import { buildApp, getFastifyInstance } from "../src/app.js";
import {
  createDatabase,
  type DatabaseContext
} from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_day_closure_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  const databaseUrl = container.getConnectionUri();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = "00000000-0000-4000-8000-000000000001";
  await runMigrations(databaseUrl);
  const config: AppConfig = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3_000,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: "00000000-0000-4000-8000-000000000001",
    SHUTDOWN_TIMEOUT_MS: 1_000
  };
  database = createDatabase(config);
  app = await buildApp({ config, database });
});

afterAll(async () => {
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

describe("DayClosure PostgreSQL lifecycle", () => {
  it("keeps open projections live and closes, reopens, and recloses append-only", async () => {
    const fastify = getFastifyInstance(app);
    const query = "localDate=2026-08-12&timezone=Europe%2FMoscow";

    const open = await fastify.inject({
      method: "GET",
      url: `/v1/day-projections?${query}`
    });
    expect(open.statusCode, open.body).toBe(200);
    expect(open.json()).toMatchObject({ state: "open", closure: null, isStale: false });

    const initialWeight = await fastify.inject({
      method: "POST",
      url: "/v1/weight-measurements",
      payload: {
        measuredAt: "2026-08-12T08:00:00.000Z",
        timezone: "Europe/Moscow",
        weightKg: 82.4,
        dedupeKey: "day-closure:weight:1",
        sourceReference: {
          channel: "manual",
          externalSystem: null,
          externalRecordId: null,
          occurredAt: "2026-08-12T08:00:00.000Z"
        }
      }
    });
    expect(initialWeight.statusCode, initialWeight.body).toBe(201);

    const closePayload = {
      localDate: "2026-08-12",
      timezone: "Europe/Moscow",
      idempotencyKey: "day-closure:close:1"
    };
    const closed = await fastify.inject({
      method: "POST",
      url: "/v1/day-closures",
      payload: closePayload
    });
    expect(closed.statusCode, closed.body).toBe(201);
    expect(closed.json()).toMatchObject({
      version: 1,
      status: "active",
      source: "manual"
    });
    const firstClosureId = closed.json().id as string;

    const wrongTimezone = await fastify.inject({
      method: "GET",
      url: "/v1/day-projections?localDate=2026-08-12&timezone=UTC"
    });
    expect(wrongTimezone.statusCode, wrongTimezone.body).toBe(409);
    const wrongHistoryTimezone = await fastify.inject({
      method: "GET",
      url: "/v1/day-closures/history?localDate=2026-08-12&timezone=UTC"
    });
    expect(wrongHistoryTimezone.statusCode, wrongHistoryTimezone.body).toBe(409);

    const replay = await fastify.inject({
      method: "POST",
      url: "/v1/day-closures",
      payload: closePayload
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().id).toBe(firstClosureId);

    const correctedWeight = await fastify.inject({
      method: "POST",
      url: `/v1/weight-measurements/${initialWeight.json().id as string}/corrections`,
      payload: {
        measuredAt: "2026-08-12T08:00:00.000Z",
        timezone: "Europe/Moscow",
        weightKg: 82.4,
        dedupeKey: "day-closure:weight:2",
        reason: "source correction with the same measured value",
        sourceReference: {
          channel: "manual",
          externalSystem: null,
          externalRecordId: null,
          occurredAt: "2026-08-12T08:00:00.000Z"
        }
      }
    });
    expect(correctedWeight.statusCode, correctedWeight.body).toBe(201);
    const stale = await fastify.inject({
      method: "GET",
      url: `/v1/day-projections?${query}`
    });
    expect(stale.statusCode, stale.body).toBe(200);
    expect(stale.json()).toMatchObject({ state: "stale", isStale: true });

    const reopen = await fastify.inject({
      method: "POST",
      url: "/v1/day-closures/2026-08-12/reopen",
      payload: {
        reason: "late evidence arrived",
        idempotencyKey: "day-closure:reopen:1"
      }
    });
    expect(reopen.statusCode, reopen.body).toBe(200);
    expect(reopen.json()).toMatchObject({
      id: firstClosureId,
      status: "superseded",
      reopenReason: "late evidence arrived"
    });

    const reopened = await fastify.inject({
      method: "GET",
      url: `/v1/day-projections?${query}`
    });
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json()).toMatchObject({ state: "open", closure: null });

    const reclosed = await fastify.inject({
      method: "POST",
      url: "/v1/day-closures",
      payload: { ...closePayload, idempotencyKey: "day-closure:close:2" }
    });
    expect(reclosed.statusCode, reclosed.body).toBe(201);
    expect(reclosed.json()).toMatchObject({
      version: 2,
      status: "active",
      supersedesId: firstClosureId
    });

    const history = await fastify.inject({
      method: "GET",
      url: `/v1/day-closures/history?${query}`
    });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json().items).toHaveLength(2);
    expect(history.json().items.map((item: { version: number }) => item.version)).toEqual([2, 1]);
  });

  it("rejects invalid date contexts and conflicting idempotency payloads", async () => {
    const fastify = getFastifyInstance(app);
    const invalid = await fastify.inject({
      method: "GET",
      url: "/v1/day-projections?localDate=2026-02-30&timezone=Europe%2FMoscow"
    });
    expect(invalid.statusCode, invalid.body).toBe(400);

    const first = await fastify.inject({
      method: "POST",
      url: "/v1/day-closures",
      payload: {
        localDate: "2026-08-13",
        timezone: "Europe/Moscow",
        idempotencyKey: "day-closure:close:conflict"
      }
    });
    expect(first.statusCode, first.body).toBe(201);
    const conflicting = await fastify.inject({
      method: "POST",
      url: "/v1/day-closures",
      payload: {
        localDate: "2026-08-14",
        timezone: "Europe/Moscow",
        idempotencyKey: "day-closure:close:conflict"
      }
    });
    expect(conflicting.statusCode, conflicting.body).toBe(409);
  });
});
