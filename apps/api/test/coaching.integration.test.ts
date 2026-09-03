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
import { CoachingRepository } from "../src/storage/coaching-repository.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";
import { TrainingRepository } from "../src/storage/training-repository.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
let coaching: CoachingRepository;
let now = new Date("2026-07-31T12:30:00.000Z");

const personA = "00000000-0000-4000-8000-000000000001";
const personB = "00000000-0000-4000-8000-000000000002";
let policyVersionId: string;
let recoveryAssessmentId: string;
let programId: string;
let programVersionId: string;
let recovery: RecoveryRepository;
let recoveryConnectionId: string;
let manualRecoveryObservationId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_coaching_test")
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

  recovery = new RecoveryRepository(database);
  const recoveryPolicyId = await recovery.registerPolicyVersion({
    policyKey: "coaching-integration-recovery",
    policyName: "Восстановление для Coaching",
    version: 1,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveUntil: null,
    analysisWindowDays: 7,
    minimumObservations: 1,
    sufficientObservations: 1,
    insufficientConfidenceCap: 0.25,
    poorQualityConfidenceCap: 0.4,
    targetSleepMinutes: 480,
    fatigueWeight: 100,
    sorenessWeight: 0,
    stressWeight: 0,
    lowEnergyWeight: 0,
    lowSleepQualityWeight: 0,
    sleepDeficitWeight: 0,
    externalSetWeight: 0,
    bodyweightSetWeight: 0,
    assistedSetWeight: 0,
    moderateRiskThreshold: 25,
    highRiskThreshold: 50
  });
  manualRecoveryObservationId = (await recovery.createObservation(personA, {
    kind: "subjective",
    observedFrom: "2026-07-31T11:00:00.000Z",
    observedUntil: "2026-07-31T11:00:00.000Z",
    timezone: "Europe/Moscow",
    quality: "reliable",
    connectionId: null,
    consentId: null,
    dedupeKey: "coaching:subjective:high-risk",
    sourceReference: {
      channel: "manual",
      externalSystem: null,
      externalRecordId: null,
      occurredAt: "2026-07-31T11:00:00.000Z"
    },
    detail: {
      type: "subjective",
      energy: 5,
      fatigue: 5,
      muscleSoreness: 1,
      stress: 1,
      sleepQuality: 5,
      acuteIllness: false,
      injuryConcern: false
    }
  })).observation.id;
  const deviceModel = await recovery.registerDeviceModel({
    providerKey: "coaching-erasure-provider",
    providerName: "Coaching erasure provider",
    modelKey: "coaching-erasure-watch",
    version: 1,
    name: "Coaching erasure watch",
    capabilities: ["metric"]
  });
  const connection = await recovery.createConnection(personA, {
    deviceModelVersionId: deviceModel.id,
    label: null,
    dedupeKey: "coaching:erasure:connection"
  });
  recoveryConnectionId = connection.id;
  const consent = await recovery.grantConsent(personA, connection.id, {
    purpose: "Coaching erasure coverage",
    allowedKinds: ["metric"],
    retentionMode: "indefinite",
    retainUntil: null
  });
  await recovery.createObservation(personA, {
    kind: "metric",
    observedFrom: "2026-07-31T10:00:00.000Z",
    observedUntil: "2026-07-31T10:00:00.000Z",
    timezone: "Europe/Moscow",
    quality: "reliable",
    connectionId: connection.id,
    consentId: consent.id,
    dedupeKey: "coaching:erasure:metric",
    sourceReference: {
      channel: "device",
      externalSystem: "coaching-erasure-provider",
      externalRecordId: "metric-one",
      occurredAt: "2026-07-31T10:00:00.000Z"
    },
    detail: { type: "metric", metric: "resting_heart_rate", value: 55, unit: "bpm" }
  });
  recoveryAssessmentId = (await recovery.createAssessment(personA, {
    policyVersionId: recoveryPolicyId,
    asOf: "2026-07-31T12:00:00.000Z",
    timezone: "Europe/Moscow",
    dedupeKey: "coaching:recovery:high-risk"
  })).assessment.id;

  const training = new TrainingRepository(database);
  const exercise = await training.createExercise(personA, {
    visibility: "shared",
    name: "Приседание для Coaching",
    category: "strength",
    movementPattern: "squat",
    equipment: "barbell",
    instructions: null,
    note: null
  });
  const program = await training.createProgram(personA, {
    name: "Программа Coaching",
    note: null,
    workouts: [{
      name: "День A",
      prescriptions: [{
        exerciseVersionId: exercise.currentVersion.id,
        loadBasis: "external_weight",
        targetWeightKg: 100,
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
        targetRir: 2,
        progressionIncrementKg: 2.5,
        note: null
      }]
    }]
  });
  const active = await training.activateProgramVersion(
    personA,
    program.id,
    program.currentVersion.id,
    { expectedLockVersion: program.lockVersion }
  );
  programId = active.id;
  programVersionId = active.activeVersionId!;

  coaching = new CoachingRepository(database, () => new Date(now));
  policyVersionId = await coaching.registerPolicyVersion({
    policyKey: "coaching-integration-policy",
    policyName: "Корректировка тренировки",
    version: 1,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveUntil: null,
    recommendationTtlMinutes: 120,
    minimumConfidence: 0.6,
    highRiskLoadFactor: 0.8,
    repetitionReduction: 2
  });
  app = await buildApp({ config, database, coachingStore: coaching });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

describe("Coaching PostgreSQL vertical", () => {
  it("applies the additive migration on a clean schema", async () => {
    const clean = await database.pool.query<{ name: string | null }>(
      `select to_regclass('public.coaching_recommendations')::text as name
       union all select to_regclass('public.coaching_training_adjustment_details')::text
       union all select to_regclass('public.coaching_recommendation_decisions')::text`
    );
    expect(clean.rows.map((row) => row.name)).toEqual([
      "coaching_recommendations",
      "coaching_training_adjustment_details",
      "coaching_recommendation_decisions"
    ]);
  });

  it("creates an idempotent typed recommendation with exact evidence and Person isolation", async () => {
    const fastify = getFastifyInstance(app);
    const payload = {
      policyVersionId,
      recoveryAssessmentId,
      programVersionId,
      workoutPosition: 1,
      prescriptionPosition: 1,
      asOf: "2026-07-31T12:15:00.000Z",
      dedupeKey: "coaching:recommendation:one"
    };
    const before = await database.pool.query(
      "select active_version_id, lock_version from training_programs where id = $1",
      [programId]
    );
    const responses = await Promise.all([1, 2].map(() => fastify.inject({
      method: "POST",
      url: "/v1/coaching/recommendations/training-adjustments",
      payload
    })));
    const created = responses.find((response) => response.statusCode === 201)!;
    const duplicate = responses.find((response) => response.statusCode === 200)!;
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(created.statusCode, created.body).toBe(201);
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json().id).toBe(created.json().id);
    expect(created.json()).toMatchObject({
      personId: personA,
      kind: "training_adjustment",
      policyVersionId,
      state: "proposed",
      detail: {
        action: "target_weight",
        currentTargetWeightKg: 100,
        suggestedTargetWeightKg: 80,
        suggestedRepsMin: null,
        suggestedRepsMax: null,
        programVersionId
      },
      evidence: { recoveryAssessmentId, trainingProgramVersionId: programVersionId }
    });
    expect(await coaching.find(personB, created.json().id)).toBeNull();
    const after = await database.pool.query(
      "select active_version_id, lock_version from training_programs where id = $1",
      [programId]
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("records one idempotent terminal decision without mutating Training", async () => {
    const fastify = getFastifyInstance(app);
    const list = await fastify.inject({ method: "GET", url: "/v1/coaching/recommendations" });
    const recommendationId = list.json().items[0].id;
    const before = await database.pool.query(
      "select active_version_id, lock_version from training_programs where id = $1",
      [programId]
    );
    const payload = {
      outcome: "accepted",
      reason: "Пользователь согласен с рекомендацией",
      dedupeKey: "coaching:decision:one"
    };
    const decisionResponses = await Promise.all([1, 2].map(() => fastify.inject({
      method: "POST",
      url: `/v1/coaching/recommendations/${recommendationId}/decisions`,
      payload
    })));
    const accepted = decisionResponses.find((response) => response.statusCode === 201)!;
    const duplicate = decisionResponses.find((response) => response.statusCode === 200)!;
    const opposite = await fastify.inject({
      method: "POST",
      url: `/v1/coaching/recommendations/${recommendationId}/decisions`,
      payload: { ...payload, outcome: "rejected", dedupeKey: "coaching:decision:opposite" }
    });
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(accepted.json()).toMatchObject({
      state: "accepted",
      decision: { outcome: "accepted", actorPersonId: personA }
    });
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(decisionResponses.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    expect(opposite.statusCode, opposite.body).toBe(409);
    const history = await fastify.inject({
      method: "GET",
      url: `/v1/coaching/recommendations/${recommendationId}/history`
    });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json().decisions).toHaveLength(1);
    const after = await database.pool.query(
      "select active_version_id, lock_version from training_programs where id = $1",
      [programId]
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("derives expiration and rejects a late decision", async () => {
    const fastify = getFastifyInstance(app);
    const created = await fastify.inject({
      method: "POST",
      url: "/v1/coaching/recommendations/training-adjustments",
      payload: {
        policyVersionId,
        recoveryAssessmentId,
        programVersionId,
        workoutPosition: 1,
        prescriptionPosition: 1,
        asOf: "2026-07-31T12:16:00.000Z",
        dedupeKey: "coaching:recommendation:expires"
      }
    });
    expect(created.statusCode, created.body).toBe(201);
    now = new Date("2026-07-31T14:16:00.000Z");
    const expired = await fastify.inject({
      method: "GET",
      url: `/v1/coaching/recommendations/${created.json().id}`
    });
    expect(expired.json().state).toBe("expired");
    const decision = await fastify.inject({
      method: "POST",
      url: `/v1/coaching/recommendations/${created.json().id}/decisions`,
      payload: {
        outcome: "rejected",
        reason: "Слишком поздно",
        dedupeKey: "coaching:decision:expired"
      }
    });
    expect(decision.statusCode, decision.body).toBe(409);
    const filtered = await fastify.inject({
      method: "GET",
      url: "/v1/coaching/recommendations?state=expired"
    });
    expect(filtered.json().items.map((item: { id: string }) => item.id)).toContain(created.json().id);
  });

  it("hides and deletes Coaching output derived from an erased connection", async () => {
    const before = await coaching.list(personA, {});
    expect(before.items.length).toBeGreaterThan(0);
    const request = await recovery.requestErasure(
      personA,
      recoveryConnectionId,
      "coaching:erasure:request",
      "user_request",
      "00000000-0000-4000-8000-000000000095"
    );

    expect((await coaching.list(personA, {})).items).toEqual([]);
    expect(await recovery.findAssessment(personA, recoveryAssessmentId)).toBeNull();
    const job = await recovery.claimErasure("coaching-erasure-worker", 30_000);
    expect(job?.id).toBe(request.id);
    await recovery.completeErasure(job!);

    expect(await recovery.findObservation(personA, manualRecoveryObservationId)).not.toBeNull();
    const derived = await database.pool.query<{ recommendations: string; assessments: string }>(
      `select
         (select count(*)::text from coaching_recommendations) as recommendations,
         (select count(*)::text from recovery_assessments where id = $1) as assessments`,
      [recoveryAssessmentId]
    );
    expect(derived.rows[0]).toEqual({ recommendations: "0", assessments: "0" });
  });
});
