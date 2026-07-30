import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";
import type { CreateWeightMeasurement } from "@shape-of-you/contracts";

import { buildApp, getFastifyInstance } from "../src/app.js";
import {
  createDatabase,
  type DatabaseContext
} from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { WeightMeasurementRepository } from "../src/storage/weight-measurement-repository.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
const syntheticPersonId = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();

  const databaseUrl = container.getConnectionUri();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = syntheticPersonId;
  await runMigrations(databaseUrl);

  const config: AppConfig = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3_000,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: syntheticPersonId,
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

describe("WeightMeasurement PostgreSQL vertical", () => {
  it("applies migrations to a clean database", async () => {
    const result = await database.pool.query<{ relation: string | null }>(
      "select to_regclass('public.weight_measurements')::text as relation"
    );
    expect(result.rows[0]?.relation).toBe("weight_measurements");
    const person = await database.pool.query<{
      kind: string;
      status: string;
    }>(
      "select kind, status from persons where id = $1",
      [syntheticPersonId]
    );
    expect(person.rows[0]).toEqual({
      kind: "synthetic",
      status: "active"
    });
  });

  it("upgrades a legacy fact without losing its provenance", async () => {
    await database.pool.query("create database shape_of_you_upgrade");
    const upgradeUrl = new URL(container.getConnectionUri());
    upgradeUrl.pathname = "/shape_of_you_upgrade";
    const upgradePool = new Pool({
      connectionString: upgradeUrl.toString()
    });
    const legacySql = await readFile(
      new URL(
        "../drizzle/20260728183725_real_vermin.sql",
        import.meta.url
      ),
      "utf8"
    );
    const upgradeSql = await readFile(
      new URL(
        "../drizzle/20260730131840_person_identity_provenance_corrections.sql",
        import.meta.url
      ),
      "utf8"
    );

    try {
      for (const statement of legacySql.split("--> statement-breakpoint")) {
        if (statement.trim()) {
          await upgradePool.query(statement);
        }
      }
      await upgradePool.query(
        `insert into weight_measurements (
           measured_at, local_date, timezone, weight_kg, source,
           source_record_id, dedupe_key, provenance
         ) values (
           '2026-07-27T06:00:00Z', '2026-07-27', 'UTC', 83.125,
           'google_sheets', 'sheet-row-1', 'legacy:1',
           '{"sheet":"legacy-fixture"}'::jsonb
         )`
      );
      for (const statement of upgradeSql.split("--> statement-breakpoint")) {
        if (statement.trim()) {
          await upgradePool.query(statement);
        }
      }

      const migrated = await upgradePool.query<{
        person_id: string;
        external_system: string;
        external_record_id: string;
        raw_snapshot: { sheet: string };
      }>(
        `select wm.person_id, sr.external_system, sr.external_record_id,
                sr.raw_snapshot
           from weight_measurements wm
           join source_references sr on sr.id = wm.source_reference_id
          where wm.dedupe_key = 'legacy:1'`
      );
      const oldColumns = await upgradePool.query<{ count: string }>(
        `select count(*)::text as count
           from information_schema.columns
          where table_name = 'weight_measurements'
            and column_name in ('source_record_id', 'provenance')`
      );

      expect(migrated.rows[0]).toEqual({
        person_id: syntheticPersonId,
        external_system: "legacy",
        external_record_id: "sheet-row-1",
        raw_snapshot: { sheet: "legacy-fixture" }
      });
      expect(oldColumns.rows[0]?.count).toBe("0");
    } finally {
      await upgradePool.end();
    }
  });

  it("creates, reads and deduplicates a measurement", async () => {
    const payload = {
      measuredAt: "2026-07-28T05:30:00.000Z",
      timezone: "Europe/Moscow",
      weightKg: 82.125,
      dedupeKey: "integration:create-read",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-07-28T05:30:00.000Z"
      }
    };

    const fastify = getFastifyInstance(app);
    const created = await fastify.inject({
      method: "POST",
      url: "/v1/weight-measurements",
      payload
    });
    const duplicate = await fastify.inject({
      method: "POST",
      url: "/v1/weight-measurements",
      payload
    });
    const read = await fastify.inject({
      method: "GET",
      url: `/v1/weight-measurements/${created.json().id as string}`
    });
    const count = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from weight_measurements where dedupe_key = $1",
      [payload.dedupeKey]
    );

    expect(created.statusCode).toBe(201);
    expect(created.json().localDate).toBe("2026-07-28");
    expect(created.json().personId).toBe(syntheticPersonId);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().id).toBe(created.json().id);
    expect(read.statusCode).toBe(200);
    expect(read.json().id).toBe(created.json().id);
    expect(count.rows[0]?.count).toBe("1");
  });

  it("serializes concurrent retries into one fact", async () => {
    const payload = {
      measuredAt: "2026-07-28T07:00:00.000Z",
      timezone: "UTC",
      weightKg: 81.75,
      dedupeKey: "integration:concurrent-create",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-07-28T07:00:00.000Z"
      }
    };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        getFastifyInstance(app).inject({
          method: "POST",
          url: "/v1/weight-measurements",
          payload
        })
      )
    );

    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(
      1
    );
    expect(
      new Set(responses.map((response) => response.json().id as string)).size
    ).toBe(1);
  });

  it("lists with a stable cursor order", async () => {
    const fastify = getFastifyInstance(app);
    for (const [index, measuredAt] of [
      "2026-07-29T06:00:00.000Z",
      "2026-07-30T06:00:00.000Z",
      "2026-07-31T06:00:00.000Z"
    ].entries()) {
      const response = await fastify.inject({
        method: "POST",
        url: "/v1/weight-measurements",
        payload: {
          measuredAt,
          timezone: "UTC",
          weightKg: 80 + index,
          dedupeKey: `integration:list:${index}`,
          confidence: 0.9,
          sourceReference: {
            channel: "import",
            externalSystem: "integration-fixture",
            externalRecordId: `row-${index}`,
            occurredAt: measuredAt
          }
        }
      });
      expect(response.statusCode).toBe(201);
    }

    const firstPage = await fastify.inject({
      method: "GET",
      url: "/v1/weight-measurements?limit=2"
    });
    const firstBody = firstPage.json();
    const secondPage = await fastify.inject({
      method: "GET",
      url: `/v1/weight-measurements?limit=2&cursor=${encodeURIComponent(
        firstBody.nextCursor as string
      )}`
    });
    const combined = [...firstBody.items, ...secondPage.json().items];
    const instants = combined.map(
      (item: { measuredAt: string }) => item.measuredAt
    );

    expect(firstPage.statusCode).toBe(200);
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).toEqual(expect.any(String));
    expect(secondPage.statusCode).toBe(200);
    expect(instants).toEqual([...instants].sort().reverse());
    expect(new Set(combined.map((item: { id: string }) => item.id)).size).toBe(
      combined.length
    );
  });

  it("scopes deduplication to Person and source channel", async () => {
    const secondPersonId = "00000000-0000-4000-8000-000000000002";
    await database.pool.query(
      "insert into persons (id, kind) values ($1, 'synthetic')",
      [secondPersonId]
    );
    const input: CreateWeightMeasurement = {
      measuredAt: "2026-08-01T06:00:00.000Z",
      timezone: "UTC",
      weightKg: 79.5,
      dedupeKey: "integration:person-scope",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-08-01T06:00:00.000Z"
      }
    };
    const repository = new WeightMeasurementRepository(database);

    const first = await repository.create(syntheticPersonId, input);
    const second = await repository.create(secondPersonId, input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(first.measurement.personId).toBe(syntheticPersonId);
    expect(second.measurement.personId).toBe(secondPersonId);

    const crossPersonRead = await getFastifyInstance(app).inject({
      method: "GET",
      url: `/v1/weight-measurements/${second.measurement.id}`
    });
    expect(crossPersonRead.statusCode).toBe(404);
  });

  it("persists many-to-many User access grants independently of facts", async () => {
    const personId = "00000000-0000-4000-8000-000000000003";
    const firstUserId = "00000000-0000-4000-8000-000000000011";
    const secondUserId = "00000000-0000-4000-8000-000000000012";
    await database.pool.query(
      "insert into persons (id) values ($1)",
      [personId]
    );
    await database.pool.query(
      "insert into users (id) values ($1), ($2)",
      [firstUserId, secondUserId]
    );
    await database.pool.query(
      `insert into person_access_grants (person_id, user_id, role)
       values
         ($1, $2, 'owner'),
         ($3, $2, 'coach'),
         ($1, $4, 'coach')`,
      [syntheticPersonId, firstUserId, personId, secondUserId]
    );
    const grants = await database.pool.query<{
      person_count: string;
      user_count: string;
    }>(
      `select count(distinct person_id)::text as person_count,
              count(distinct user_id)::text as user_count
         from person_access_grants
        where user_id in ($1, $2)`,
      [firstUserId, secondUserId]
    );

    expect(grants.rows[0]).toEqual({
      person_count: "2",
      user_count: "2"
    });
  });

  it("appends corrections and exposes current state plus full history", async () => {
    const fastify = getFastifyInstance(app);
    const original = await fastify.inject({
      method: "POST",
      url: "/v1/weight-measurements",
      payload: {
        measuredAt: "2026-08-02T06:00:00.000Z",
        timezone: "UTC",
        weightKg: 79.25,
        dedupeKey: "integration:correction:original",
        sourceReference: {
          channel: "manual",
          externalSystem: null,
          externalRecordId: null,
          occurredAt: "2026-08-02T06:00:00.000Z"
        }
      }
    });
    const originalBody = original.json();
    const correctionPayload = {
      measuredAt: "2026-08-02T06:00:00.000Z",
      timezone: "UTC",
      weightKg: 78.95,
      dedupeKey: "integration:correction:replacement",
      reason: "Scale value was transcribed incorrectly",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-08-02T06:00:00.000Z"
      }
    };
    const corrected = await fastify.inject({
      method: "POST",
      url: `/v1/weight-measurements/${originalBody.id as string}/corrections`,
      payload: correctionPayload
    });
    const correctedBody = corrected.json();
    const retry = await fastify.inject({
      method: "POST",
      url: `/v1/weight-measurements/${originalBody.id as string}/corrections`,
      payload: correctionPayload
    });
    const conflicting = await fastify.inject({
      method: "POST",
      url: `/v1/weight-measurements/${originalBody.id as string}/corrections`,
      payload: {
        ...correctionPayload,
        dedupeKey: "integration:correction:other"
      }
    });
    const originalRead = await fastify.inject({
      method: "GET",
      url: `/v1/weight-measurements/${originalBody.id as string}`
    });
    const history = await fastify.inject({
      method: "GET",
      url: `/v1/weight-measurements/${correctedBody.id as string}/history`
    });
    const current = await fastify.inject({
      method: "GET",
      url: "/v1/weight-measurements?limit=100"
    });
    const currentIds = current
      .json()
      .items.map((item: { id: string }) => item.id);

    expect(original.statusCode).toBe(201);
    expect(corrected.statusCode).toBe(201);
    expect(correctedBody.supersedesId).toBe(originalBody.id);
    expect(correctedBody.correctionReason).toBe(correctionPayload.reason);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(correctedBody.id);
    expect(conflicting.statusCode).toBe(409);
    expect(originalRead.json().weightKg).toBe(79.25);
    expect(history.statusCode).toBe(200);
    expect(
      history.json().items.map((item: { id: string }) => item.id)
    ).toEqual([originalBody.id, correctedBody.id]);
    expect(currentIds).not.toContain(originalBody.id);
    expect(currentIds).toContain(correctedBody.id);
    expect(correctedBody.sourceReference).not.toHaveProperty("rawSnapshot");
  });
});
