import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RequestPersonContext } from "../src/application/person-context.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { registerMcpRoutes, type McpRouteOptions } from "../src/mcp/server.js";
import { TrainingRepository } from "../src/storage/training-repository.js";
import { TrainingService } from "../src/training/training.service.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = "00000000-0000-4000-8000-000000000001";
  await runMigrations(container.getConnectionUri());
  database = createDatabase({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3000,
    DATABASE_URL: container.getConnectionUri(), LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: process.env.SYNTHETIC_PERSON_ID, SHUTDOWN_TIMEOUT_MS: 1000 });
});

afterAll(async () => {
  await database?.pool.end();
  await container?.stop();
});

async function fixture() {
  const personId = randomUUID();
  const context = new RequestPersonContext(personId);
  const repository = new TrainingRepository(database);
  const training = new TrainingService(repository, context);
  await database.pool.query("insert into persons (id, kind, status) values ($1, 'real', 'active')", [personId]);
  const providerId = randomUUID(), recoveryConnectionId = randomUUID();
  const consentId = randomUUID(), connectionId = randomUUID();
  await database.pool.query("insert into recovery_providers (id, key, name) values ($1, $2, 'MCP flow test')", [providerId, personId]);
  await database.pool.query("insert into recovery_connections (id, person_id, provider_id, dedupe_key) values ($1, $2, $3, $4)", [recoveryConnectionId, personId, providerId, personId]);
  await database.pool.query("insert into recovery_consents (id, person_id, connection_id, purpose, retention_mode) values ($1, $2, $3, 'training', 'indefinite')", [consentId, personId, recoveryConnectionId]);
  await database.pool.query("insert into integration_connections (id, person_id, recovery_connection_id, consent_id, provider_key, external_user_id) values ($1, $2, $3, $4, 'intervals_icu', $5)", [connectionId, personId, recoveryConnectionId, consentId, personId]);
  const unavailable = async (): Promise<never> => { throw new Error("Unrelated service called"); };
  const fastify = Fastify();
  registerMcpRoutes({
    fastify, issuer: "https://identity.example.test", resource: "https://api.example.test/mcp",
    // OAuth cryptography has its own suite; domain results here are never mocked.
    authorizer: { authorize: async () => ({ personId, roles: ["owner"] }) },
    personContext: context,
    services: {
      training,
      weights: { list: unavailable, create: unavailable, correct: unavailable },
      bodyMeasurements: { list: unavailable, create: unavailable, correct: unavailable },
      nutrition: { listMeals: unavailable, createMeal: unavailable, correctMeal: unavailable },
      recovery: { listObservations: unavailable, createObservation: unavailable, correctObservation: unavailable },
      dailyContextNotes: { list: unavailable, create: unavailable, correct: unavailable },
      dailyProjection: { projection: unavailable },
      currentRecoveryContext: { read: unavailable }
    } satisfies McpRouteOptions["services"]
  });
  let requestId = 0;
  const call = async (name: string, args: object = {}) => {
    const response = await fastify.inject({ method: "POST", url: "/mcp",
      headers: { accept: "application/json, text/event-stream", authorization: "Bearer test" },
      payload: { jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args } }
    });
    expect(response.statusCode).toBe(200);
    const result = response.json().result;
    expect(result, JSON.stringify(response.json())).toBeDefined();
    expect(result.isError, result.content?.[0]?.text).not.toBe(true);
    return result.structuredContent;
  };
  const saved = await call("save_confirmed_training_program", {
    expectedActiveProgramId: null, expectedLockVersion: null, name: "Ahilej A/B", note: null,
    cadence: { kind: "rolling_weekly", strengthSessionsPerWeek: 2, workoutSequence: [1, 2], lightCardio: null },
    workouts: ["A", "B"].map((name) => ({ name: `Ahilej ${name}`, prescriptions: [{
      exercise: { name: `${personId} press`, category: "strength", movementPattern: null, equipment: null, instructions: null, note: null },
      loadBasis: "external_weight", targetWeightKg: 20, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12,
      targetRir: 2, progressionIncrementKg: 2.5, note: null
    }] }))
  });
  const program = saved.program;
  await call("set_activity_recording_mode", { expectedLockVersion: 0, title: "Силовая тренировка" });
  const importActivity = async (date = "2026-10-02", name = "Силовая тренировка", durationSeconds = 3600) => {
    const providerIdentity = randomUUID();
    await repository.importExternalActivity({ connectionId, personId, consentId, providerIdentity,
      normalizedChecksum: "a".repeat(64), occurredAt: `${date}T12:00:00.000Z`, localDate: date,
      timezone: "Europe/Belgrade", name, durationSeconds, distanceMeters: null,
      trainingLoad: 20, trainingLoadBasis: "relative_training_stress", trainingLoadBasisVersion: "1",
      averageHeartRate: 107, maximumHeartRate: 142, deviceName: "Garmin Forerunner 970",
      sourceProvider: "intervals_icu", garminAttributed: true });
    return (await repository.listExternalActivities(personId, 20)).find((item) => item.providerIdentity === providerIdentity)!;
  };
  return { fastify, call, program, importActivity };
}

describe("MCP training conversation flow with PostgreSQL", () => {
  it("keeps frequency advisory across Monday and preserves mixed-precision A/B after the window expires", async () => {
    const { fastify, call, program } = await fixture();
    try {
      for (const [index, date] of ["2026-09-27", "2026-09-28", "2026-09-29", "2026-10-02", "2026-10-03"].entries()) {
        await call("record_workout_session_v2", {
          // Oct 3 shortly after local midnight precedes the previous date's synthetic UTC end.
          occurredAt: index === 4 ? "2026-10-02T22:15:00.000Z" : null,
          temporalPrecision: index === 4 ? "instant" : "local_date", localDate: date, timezone: "Europe/Belgrade",
          programVersionId: program.activeVersionId, programWorkoutPosition: index % 2 + 1,
          externalActivityId: null, completionState: "completed", workoutName: "Reported workout",
          venueLabel: null, feeling: null, note: null, exercises: [], dedupeKey: date,
          sourceReference: { channel: "manual", externalSystem: "chatgpt", externalRecordId: date, occurredAt: null },
          confidence: 1
        });
      }
      for (const [date, from, strengthCompleted] of [
        ["2026-10-04", "2026-09-28", 4], ["2026-10-05", "2026-09-29", 3], ["2026-10-12", "2026-10-06", 0]
      ] as const) {
        const result = await call("get_training_context_v2", { localDate: date, historyLimit: 1 });
        expect(result.nextStep).toMatchObject({ state: "training_options", policyVersion: "training-next-step-v5",
          recentProgress: { from, to: date, strengthCompleted, strengthTarget: 2, targetMeaning: "guidance" },
          strength: { workoutPosition: 2 }, lastStrengthLocalDate: "2026-10-03" });
      }
    } finally { await fastify.close(); }
  });
  it("confirms a historical date-only workout/ Garmin pair from today's context and counts it once", async () => {
    const { fastify, call, program, importActivity } = await fixture();
    try {
      const session = await call("record_workout_session_v2", {
        occurredAt: null, temporalPrecision: "local_date", localDate: "2026-10-02", timezone: "Europe/Belgrade",
        programVersionId: program.activeVersionId, programWorkoutPosition: 1, externalActivityId: null,
        completionState: "completed", workoutName: "Ahilej A", venueLabel: "Ahilej", feeling: null, note: null,
        exercises: [{ exerciseVersionId: null, exerciseLabel: "Smith squat", loadBasis: "external_weight",
          feeling: null, note: null, sets: [{ weightKg: 60, reps: 10, rir: null }] }],
        sourceReference: { channel: "manual", externalSystem: "chatgpt", externalRecordId: "reported-a", occurredAt: null },
        dedupeKey: "reported-a", confidence: 1
      });
      const activity = await importActivity();
      // A newer unrelated import must not hide the exact blocker with historyLimit=1.
      await importActivity("2026-10-03", "Прогулка", 300);
      const before = await call("get_training_context_v2", { localDate: "2026-10-04", historyLimit: 1 });
      expect(before.nextStep).toMatchObject({ state: "needs_classification", externalActivityId: activity.id });
      expect(before.pendingActivityLinkQuestion).toMatchObject({ localDate: "2026-10-02", options: [{ sessionId: session.id, externalActivityId: activity.id }] });
      // Reproduce the wrong-date classification attempt without weakening its guard.
      expect(await call("classify_external_activity", {
        expectedExternalActivityId: activity.id, expectedLocalDate: "2026-10-02",
        expectedActiveProgramId: program.id, expectedActiveVersionId: program.activeVersionId,
        expectedLockVersion: program.lockVersion, expectedCurrentClassificationId: null,
        classification: { kind: "program_workout", workoutPosition: 1 }
      })).toMatchObject({ outcome: "not_pending" });
      const command = { sessionId: session.id, externalActivityId: activity.id, expectedExternalActivityId: null };
      expect(await call("confirm_workout_activity_link", command)).toMatchObject({ outcome: "created" });
      expect(await call("confirm_workout_activity_link", command)).toMatchObject({ outcome: "unchanged" });
      const after = await call("get_training_context_v2", { localDate: "2026-10-04", historyLimit: 1 });
      expect(after.pendingActivityLinkQuestion).toBeUndefined();
      // Rolling frequency is advisory, but the linked event must count exactly once.
      expect(after.nextStep).toMatchObject({ state: "training_options", strength: { workoutPosition: 2, workoutName: "Ahilej B" } });
      expect(after.nextStep.recentProgress).toMatchObject({ strengthCompleted: 1, strengthTarget: 2, targetMeaning: "guidance" });
      const sessions = await call("list_workout_sessions_v2", { localDate: "2026-10-02" });
      expect(sessions.items).toHaveLength(1);
      expect(sessions.items[0]).toMatchObject({ id: session.id, externalActivityId: activity.id, completionState: "completed" });
    } finally { await fastify.close(); }
  });

  it("accepts historical classification against the exact date of the displayed context", async () => {
    const { fastify, call, importActivity } = await fixture();
    try {
      const activity = await importActivity();
      const before = await call("get_training_context_v2", { localDate: "2026-10-04", historyLimit: 1 });
      const program = before.program;
      expect(before.nextStep).toMatchObject({ state: "needs_classification", localDate: "2026-10-04", externalActivityId: activity.id });
      const command = { expectedExternalActivityId: activity.id, expectedLocalDate: before.nextStep.localDate,
        expectedActiveProgramId: program.id, expectedActiveVersionId: program.activeVersionId,
        expectedLockVersion: program.lockVersion, expectedCurrentClassificationId: null,
        classification: { kind: "program_workout", workoutPosition: 1 } };
      const classified = await call("classify_external_activity", command);
      expect(classified).toMatchObject({ outcome: "created" });
      expect(await call("classify_external_activity", { ...command, expectedCurrentClassificationId: classified.classification.id }))
        .toMatchObject({ outcome: "unchanged" });
      expect(await call("classify_external_activity", command)).toMatchObject({ outcome: "stale" });
      const after = await call("get_training_context_v2", { localDate: "2026-10-04", historyLimit: 1 });
      expect(after.nextStep).toMatchObject({ state: "training_options", strength: { workoutPosition: 2 } });
    } finally { await fastify.close(); }
  });
});
