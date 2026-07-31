import { readFile } from "node:fs/promises";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";

import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
let repository: RecoveryRepository;

const personA = "00000000-0000-4000-8000-000000000001";
const personB = "00000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_recovery_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  const databaseUrl = container.getConnectionUri();
  const config: AppConfig = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3_000,
    DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: personA,
    SHUTDOWN_TIMEOUT_MS: 1_000
  };
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = personA;
  await runMigrations(databaseUrl);
  database = createDatabase(config);
  await database.pool.query(
    "insert into persons (id, kind, status) values ($1, 'real', 'active')",
    [personB]
  );
  repository = new RecoveryRepository(database);
  app = await buildApp({ config, database });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

describe("Recovery PostgreSQL vertical", () => {
  it("applies the additive Recovery migration on a clean and prior schema", async () => {
    const clean = await database.pool.query<{ name: string | null }>(
      `select to_regclass('public.recovery_observations')::text as name
       union all select to_regclass('public.recovery_assessments')::text
       union all select to_regclass('public.recovery_consents')::text`
    );
    expect(clean.rows.map((row) => row.name)).toEqual([
      "recovery_observations",
      "recovery_assessments",
      "recovery_consents"
    ]);

    await database.pool.query("create database shape_of_you_recovery_upgrade");
    const upgradeUrl = new URL(container.getConnectionUri());
    upgradeUrl.pathname = "/shape_of_you_recovery_upgrade";
    const pool = new Pool({ connectionString: upgradeUrl.toString() });
    const migrations = [
      "20260728183725_real_vermin.sql",
      "20260730131840_person_identity_provenance_corrections.sql",
      "20260730185405_physical_state_goals.sql",
      "20260730191405_enforce_goal_ownership.sql",
      "20260731090108_rare_zarda.sql",
      "20260731125414_fixed_pete_wisdom.sql",
      "20260731152211_hesitant_maggott.sql"
    ];
    try {
      for (const file of migrations) {
        const sql = await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8");
        for (const statement of sql.split("--> statement-breakpoint")) {
          if (statement.trim()) await pool.query(statement);
        }
      }
      const upgraded = await pool.query<{ recovery: string | null; training: string | null }>(
        `select to_regclass('public.recovery_observations')::text as recovery,
                to_regclass('public.workout_sessions')::text as training`
      );
      expect(upgraded.rows[0]).toEqual({
        recovery: "recovery_observations",
        training: "workout_sessions"
      });
    } finally {
      await pool.end();
    }
  });

  it("reuses shared device knowledge while isolating Person-owned connections", async () => {
    const first = await repository.registerDeviceModel({
      providerKey: "synthetic-provider",
      providerName: "Синтетический поставщик",
      modelKey: "synthetic-watch",
      version: 1,
      name: "Синтетические часы",
      capabilities: ["sleep", "metric", "subjective"]
    });
    const second = await repository.registerDeviceModel({
      providerKey: "synthetic-provider",
      providerName: "Синтетический поставщик",
      modelKey: "synthetic-watch",
      version: 1,
      name: "Синтетические часы",
      capabilities: ["sleep", "metric", "subjective"]
    });
    const connectionA = await repository.createConnection(personA, {
      deviceModelVersionId: first.id,
      label: "Часы A",
      dedupeKey: "watch:a"
    });
    const connectionB = await repository.createConnection(personB, {
      deviceModelVersionId: first.id,
      label: "Часы B",
      dedupeKey: "watch:b"
    });

    expect(second.id).toBe(first.id);
    expect(connectionA.device.modelVersion.id).toBe(connectionB.device.modelVersion.id);
    expect(connectionA.personId).not.toBe(connectionB.personId);
  });

  it("enforces consent, idempotency, correction history and Person isolation", async () => {
    const model = await repository.registerDeviceModel({
      providerKey: "consent-provider",
      providerName: "Поставщик согласия",
      modelKey: "sleep-band",
      version: 1,
      name: "Браслет сна",
      capabilities: ["sleep"]
    });
    const connection = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "consent-connection"
    });
    const consent = await repository.grantConsent(personA, connection.id, {
      purpose: "Оценка восстановления",
      allowedKinds: ["sleep"],
      retentionMode: "until",
      retainUntil: "2027-01-01T00:00:00.000Z"
    });
    const input = {
      kind: "sleep" as const,
      observedFrom: "2026-10-24T22:00:00.000Z",
      observedUntil: "2026-10-25T06:00:00.000Z",
      timezone: "Europe/Berlin",
      quality: "reliable" as const,
      connectionId: connection.id,
      consentId: consent.id,
      dedupeKey: "device:sleep:2026-10-25",
      sourceReference: {
        channel: "device" as const,
        externalSystem: "synthetic-provider",
        externalRecordId: "sleep-2026-10-25",
        occurredAt: "2026-10-25T06:00:00.000Z"
      },
      detail: { type: "sleep" as const, totalSleepMinutes: 480, sleepQuality: 4 }
    };
    const concurrent = await Promise.all([
      repository.createObservation(personA, input),
      repository.createObservation(personA, input)
    ]);
    const created = concurrent.find((item) => item.created)!;
    const duplicate = concurrent.find((item) => !item.created)!;

    expect(concurrent.map((item) => item.created).sort()).toEqual([false, true]);
    expect(created.created).toBe(true);
    expect(duplicate).toMatchObject({ created: false, observation: { id: created.observation.id, localDate: "2026-10-25" } });
    expect(await repository.findObservation(personB, created.observation.id)).toBeNull();

    await repository.revokeConsent(personA, consent.id, { reason: "Проверка отзыва" });
    await expect(repository.createObservation(personA, {
      ...input,
      dedupeKey: "device:sleep:after-revoke",
      sourceReference: { ...input.sourceReference, externalRecordId: "after-revoke" }
    })).rejects.toThrow("not permitted");

    const manual = await repository.createObservation(personA, {
      ...input,
      connectionId: null,
      consentId: null,
      dedupeKey: "manual:sleep:1",
      sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: input.observedUntil }
    });
    const corrected = await repository.correctObservation(personA, manual.observation.id, {
      ...input,
      connectionId: null,
      consentId: null,
      dedupeKey: "manual:sleep:2",
      sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: input.observedUntil },
      detail: { type: "sleep", totalSleepMinutes: 420, sleepQuality: 3 },
      reason: "Исправлена длительность"
    });
    const history = await repository.observationHistory(personA, corrected.observation.id);
    expect(history?.items.map((item) => item.id)).toEqual([manual.observation.id, corrected.observation.id]);
  });

  it("creates immutable policy-pinned assessments with hard-stop evidence", async () => {
    const policyVersionId = await repository.registerPolicyVersion({
      policyKey: "synthetic-readiness",
      policyName: "Синтетическая готовность",
      version: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveUntil: null,
      analysisWindowDays: 7,
      minimumObservations: 2,
      sufficientObservations: 3,
      insufficientConfidenceCap: 0.25,
      poorQualityConfidenceCap: 0.4,
      targetSleepMinutes: 480,
      fatigueWeight: 20,
      sorenessWeight: 15,
      stressWeight: 10,
      lowEnergyWeight: 15,
      lowSleepQualityWeight: 10,
      sleepDeficitWeight: 20,
      externalSetWeight: 1,
      bodyweightSetWeight: 0.5,
      assistedSetWeight: 0.25,
      moderateRiskThreshold: 25,
      highRiskThreshold: 50
    });
    const fastify = getFastifyInstance(app);
    const exerciseResponse = await fastify.inject({
      method: "POST",
      url: "/v1/training/catalog/exercises",
      payload: {
        visibility: "shared",
        name: "Синтетическое упражнение Recovery",
        category: "strength",
        movementPattern: "push",
        equipment: null,
        instructions: null,
        note: null
      }
    });
    expect(exerciseResponse.statusCode, exerciseResponse.body).toBe(201);
    const exerciseVersionId = exerciseResponse.json().currentVersion.id;
    const sessionResponse = await fastify.inject({
      method: "POST",
      url: "/v1/training/sessions",
      payload: {
        occurredAt: "2026-10-24T18:00:00.000Z",
        timezone: "Europe/Berlin",
        programVersionId: null,
        workoutName: "Синтетическая тренировка Recovery",
        feeling: null,
        note: null,
        exercises: [
          { exerciseVersionId, loadBasis: "external_weight", feeling: null, note: null, sets: [{ weightKg: 20, reps: 5, rir: 2 }] },
          { exerciseVersionId, loadBasis: "body_weight", feeling: null, note: null, sets: [{ weightKg: null, reps: 5, rir: 2 }, { weightKg: null, reps: 5, rir: 2 }] },
          { exerciseVersionId, loadBasis: "assisted", feeling: null, note: null, sets: [{ weightKg: null, reps: 5, rir: 2 }, { weightKg: null, reps: 5, rir: 2 }, { weightKg: null, reps: 5, rir: 2 }] }
        ],
        sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: "2026-10-24T18:00:00.000Z" },
        dedupeKey: "training:recovery:evidence",
        confidence: 1
      }
    });
    expect(sessionResponse.statusCode, sessionResponse.body).toBe(201);
    const observationResponse = await fastify.inject({
      method: "POST",
      url: "/v1/recovery/observations",
      payload: {
      kind: "subjective",
      observedFrom: "2026-10-25T07:00:00.000Z",
      observedUntil: "2026-10-25T07:00:00.000Z",
      timezone: "Europe/Berlin",
      quality: "poor",
      connectionId: null,
      consentId: null,
      dedupeKey: "manual:subjective:hard-stop",
      sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: "2026-10-25T07:00:00.000Z" },
      detail: { type: "subjective", energy: 4, fatigue: 2, muscleSoreness: 2, stress: 2, sleepQuality: 4, acuteIllness: true, injuryConcern: false }
      }
    });
    expect(observationResponse.statusCode, observationResponse.body).toBe(201);
    const observation = observationResponse.json();
    const beforeAssessment = await database.pool.query<{ sessions: string; observations: string; consents: string }>(
      `select
         (select count(*)::text from workout_sessions) as sessions,
         (select count(*)::text from recovery_observations) as observations,
         (select count(*)::text from recovery_consents) as consents`
    );
    const assessmentInput = {
        policyVersionId,
        asOf: "2026-10-25T08:00:00.000Z",
        timezone: "Europe/Berlin",
        dedupeKey: "assessment:hard-stop"
    };
    const createdResponse = await fastify.inject({
      method: "POST",
      url: "/v1/recovery/assessments",
      payload: assessmentInput
    });
    const duplicateResponse = await fastify.inject({
      method: "POST",
      url: "/v1/recovery/assessments",
      payload: assessmentInput
    });
    expect(createdResponse.statusCode, createdResponse.body).toBe(201);
    expect(duplicateResponse.statusCode, duplicateResponse.body).toBe(200);
    const created = createdResponse.json();
    const duplicate = duplicateResponse.json();

    expect(created).toMatchObject({
      riskLevel: "blocked",
      readinessScore: 0,
      hardStop: true,
      confidence: 0.4,
      dataQuality: "limited"
    });
    expect(created.observationIds).toContain(observation.id);
    expect(created.workoutSessionIds).toContain(sessionResponse.json().id);
    expect(created.calculation.trainingComponents).toEqual({
      external: 1,
      bodyweight: 1,
      assisted: 0.75
    });
    expect(duplicate.id).toBe(created.id);
    expect(await repository.findAssessment(personB, created.id)).toBeNull();
    const afterAssessment = await database.pool.query<{ sessions: string; observations: string; consents: string }>(
      `select
         (select count(*)::text from workout_sessions) as sessions,
         (select count(*)::text from recovery_observations) as observations,
         (select count(*)::text from recovery_consents) as consents`
    );
    expect(afterAssessment.rows[0]).toEqual(beforeAssessment.rows[0]);
  });
});
