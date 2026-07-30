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
    .withDatabase("shape_of_you_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();

  const databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);

  const config: AppConfig = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3_000,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent",
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
  });

  it("creates, reads and deduplicates a measurement", async () => {
    const payload = {
      measuredAt: "2026-07-28T05:30:00.000Z",
      timezone: "Europe/Moscow",
      weightKg: 82.125,
      source: "manual",
      dedupeKey: "integration:create-read",
      provenance: { channel: "integration-test" }
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
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json().id).toBe(created.json().id);
    expect(read.statusCode).toBe(200);
    expect(read.json().id).toBe(created.json().id);
    expect(count.rows[0]?.count).toBe("1");
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
          source: "import",
          sourceRecordId: `row-${index}`,
          dedupeKey: `integration:list:${index}`,
          confidence: 0.9,
          provenance: { fixture: true }
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
});
