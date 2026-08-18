import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";

import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_progress_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  const databaseUrl = container.getConnectionUri();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = "00000000-0000-4000-8000-000000000001";
  await runMigrations(databaseUrl);
  const config: AppConfig = {
    NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3_000, DATABASE_URL: databaseUrl, LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic", SYNTHETIC_PERSON_ID: "00000000-0000-4000-8000-000000000001", SHUTDOWN_TIMEOUT_MS: 1_000
  };
  database = createDatabase(config);
  app = await buildApp({ config, database });
});

afterAll(async () => { await app?.close(); await database?.pool.end(); await container?.stop(); });

describe("ProgressOverview PostgreSQL read model", () => {
  it("returns only current facts inside the inclusive range", async () => {
    const fastify = getFastifyInstance(app);
    const createWeight = (measuredAt: string, weightKg: number, dedupeKey: string) => fastify.inject({
      method: "POST", url: "/v1/weight-measurements", payload: {
        measuredAt, timezone: "UTC", weightKg, dedupeKey,
        sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: measuredAt }
      }
    });
    const original = await createWeight("2026-08-17T08:00:00.000Z", 80, "progress:weight:1");
    expect(original.statusCode, original.body).toBe(201);
    const corrected = await fastify.inject({
      method: "POST", url: `/v1/weight-measurements/${original.json().id as string}/corrections`, payload: {
        measuredAt: "2026-08-17T20:00:00.000Z", timezone: "UTC", weightKg: 79.5, dedupeKey: "progress:weight:2", reason: "corrected reading",
        sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: "2026-08-17T20:00:00.000Z" }
      }
    });
    expect(corrected.statusCode, corrected.body).toBe(201);
    expect((await createWeight("2026-08-01T08:00:00.000Z", 81, "progress:outside")).statusCode).toBe(201);

    const response = await fastify.inject({ method: "GET", url: "/v1/progress-overview?from=2026-08-16&to=2026-08-18&timezone=UTC" });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.metrics.find((metric: { key: string }) => metric.key === "weight_kg").points).toEqual([{ localDate: "2026-08-17", value: 79.5 }]);
    expect(body.days).toHaveLength(1);
    expect(body.days[0]).toMatchObject({ localDate: "2026-08-17", facts: { weightMeasurements: 1 } });
  });
});
