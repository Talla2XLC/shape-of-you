import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";

import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { PersonFactTimelineService } from "../src/progress-overview/person-fact-timeline.service.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";
import { TrainingRepository } from "../src/storage/training-repository.js";

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
    const timeline = app.get(PersonFactTimelineService);
    expect((await timeline.read({ from: "2026-08-16", to: "2026-08-18", timezone: "UTC" })).items).toEqual([
      expect.objectContaining({ id: corrected.json().id, kind: "weight", numericValue: 79.5,
        historyPath: `/v1/weight-measurements/${corrected.json().id as string}/history` })
    ]);

    const coverageResponse = await fastify.inject({
      method: "GET",
      url: "/v1/progress-data-coverage?localDate=2026-08-19&timezone=UTC"
    });
    expect(coverageResponse.statusCode, coverageResponse.body).toBe(200);
    const coverage = coverageResponse.json();
    expect(coverage).toMatchObject({
      localDate: "2026-08-19",
      completedThrough: "2026-08-18",
      timezone: "UTC",
      policyVersion: "profile-data-coverage-v1"
    });
    expect(coverage.directions).toHaveLength(7);
    expect(coverage.directions.find((direction: { key: string }) => direction.key === "weight")).toMatchObject({
      firstDataDate: "2026-08-01",
      lastDataDate: "2026-08-17",
      freshnessDays: 2,
      coverage28: { recordedDays: 2, usableDays: 2 }
    });

    await database.pool.query(
      `update source_references source
          set evidence_purpose = 'operational_verification'
         from weight_measurements measurement
        where measurement.source_reference_id = source.id
          and measurement.person_id = source.person_id`
    );
    const filteredCoverage = await fastify.inject({
      method: "GET",
      url: "/v1/progress-data-coverage?localDate=2026-08-19&timezone=UTC"
    });
    expect(filteredCoverage.statusCode, filteredCoverage.body).toBe(200);
    expect(filteredCoverage.json().directions.find(
      (direction: { key: string }) => direction.key === "weight"
    )).toMatchObject({
      firstDataDate: null,
      lastDataDate: null,
      coverage28: { recordedDays: 0, usableDays: 0 }
    });
    expect((await timeline.read({ from: "2026-08-16", to: "2026-08-18", timezone: "UTC" })).items).toEqual([]);
  });

  it("serves a current weight insight and removes an operational-only source from its evidence", async () => {
    const fastify = getFastifyInstance(app);
    const offsets = [2, 5, 8, 12, 17, 20, 24, 27];
    const created: string[] = [];
    for (const [index, offset] of offsets.entries()) {
      const localDate = `2026-09-${String(offset).padStart(2, "0")}`;
      const measuredAt = `${localDate}T08:00:00.000Z`;
      const response = await fastify.inject({ method: "POST", url: "/v1/weight-measurements", payload: {
        measuredAt, timezone: "UTC", weightKg: index < 4 ? 80 : 79, dedupeKey: `insight:weight:${index}`,
        sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: measuredAt }
      } });
      expect(response.statusCode, response.body).toBe(201);
      created.push(response.json().id as string);
    }
    const url = "/v1/personal-insights?localDate=2026-09-29&timezone=UTC";
    const response = await fastify.inject({ method: "GET", url });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().insights.find((item: { kind: string }) => item.kind === "weight_direction")).toMatchObject({
      uncertainty: "moderate", sampleDays: 4, comparisonDays: 4,
      evidence: { weightMeasurementIds: created }
    });
    expect(response.json().suppressed).toEqual(expect.arrayContaining([
      { kind: "post_training_sleep_association", reason: "insufficient_data" }
    ]));

    const correction = await fastify.inject({ method: "POST", url: `/v1/weight-measurements/${created[7]}/corrections`, payload: {
      measuredAt: "2026-09-27T20:00:00.000Z", timezone: "UTC", weightKg: 79,
      dedupeKey: "insight:weight:correction", reason: "corrected source",
      sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: "2026-09-27T20:00:00.000Z" }
    } });
    expect(correction.statusCode, correction.body).toBe(201);
    const afterCorrection = await fastify.inject({ method: "GET", url });
    const currentIds = afterCorrection.json().insights.find((item: { kind: string }) => item.kind === "weight_direction").evidence.weightMeasurementIds;
    expect(currentIds).toContain(correction.json().id);
    expect(currentIds).not.toContain(created[7]);

    await database.pool.query(
      `update source_references source
          set evidence_purpose = 'operational_verification'
         from weight_measurements measurement
        where measurement.source_reference_id = source.id
          and measurement.person_id = source.person_id
          and measurement.id = $1`,
      [created[0]]
    );
    const filtered = await fastify.inject({ method: "GET", url });
    expect(filtered.statusCode, filtered.body).toBe(200);
    expect(filtered.json().insights.some((item: { kind: string }) => item.kind === "weight_direction")).toBe(false);
    expect(filtered.json().suppressed).toContainEqual({ kind: "weight_direction", reason: "insufficient_data" });
  });

  it("uses the Person-local midnight and current connection state for the Training history gate", async () => {
    const personId = "00000000-0000-4000-8000-000000000001";
    const recovery = new RecoveryRepository(database);
    const model = await recovery.registerDeviceModel({
      providerKey: "insight-history-test", providerName: "Insight history test",
      modelKey: "test-watch", version: 1, name: "Test watch", capabilities: ["metric"]
    });
    const connection = await recovery.createConnection(personId, {
      deviceModelVersionId: model.id, label: null, dedupeKey: "insight-history:connection"
    });
    const consent = await recovery.grantConsent(personId, connection.id, {
      purpose: "Insight history gate test", allowedKinds: ["metric"], retentionMode: "indefinite", retainUntil: null
    });
    const id = "00000000-0000-4000-8000-000000000147";
    await database.pool.query(
      `insert into integration_connections
       (id, person_id, recovery_connection_id, consent_id, provider_key, external_user_id,
        historical_import_status, historical_cursor_before, historical_requested_at, historical_completed_at,
        last_successful_sync_at)
       values ($1, $2, $3, $4, 'insight_history_test', 'test-athlete',
        'completed', '2000-01-01', now(), now(), '2026-09-29T00:30:00Z')`,
      [id, personId, connection.id, consent.id]
    );
    const training = new TrainingRepository(database);
    expect(await training.hasCompleteConnectedActivityHistory(personId, "2026-09-29", "UTC")).toBe(true);
    expect(await training.hasCompleteConnectedActivityHistory(personId, "2026-09-29", "America/Los_Angeles")).toBe(false);
    expect(await training.hasCompleteConnectedActivityHistory("00000000-0000-4000-8000-000000000002", "2026-09-29", "UTC")).toBe(true);
    await database.pool.query("update integration_connections set last_successful_sync_at = '2026-09-29T07:00:00Z' where id = $1", [id]);
    expect(await training.hasCompleteConnectedActivityHistory(personId, "2026-09-29", "America/Los_Angeles")).toBe(true);
    await database.pool.query("update integration_connections set import_enabled = false, lifecycle = 'disconnected', disconnected_at = now() where id = $1", [id]);
    expect(await training.hasCompleteConnectedActivityHistory(personId, "2026-09-29", "America/Los_Angeles")).toBe(false);
  });
});
