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
import { TrainingRepository } from "../src/storage/training-repository.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
const personA = "00000000-0000-4000-8000-000000000001";
const personB = "00000000-0000-4000-8000-000000000002";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_training_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  const databaseUrl = container.getConnectionUri();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = personA;
  await runMigrations(databaseUrl);
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
  database = createDatabase(config);
  await database.pool.query(
    `insert into persons (id, kind, status)
     values ($1, 'real', 'active')`,
    [personB]
  );
  app = await buildApp({ config, database });
});

afterAll(async () => {
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

describe("Training PostgreSQL vertical", () => {
  it("applies the complete additive Training schema", async () => {
    const result = await database.pool.query<{ name: string | null }>(
      `select to_regclass('public.training_exercises')::text as name
       union all
       select to_regclass('public.training_programs')::text
       union all
       select to_regclass('public.workout_sessions')::text
       union all
       select to_regclass('public.performed_sets')::text`
    );

    expect(result.rows.map((row) => row.name)).toEqual([
      "training_exercises",
      "training_programs",
      "workout_sessions",
      "performed_sets"
    ]);
  });

  it("reuses shared exercises, isolates private ones, and stages sources idempotently", async () => {
    const fastify = getFastifyInstance(app);
    const shared = await fastify.inject({
      method: "POST",
      url: "/v1/training/catalog/exercises",
      payload: {
        visibility: "shared",
        name: "Приседание со штангой",
        category: "strength",
        movementPattern: "squat",
        equipment: "barbell",
        instructions: null,
        note: null
      }
    });
    const privateExercise = await fastify.inject({
      method: "POST",
      url: "/v1/training/catalog/exercises",
      payload: {
        visibility: "private",
        name: "Домашнее упражнение",
        category: null,
        movementPattern: null,
        equipment: null,
        instructions: null,
        note: null
      }
    });
    const repository = new TrainingRepository(database);

    expect(shared.statusCode, shared.body).toBe(201);
    expect(privateExercise.statusCode, privateExercise.body).toBe(201);
    expect(await repository.findExercise(personB, shared.json().id)).toMatchObject({
      id: shared.json().id,
      visibility: "shared",
      ownerPersonId: null
    });
    expect(
      await repository.findExercise(personB, privateExercise.json().id)
    ).toBeNull();

    const first = await repository.stageExerciseSourceRecord({
      sourceKey: "licensed-example",
      sourceName: "Licensed Example",
      licenseName: "Example license",
      termsUrl: "https://example.test/terms",
      externalRecordId: "squat-1",
      fetchedAt: "2026-07-31T10:00:00.000Z",
      checksum: "checksum-1",
      parserVersion: "1",
      rawSnapshot: { name: "Squat" }
    });
    const duplicate = await repository.stageExerciseSourceRecord({
      sourceKey: "licensed-example",
      sourceName: "Licensed Example",
      licenseName: "Example license",
      termsUrl: "https://example.test/terms",
      externalRecordId: "squat-1",
      fetchedAt: "2026-07-31T10:00:00.000Z",
      checksum: "checksum-1",
      parserVersion: "1"
    });
    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ id: first.id, created: false });
  });

  it("versions and activates programs explicitly, then derives records and progression", async () => {
    const fastify = getFastifyInstance(app);
    const exercise = await fastify.inject({
      method: "POST",
      url: "/v1/training/catalog/exercises",
      payload: {
        visibility: "shared",
        name: "Жим лёжа",
        category: "strength",
        movementPattern: "push",
        equipment: "barbell",
        instructions: null,
        note: null
      }
    });
    expect(exercise.statusCode, exercise.body).toBe(201);
    const exerciseId = exercise.json().id as string;
    const exerciseVersionId = exercise.json().currentVersion.id as string;
    const programPayload = {
      name: "Базовая программа",
      note: null,
      workouts: [
        {
          name: "Тренировка A",
          prescriptions: [
            {
              exerciseVersionId,
              loadBasis: "external_weight",
              targetWeightKg: 100,
              targetSets: 3,
              targetRepsMin: 6,
              targetRepsMax: 8,
              targetRir: 2,
              progressionIncrementKg: 2.5,
              note: null
            }
          ]
        }
      ]
    } as const;
    const program = await fastify.inject({
      method: "POST",
      url: "/v1/training/programs",
      payload: programPayload
    });
    expect(program.statusCode, program.body).toBe(201);
    expect(program.json().activeVersionId).toBeNull();
    const programId = program.json().id as string;
    const versionId = program.json().currentVersion.id as string;
    const repository = new TrainingRepository(database);
    expect(await repository.findProgram(personB, programId)).toBeNull();

    const activation = await fastify.inject({
      method: "POST",
      url: `/v1/training/programs/${programId}/versions/${versionId}/activate`,
      payload: { expectedLockVersion: 0 }
    });
    expect(activation.statusCode, activation.body).toBe(201);
    expect(activation.json().activeVersionId).toBe(versionId);
    expect(activation.json().activeVersion.id).toBe(versionId);
    const activeCount = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from training_programs
        where person_id = $1 and active_version_id is not null`,
      [personA]
    );
    expect(activeCount.rows[0]?.count).toBe("1");

    const sessionPayload = {
      occurredAt: "2026-07-31T07:00:00.000Z",
      timezone: "Europe/Moscow",
      programVersionId: versionId,
      workoutName: "Тренировка A",
      feeling: "good",
      note: null,
      exercises: [
        {
          exerciseVersionId,
          loadBasis: "external_weight",
          feeling: "good",
          note: null,
          sets: [
            { weightKg: 100, reps: 8, rir: 2 },
            { weightKg: 100, reps: 8, rir: 2 },
            { weightKg: 100, reps: 8, rir: 2 }
          ]
        }
      ],
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-07-31T07:00:00.000Z"
      },
      dedupeKey: "training:session:a:1",
      confidence: 1
    } as const;
    const session = await fastify.inject({
      method: "POST",
      url: "/v1/training/sessions",
      payload: sessionPayload
    });
    const duplicate = await fastify.inject({
      method: "POST",
      url: "/v1/training/sessions",
      payload: sessionPayload
    });
    expect(session.statusCode, session.body).toBe(201);
    expect(duplicate.statusCode, duplicate.body).toBe(200);
    expect(duplicate.json().id).toBe(session.json().id);
    expect(session.json().exercises[0].sets).toHaveLength(3);
    expect(
      await repository.findWorkoutSession(personB, session.json().id)
    ).toBeNull();

    const renamedExercise = await fastify.inject({
      method: "POST",
      url: `/v1/training/catalog/exercises/${exerciseId}/versions`,
      payload: {
        expectedLockVersion: 0,
        name: "Жим штанги лёжа",
        category: "strength",
        movementPattern: "push",
        equipment: "barbell",
        instructions: null,
        note: null
      }
    });
    const unchangedProgram = await fastify.inject({
      method: "GET",
      url: `/v1/training/programs/${programId}`
    });
    const unchangedSession = await fastify.inject({
      method: "GET",
      url: `/v1/training/sessions/${session.json().id}`
    });
    expect(renamedExercise.statusCode, renamedExercise.body).toBe(201);
    expect(
      unchangedProgram.json().currentVersion.workouts[0].prescriptions[0]
        .exerciseLabel
    ).toBe("Жим лёжа");
    expect(unchangedSession.json().exercises[0].exerciseLabel).toBe("Жим лёжа");

    const records = await fastify.inject({
      method: "GET",
      url: "/v1/training/personal-records"
    });
    const candidates = await fastify.inject({
      method: "GET",
      url: "/v1/training/progression-candidates"
    });
    expect(records.statusCode, records.body).toBe(200);
    expect(records.json().items).toEqual([
      expect.objectContaining({
        exerciseId,
        weightKg: 100,
        reps: 8,
        sessionId: session.json().id
      })
    ]);
    expect(candidates.statusCode, candidates.body).toBe(200);
    expect(candidates.json().items).toEqual([
      expect.objectContaining({
        programId,
        programVersionId: versionId,
        currentTargetWeightKg: 100,
        suggestedTargetWeightKg: 102.5,
        evidenceSessionId: session.json().id
      })
    ]);

    const candidate = candidates.json().items[0];
    const accepted = await fastify.inject({
      method: "POST",
      url: `/v1/training/programs/${programId}/progression-candidates/accept`,
      payload: {
        expectedLockVersion: 1,
        programVersionId: versionId,
        workoutPosition: candidate.workoutPosition,
        prescriptionPosition: candidate.prescriptionPosition,
        evidenceSessionId: candidate.evidenceSessionId
      }
    });
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(accepted.json().currentVersion.version).toBe(2);
    expect(
      accepted.json().currentVersion.workouts[0].prescriptions[0]
        .targetWeightKg
    ).toBe(102.5);
    expect(accepted.json().activeVersionId).toBe(versionId);
    const candidatesWithDraft = await fastify.inject({
      method: "GET",
      url: "/v1/training/progression-candidates"
    });
    const repeatedAcceptance = await fastify.inject({
      method: "POST",
      url: `/v1/training/programs/${programId}/progression-candidates/accept`,
      payload: {
        expectedLockVersion: 2,
        programVersionId: versionId,
        workoutPosition: candidate.workoutPosition,
        prescriptionPosition: candidate.prescriptionPosition,
        evidenceSessionId: candidate.evidenceSessionId
      }
    });
    expect(candidatesWithDraft.json().items).toEqual([]);
    expect(repeatedAcceptance.statusCode).toBe(409);

    const correctionPayload = {
      ...sessionPayload,
      exercises: [
        {
          ...sessionPayload.exercises[0],
          sets: [
            { weightKg: 105, reps: 6, rir: 2 },
            { weightKg: 105, reps: 6, rir: 2 },
            { weightKg: 105, reps: 6, rir: 2 }
          ]
        }
      ],
      dedupeKey: "training:session:a:1:correction",
      correctionReason: "Исправлен вес"
    } as const;
    const correction = await fastify.inject({
      method: "POST",
      url: `/v1/training/sessions/${session.json().id}/corrections`,
      payload: correctionPayload
    });
    const correctionDuplicate = await fastify.inject({
      method: "POST",
      url: `/v1/training/sessions/${session.json().id}/corrections`,
      payload: correctionPayload
    });
    expect(correction.statusCode, correction.body).toBe(201);
    expect(correctionDuplicate.statusCode, correctionDuplicate.body).toBe(200);
    expect(correction.json().supersedesId).toBe(session.json().id);

    const history = await fastify.inject({
      method: "GET",
      url: `/v1/training/sessions/${session.json().id}/history`
    });
    const currentSessions = await fastify.inject({
      method: "GET",
      url: "/v1/training/sessions?localDate=2026-07-31"
    });
    const correctedRecords = await fastify.inject({
      method: "GET",
      url: "/v1/training/personal-records"
    });
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json().items.map((item: { id: string }) => item.id)).toEqual([
      session.json().id,
      correction.json().id
    ]);
    expect(currentSessions.json().items.map((item: { id: string }) => item.id)).toEqual([
      correction.json().id
    ]);
    expect(correctedRecords.json().items[0]).toMatchObject({
      weightKg: 105,
      reps: 6,
      sessionId: correction.json().id
    });
  });
});
