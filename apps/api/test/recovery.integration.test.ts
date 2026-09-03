import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppConfig } from "@shape-of-you/config";
import { buildApp, getFastifyInstance } from "../src/app.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import {
  assertRecoveryErasureManifestComplete,
  exportRecoveryErasureManifest
} from "../src/recovery/recovery-erasure-manifest.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
let repository: RecoveryRepository;
let databaseUrl: string;

const personA = "00000000-0000-4000-8000-000000000001";
const personB = "00000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_recovery_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  databaseUrl = container.getConnectionUri();
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
  it("applies the additive Recovery migration on a clean schema", async () => {
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
  });

  it("persists a wearable sleep score as an independent local-date fact", async () => {
    const created = await repository.createObservation(personA, {
      kind: "metric",
      observedFrom: null,
      observedUntil: null,
      temporalPrecision: "local_date",
      localDate: "2026-08-31",
      timezone: "Europe/Moscow",
      quality: "reliable",
      connectionId: null,
      consentId: null,
      dedupeKey: "manual:sleep-score:2026-08-31",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: null
      },
      detail: { type: "metric", metric: "sleep_score", value: 86, unit: "score" }
    });
    const listed = await repository.listObservations(personA, {
      localDate: "2026-08-31"
    });

    expect(created.observation).toMatchObject({
      localDate: "2026-08-31",
      detail: { type: "metric", metric: "sleep_score", value: 86, unit: "score" }
    });
    expect(listed.items).toContainEqual(created.observation);
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
      detail: {
        type: "sleep" as const,
        totalSleepMinutes: 480,
        deepSleepMinutes: null,
        remSleepMinutes: null,
        lightSleepMinutes: null,
        sleepQuality: 4
      }
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
      detail: {
        type: "sleep",
        totalSleepMinutes: 420,
        deepSleepMinutes: null,
        remSleepMinutes: null,
        lightSleepMinutes: null,
        sleepQuality: 3
      },
      reason: "Исправлена длительность"
    });
    const history = await repository.observationHistory(personA, corrected.observation.id);
    expect(history?.items.map((item) => item.id)).toEqual([manual.observation.id, corrected.observation.id]);
  });

  it("quarantines a connection immediately and erases only its owned graph", async () => {
    const model = await repository.registerDeviceModel({
      providerKey: "erasure-provider",
      providerName: "Erasure provider",
      modelKey: "erasure-watch",
      version: 1,
      name: "Erasure watch",
      capabilities: ["metric"]
    });
    const connection = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: "Disposable connection",
      dedupeKey: "erasure:connection"
    });
    const consent = await repository.grantConsent(personA, connection.id, {
      purpose: "Erasure integration test",
      allowedKinds: ["metric"],
      retentionMode: "until",
      retainUntil: "2027-01-01T00:00:00.000Z"
    });
    const deviceInput = {
      kind: "metric" as const,
      observedFrom: "2026-11-01T06:00:00.000Z",
      observedUntil: "2026-11-01T06:00:00.000Z",
      timezone: "Europe/Moscow",
      quality: "reliable" as const,
      connectionId: connection.id,
      consentId: consent.id,
      dedupeKey: "erasure:device:one",
      sourceReference: {
        channel: "device" as const,
        externalSystem: "erasure-provider",
        externalRecordId: "device-one",
        occurredAt: "2026-11-01T06:00:00.000Z"
      },
      detail: {
        type: "metric" as const,
        metric: "resting_heart_rate" as const,
        value: 55,
        unit: "bpm" as const
      }
    };
    const deviceObservation = await repository.createObservation(personA, deviceInput);
    const manualObservation = await repository.createObservation(personA, {
      ...deviceInput,
      connectionId: null,
      consentId: null,
      dedupeKey: "erasure:manual:one",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-11-01T06:00:00.000Z"
      }
    });

    const request = await repository.requestErasure(
      personA,
      connection.id,
      "erasure:request:one",
      "user_request",
      "00000000-0000-4000-8000-000000000094"
    );
    const duplicate = await repository.requestErasure(
      personA,
      connection.id,
      "erasure:request:one",
      "user_request",
      "00000000-0000-4000-8000-000000000094"
    );

    expect(duplicate.id).toBe(request.id);
    expect((await repository.listConnections(personA)).items[0]).toMatchObject({
      id: connection.id,
      status: "disconnected"
    });
    expect((await repository.listConnections(personA)).items[0]?.erasureRequestedAt).not.toBeNull();
    expect(await repository.findObservation(personA, deviceObservation.observation.id)).toBeNull();
    expect(await repository.findObservation(personA, manualObservation.observation.id)).not.toBeNull();
    await expect(repository.createObservation(personA, {
      ...deviceInput,
      dedupeKey: "erasure:device:after-request",
      sourceReference: { ...deviceInput.sourceReference, externalRecordId: "after-request" }
    })).rejects.toThrow("not permitted");

    const job = await repository.claimErasure("integration-worker", 30_000);
    expect(job).toMatchObject({ id: request.id, personId: personA, connectionId: connection.id });
    await repository.completeErasure(job!);

    expect(await repository.findErasureRequest(personA, request.id)).toMatchObject({
      status: "completed"
    });
    expect((await repository.listConnections(personA)).items).not.toContainEqual(
      expect.objectContaining({ id: connection.id })
    );
    expect(await repository.findObservation(personA, manualObservation.observation.id)).not.toBeNull();
    const retainedModel = await repository.registerDeviceModel({
      providerKey: "erasure-provider",
      providerName: "Erasure provider",
      modelKey: "erasure-watch",
      version: 1,
      name: "Erasure watch",
      capabilities: ["metric"]
    });
    expect(retainedModel.id).toBe(model.id);
    const erased = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from recovery_observations where connection_id = $1",
      [connection.id]
    );
    expect(erased.rows[0]?.count).toBe("0");
    const manifest = await exportRecoveryErasureManifest(
      database.pool,
      () => new Date("2026-11-02T00:00:00.000Z")
    );
    expect(manifest.markers).toContainEqual({
      id: request.id,
      personId: personA,
      connectionId: connection.id,
      reason: "user_request",
      requestedAt: request.requestedAt
    });
  });

  it("enqueues expired exact retention once and leaves indefinite consent active", async () => {
    const model = await repository.registerDeviceModel({
      providerKey: "retention-provider",
      providerName: "Retention provider",
      modelKey: "retention-watch",
      version: 1,
      name: "Retention watch",
      capabilities: ["metric"]
    });
    const expired = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "retention:expired"
    });
    const indefinite = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "retention:indefinite"
    });
    await repository.grantConsent(personA, expired.id, {
      purpose: "Expired retention test",
      allowedKinds: ["metric"],
      retentionMode: "until",
      retainUntil: "2020-01-01T00:00:00.000Z"
    });
    await repository.grantConsent(personA, indefinite.id, {
      purpose: "Indefinite retention test",
      allowedKinds: ["metric"],
      retentionMode: "indefinite",
      retainUntil: null
    });

    expect(await repository.enqueueExpiredRetention(10)).toBe(1);
    expect(await repository.enqueueExpiredRetention(10)).toBe(0);
    expect((await repository.listConnections(personA)).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expired.id, status: "disconnected" }),
        expect.objectContaining({ id: indefinite.id, status: "active", erasureRequestedAt: null })
      ])
    );
    const claims = await Promise.all([
      repository.claimErasure("retention-worker-a", 30_000),
      repository.claimErasure("retention-worker-b", 30_000)
    ]);
    const claimed = claims.find((item) => item !== null)!;
    expect(claims.filter((item) => item !== null)).toHaveLength(1);
    expect(claimed.connectionId).toBe(expired.id);
    await repository.failErasure(claimed, "TRANSIENT_TEST_FAILURE", 0);
    const retried = await repository.claimErasure("retention-worker-c", 30_000);
    expect(retried?.id).toBe(claimed.id);
    await repository.completeErasure(retried!);
    expect((await repository.listConnections(personA)).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: indefinite.id, status: "active" })
      ])
    );
  });

  it("replays an independent marker idempotently without a request in the restored database", async () => {
    const model = await repository.registerDeviceModel({
      providerKey: "restore-provider",
      providerName: "Restore provider",
      modelKey: "restore-watch",
      version: 1,
      name: "Restore watch",
      capabilities: ["metric"]
    });
    const connection = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "restore:connection"
    });
    const marker = {
      id: "00000000-0000-4000-8000-000000009400",
      personId: personA,
      connectionId: connection.id,
      reason: "user_request" as const,
      requestedAt: "2026-11-03T00:00:00.000Z"
    };

    await repository.replayErasureMarker(marker);
    await repository.replayErasureMarker(marker);

    expect((await repository.listConnections(personA)).items).not.toContainEqual(
      expect.objectContaining({ id: connection.id })
    );
    expect(await repository.findErasureRequest(personA, marker.id)).toBeNull();
  });

  it("replays a post-backup erasure into an isolated pre-erasure restore", async () => {
    const model = await repository.registerDeviceModel({
      providerKey: "restore-drill-provider",
      providerName: "Restore drill provider",
      modelKey: "restore-drill-watch",
      version: 1,
      name: "Restore drill watch",
      capabilities: ["metric"]
    });
    const connection = await repository.createConnection(personA, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "restore-drill:connection"
    });
    const consent = await repository.grantConsent(personA, connection.id, {
      purpose: "Restore drill",
      allowedKinds: ["metric"],
      retentionMode: "indefinite",
      retainUntil: null
    });
    const device = await repository.createObservation(personA, {
      kind: "metric",
      observedFrom: "2026-11-04T06:00:00.000Z",
      observedUntil: "2026-11-04T06:00:00.000Z",
      timezone: "Europe/Moscow",
      quality: "reliable",
      connectionId: connection.id,
      consentId: consent.id,
      dedupeKey: "restore-drill:device",
      sourceReference: {
        channel: "device",
        externalSystem: "restore-drill-provider",
        externalRecordId: "restore-drill-device",
        occurredAt: "2026-11-04T06:00:00.000Z"
      },
      detail: { type: "metric", metric: "resting_heart_rate", value: 56, unit: "bpm" }
    });
    const manual = await repository.createObservation(personA, {
      kind: "metric",
      observedFrom: "2026-11-04T07:00:00.000Z",
      observedUntil: "2026-11-04T07:00:00.000Z",
      timezone: "Europe/Moscow",
      quality: "reliable",
      connectionId: null,
      consentId: null,
      dedupeKey: "restore-drill:manual",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-11-04T07:00:00.000Z"
      },
      detail: { type: "metric", metric: "resting_heart_rate", value: 57, unit: "bpm" }
    });
    const dump = await container.exec([
      "pg_dump", "-U", "shape_of_you", "-Fc", "-f", "/tmp/pre-erasure.dump",
      "shape_of_you_recovery_test"
    ]);
    expect(dump.exitCode, dump.output).toBe(0);

    const request = await repository.requestErasure(
      personA,
      connection.id,
      "restore-drill:request",
      "user_request",
      "00000000-0000-4000-8000-000000000096"
    );
    const job = await repository.claimErasure("restore-drill-worker", 30_000);
    expect(job?.id).toBe(request.id);
    await repository.completeErasure(job!);
    const manifest = await exportRecoveryErasureManifest(database.pool);
    assertRecoveryErasureManifestComplete(manifest, manifest.completeThrough);
    expect(() => assertRecoveryErasureManifestComplete(
      manifest,
      new Date(new Date(manifest.completeThrough).getTime() + 1).toISOString()
    )).toThrow("incomplete");

    const createdRestore = await container.exec([
      "createdb", "-U", "shape_of_you", "shape_of_you_recovery_restore_test"
    ]);
    expect(createdRestore.exitCode, createdRestore.output).toBe(0);
    const restoredDump = await container.exec([
      "pg_restore", "-U", "shape_of_you", "-d", "shape_of_you_recovery_restore_test",
      "/tmp/pre-erasure.dump"
    ]);
    expect(restoredDump.exitCode, restoredDump.output).toBe(0);
    const restoredUrl = new URL(databaseUrl);
    restoredUrl.pathname = "/shape_of_you_recovery_restore_test";
    const restoredDatabase = createDatabase({
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3_000,
      DATABASE_URL: restoredUrl.toString(),
      LOG_LEVEL: "silent",
      PERSON_CONTEXT_MODE: "synthetic",
      SYNTHETIC_PERSON_ID: personA,
      SHUTDOWN_TIMEOUT_MS: 1_000
    });
    try {
      const restoredRepository = new RecoveryRepository(restoredDatabase);
      expect(await restoredRepository.findObservation(personA, device.observation.id)).not.toBeNull();
      for (const marker of manifest.markers) {
        await restoredRepository.replayErasureMarker(marker);
      }
      expect(await restoredRepository.findObservation(personA, device.observation.id)).toBeNull();
      expect(await restoredRepository.findObservation(personA, manual.observation.id)).not.toBeNull();
    } finally {
      await restoredDatabase.pool.end();
    }
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
