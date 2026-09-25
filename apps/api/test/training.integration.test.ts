import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "@shape-of-you/config";

import { buildApp, getFastifyInstance } from "../src/app.js";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import {
  createDatabase,
  type DatabaseContext
} from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { TrainingRepository } from "../src/storage/training-repository.js";
import { DailyAssessmentRepository } from "../src/storage/daily-assessment-repository.js";
import {
  DailyAssessmentService,
  derivePersonLocalDate
} from "../src/coaching/daily-assessment.service.js";
import { DailyAssessmentEvidenceChangedError } from "../src/domain/errors.js";
import type { DailyAssessmentPersonalCalculation } from "../src/domain/personalized-daily-assessment.js";
import { TrainingService } from "../src/training/training.service.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
let app: NestFastifyApplication;
let databaseUrl: string;
const personA = "00000000-0000-4000-8000-000000000001";
const personB = "00000000-0000-4000-8000-000000000002";
const personC = "00000000-0000-4000-8000-000000000003";
const personD = "00000000-0000-4000-8000-000000000004";
const personE = "00000000-0000-4000-8000-000000000005";

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_training_test")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  databaseUrl = container.getConnectionUri();
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
     values ($1, 'real', 'active'), ($2, 'real', 'active'), ($3, 'real', 'active'), ($4, 'real', 'active')`,
    [personB, personC, personD, personE]
  );
  app = await buildApp({ config, database });
});

afterAll(async () => {
  await app?.close();
  await database?.pool.end();
  await container?.stop();
});

describe("Training PostgreSQL vertical", () => {
  it("confirms one exact pair explicitly and blocks corrected-lineage double occupancy", async () => {
    const personId = "00000000-0000-4000-8000-000000000008";
    const providerId = "00000000-0000-4000-8000-000000000801";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000802";
    const consentId = "00000000-0000-4000-8000-000000000803";
    const connectionId = "00000000-0000-4000-8000-000000000804";
    await database.pool.query("insert into persons (id, kind, status) values ($1, 'real', 'active')", [personId]);
    await database.pool.query(
      "insert into recovery_providers (id, key, name) values ($1, 'task-0134-confirm-provider', 'TASK-0134 confirm provider')",
      [providerId]
    );
    await database.pool.query(
      "insert into recovery_connections (id, person_id, provider_id, dedupe_key) values ($1, $2, $3, 'task-0134-confirm-connection')",
      [recoveryConnectionId, personId, providerId]
    );
    await database.pool.query(
      "insert into recovery_consents (id, person_id, connection_id, purpose, retention_mode) values ($1, $2, $3, 'training', 'indefinite')",
      [consentId, personId, recoveryConnectionId]
    );
    await database.pool.query(
      "insert into integration_connections (id, person_id, recovery_connection_id, consent_id, provider_key, external_user_id) values ($1, $2, $3, $4, 'task-0134-confirm-provider', 'task-0134-confirm-user')",
      [connectionId, personId, recoveryConnectionId, consentId]
    );
    const repository = new TrainingRepository(database);
    const service = new TrainingService(repository, new SyntheticPersonContext(personId));
    const exercise = await service.createExercise({
      visibility: "private", name: "TASK-0134 confirm squat", category: "strength",
      movementPattern: null, equipment: null, instructions: null, note: null
    });
    const sessionInput = {
      occurredAt: "2026-09-25T16:00:00.000Z", timezone: "Europe/Belgrade",
      programVersionId: null, programWorkoutPosition: null, externalActivityId: null,
      workoutName: "Ahilej B", feeling: null, note: null,
      exercises: [{ exerciseVersionId: exercise.currentVersion.id,
        loadBasis: "external_weight" as const, feeling: null, note: null,
        sets: [{ weightKg: 40, reps: 8, rir: 2 }] }],
      sourceReference: { channel: "manual" as const, externalSystem: null,
        externalRecordId: null, occurredAt: "2026-09-25T16:00:00.000Z" },
      dedupeKey: "task-0134-explicit-first", confidence: 1
    };
    const firstSession = (await service.createWorkoutSession(sessionInput)).session;
    const otherSession = (await service.createWorkoutSession({
      ...sessionInput, occurredAt: "2026-09-25T18:00:00.000Z",
      sourceReference: { ...sessionInput.sourceReference,
        occurredAt: "2026-09-25T18:00:00.000Z" },
      dedupeKey: "task-0134-explicit-other"
    })).session;
    const importInput = {
      connectionId, personId, consentId,
      providerIdentity: "task-0134-confirm-activity", normalizedChecksum: "a".repeat(64),
      occurredAt: "2026-09-25T15:50:00.000Z", localDate: "2026-09-25",
      timezone: "Europe/Belgrade", name: "Силовая тренировка", durationSeconds: 3600,
      distanceMeters: null, trainingLoad: 50,
      trainingLoadBasis: "relative_training_stress" as const,
      trainingLoadBasisVersion: "1", averageHeartRate: 120,
      maximumHeartRate: 150, deviceName: "Garmin", sourceProvider: "intervals_icu",
      garminAttributed: true
    };
    expect(await repository.importExternalActivity(importInput)).toBe("created");
    const firstActivity = (await repository.listExternalActivities(personId, 10))[0]!;
    const command = { sessionId: firstSession.id,
      externalActivityId: firstActivity.id, expectedExternalActivityId: null };
    expect(await service.confirmWorkoutActivityLink(command)).toMatchObject({ outcome: "created" });
    expect(await service.confirmWorkoutActivityLink(command)).toMatchObject({ outcome: "unchanged" });
    expect(await repository.confirmWorkoutActivityLink(personB, command)).toMatchObject({ outcome: "stale" });
    expect(await service.confirmWorkoutActivityLink({ ...command, sessionId: otherSession.id }))
      .toMatchObject({ outcome: "stale" });
    expect(await repository.importExternalActivity({ ...importInput,
      normalizedChecksum: "b".repeat(64), name: "Strength corrected" })).toBe("corrected");
    const currentActivity = (await repository.listExternalActivities(personId, 10))[0]!;
    expect(currentActivity.id).not.toBe(firstActivity.id);
    expect(await service.confirmWorkoutActivityLink({
      sessionId: otherSession.id, externalActivityId: currentActivity.id,
      expectedExternalActivityId: null
    })).toMatchObject({ outcome: "stale" });
    expect(await service.confirmWorkoutActivityLink({ ...command,
      externalActivityId: currentActivity.id })).toMatchObject({ outcome: "unchanged" });
    expect(currentActivity.classification).toBeNull();
    const links = await database.pool.query<{ session_id: string; match_basis: string | null }>(
      "select session_id, match_basis from training_workout_session_activity_links where person_id = $1",
      [personId]
    );
    expect(links.rows).toEqual([{ session_id: firstSession.id, match_basis: null }]);
    await service.setActivityRecordingMode({ expectedLockVersion: 0, title: "Силовая тренировка" });
    await repository.importExternalActivity({
      ...importInput, providerIdentity: "task-0134-confirm-second-activity",
      normalizedChecksum: "c".repeat(64), occurredAt: "2026-09-25T18:05:00.000Z"
    });
    const secondActivity = (await repository.listExternalActivities(personId, 10))
      .find((item) => item.providerIdentity === "task-0134-confirm-second-activity")!;
    const automatic = await database.pool.query<{ match_basis: string }>(
      "select match_basis from training_workout_session_activity_links where session_id = $1",
      [otherSession.id]
    );
    expect(automatic.rows[0]?.match_basis).toBe("confirmed_recording_context");
    expect(await service.confirmWorkoutActivityLink({
      sessionId: otherSession.id, externalActivityId: secondActivity.id,
      expectedExternalActivityId: null
    })).toMatchObject({ outcome: "stale" });
    const unchangedAutomatic = await database.pool.query<{ match_basis: string }>(
      "select match_basis from training_workout_session_activity_links where session_id = $1",
      [otherSession.id]
    );
    expect(unchangedAutomatic.rows[0]?.match_basis).toBe("confirmed_recording_context");
  });

  it("versions Person-wide recording mode and preserves venue on immutable correction", async () => {
    const personId = "00000000-0000-4000-8000-000000000007";
    await database.pool.query(
      "insert into persons (id, kind, status) values ($1, 'real', 'active')",
      [personId]
    );
    const repository = new TrainingRepository(database);
    const service = new TrainingService(repository, new SyntheticPersonContext(personId));
    expect(await service.readActivityRecordingMode()).toEqual({
      title: null, lockVersion: 0, updatedAt: null
    });
    const first = await service.setActivityRecordingMode({
      expectedLockVersion: 0, title: "  Силовая   тренировка  "
    });
    expect(first).toMatchObject({
      outcome: "created", current: { title: "Силовая тренировка", lockVersion: 1 }
    });
    expect(await repository.readActivityRecordingMode(personB)).toEqual({
      title: null, lockVersion: 0, updatedAt: null
    });
    expect(await service.setActivityRecordingMode({
      expectedLockVersion: 0, title: "Another mode"
    })).toMatchObject({ outcome: "stale", current: { lockVersion: 1 } });
    expect(await service.setActivityRecordingMode({
      expectedLockVersion: 1, title: null
    })).toMatchObject({ outcome: "revoked", current: { title: null, lockVersion: 2 } });
    expect(await service.setActivityRecordingMode({
      expectedLockVersion: 1, title: "Силовая тренировка"
    })).toMatchObject({ outcome: "stale", current: { title: null, lockVersion: 2 } });

    const exercise = await service.createExercise({
      visibility: "private", name: "TASK-0134 venue roundtrip", category: "strength",
      movementPattern: null, equipment: null, instructions: null, note: null
    });
    const sessionInput = {
      occurredAt: "2026-09-25T16:00:00.000Z", timezone: "Europe/Belgrade",
      programVersionId: null, programWorkoutPosition: null, externalActivityId: null,
      venueLabel: "Ahilej", workoutName: "Strength", feeling: null, note: null,
      exercises: [{ exerciseVersionId: exercise.currentVersion.id,
        loadBasis: "external_weight" as const, feeling: null, note: null,
        sets: [{ weightKg: 40, reps: 8, rir: 2 }] }],
      sourceReference: { channel: "manual" as const, externalSystem: null,
        externalRecordId: null, occurredAt: "2026-09-25T16:00:00.000Z" },
      dedupeKey: "task-0134-venue-create", confidence: 1
    };
    const created = await service.createWorkoutSession(sessionInput);
    expect(created.session.venueLabel).toBe("Ahilej");
    const corrected = await service.correctWorkoutSession(created.session.id, {
      ...sessionInput, venueLabel: "Another gym", dedupeKey: "task-0134-venue-correct",
      correctionReason: "Corrected venue"
    });
    expect(corrected.session.venueLabel).toBe("Another gym");
    expect((await repository.findWorkoutSession(personId, created.session.id))?.venueLabel).toBe("Ahilej");
  });

  it("applies the complete additive Training schema", async () => {
    const result = await database.pool.query<{ name: string | null }>(
      `select to_regclass('public.training_exercises')::text as name
       union all
       select to_regclass('public.training_programs')::text
       union all
       select to_regclass('public.workout_sessions')::text
       union all
       select to_regclass('public.performed_sets')::text
       union all
       select to_regclass('public.external_activity_program_classifications')::text`
    );

    expect(result.rows.map((row) => row.name)).toEqual([
      "training_exercises",
      "training_programs",
      "workout_sessions",
      "performed_sets",
      "external_activity_program_classifications"
    ]);
  });

  it("links exact source evidence after late import and rechecks corrections without duplicates", async () => {
    const repository = new TrainingRepository(database);
    const service = new TrainingService(repository, new SyntheticPersonContext(personE));
    const providerId = "00000000-0000-4000-8000-000000000601";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000602";
    const consentId = "00000000-0000-4000-8000-000000000603";
    const connectionId = "00000000-0000-4000-8000-000000000604";
    await database.pool.query(
      "insert into recovery_providers (id, key, name) values ($1, 'task-0133-provider', 'TASK-0133 provider')",
      [providerId]
    );
    await database.pool.query(
      "insert into recovery_connections (id, person_id, provider_id, dedupe_key) values ($1, $2, $3, 'task-0133-connection')",
      [recoveryConnectionId, personE, providerId]
    );
    await database.pool.query(
      "insert into recovery_consents (id, person_id, connection_id, purpose, retention_mode) values ($1, $2, $3, 'training', 'indefinite')",
      [consentId, personE, recoveryConnectionId]
    );
    await database.pool.query(
      "insert into integration_connections (id, person_id, recovery_connection_id, consent_id, provider_key, external_user_id) values ($1, $2, $3, $4, 'task-0133-provider', 'task-0133-user')",
      [connectionId, personE, recoveryConnectionId, consentId]
    );
    const exercise = await service.createExercise({
      visibility: "private", name: "TASK-0133 squat", category: "strength",
      movementPattern: null, equipment: null, instructions: null, note: null
    });
    const sessionInput = {
      occurredAt: "2026-09-23T16:00:00.000Z", timezone: "Europe/Belgrade",
      programVersionId: null, programWorkoutPosition: null, externalActivityId: null,
      workoutName: "Ahilej B", feeling: null, note: null,
      exercises: [{
        exerciseVersionId: exercise.currentVersion.id, loadBasis: "external_weight" as const,
        feeling: null, note: null, sets: [{ weightKg: 40, reps: 8, rir: 2 }]
      }],
      sourceReference: {
        channel: "import" as const, externalSystem: "intervals_icu",
        externalRecordId: "task-0133-exact-activity", occurredAt: "2026-09-23T16:00:00.000Z"
      },
      dedupeKey: "task-0133-session-1", confidence: 1
    };
    const session = await service.createWorkoutSession(sessionInput);
    expect(session.session.externalActivityId).toBeNull();
    const importInput = {
      connectionId, personId: personE, consentId,
      providerIdentity: "task-0133-exact-activity", normalizedChecksum: "e".repeat(64),
      occurredAt: "2026-09-23T16:05:00.000Z", localDate: "2026-09-23",
      timezone: "Europe/Belgrade", name: "Strength Training", durationSeconds: 3600,
      distanceMeters: null, trainingLoad: 60,
      trainingLoadBasis: "relative_training_stress" as const,
      trainingLoadBasisVersion: "1", averageHeartRate: 120,
      maximumHeartRate: 160, deviceName: "Garmin", sourceProvider: "intervals_icu",
      garminAttributed: true
    };
    await expect(repository.importExternalActivity(importInput)).resolves.toBe("created");
    const first = (await repository.listExternalActivities(personE, 10))[0]!;
    expect((await repository.findWorkoutSession(personE, session.session.id))?.externalActivityId).toBe(first.id);
    expect(first.sessionCovered).toBe(true);
    await repository.reconcileRecentActivityLinks(personE, "2026-09-23", "2026-09-23");
    const linkCount = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from training_workout_session_activity_links where person_id = $1",
      [personE]
    );
    expect(linkCount.rows[0]?.count).toBe("1");
    await expect(repository.importExternalActivity({
      ...importInput, normalizedChecksum: "f".repeat(64), name: "Strength corrected"
    })).resolves.toBe("corrected");
    const corrected = (await repository.listExternalActivities(personE, 10))[0]!;
    expect(corrected.id).not.toBe(first.id);
    expect((await repository.findWorkoutSession(personE, session.session.id))?.externalActivityId).toBe(corrected.id);
    const linkRows = await database.pool.query<{ match_basis: string; match_policy_version: string }>(
      "select match_basis, match_policy_version from training_workout_session_activity_links where person_id = $1",
      [personE]
    );
    expect(linkRows.rows).toEqual([{
      match_basis: "source_identity", match_policy_version: "automatic-activity-link-v2"
    }]);
    await expect(repository.importExternalActivity({
      ...importInput, normalizedChecksum: "0".repeat(64), localDate: "2026-09-24",
      occurredAt: "2026-09-24T16:05:00.000Z"
    })).resolves.toBe("corrected");
    expect((await repository.findWorkoutSession(personE, session.session.id))?.externalActivityId).toBeNull();

    const savedProgram = await service.saveConfirmedProgram({
      expectedActiveProgramId: null, expectedLockVersion: null,
      name: "TASK-0133 program", note: null,
      cadence: {
        kind: "rolling_weekly", strengthSessionsPerWeek: 2,
        workoutSequence: [1], lightCardio: null
      },
      workouts: [{
        name: "Ahilej C",
        prescriptions: [{
          exercise: {
            name: "TASK-0133 squat", category: "strength", movementPattern: null,
            equipment: null, instructions: null, note: null
          },
          loadBasis: "external_weight", targetWeightKg: 40,
          targetSets: 1, targetRepsMin: 8, targetRepsMax: 10,
          targetRir: 2, progressionIncrementKg: 2, note: null
        }]
      }]
    });
    const namedSessionInput = {
      ...sessionInput,
      occurredAt: "2026-09-25T16:00:00.000Z",
      programVersionId: savedProgram.program!.activeVersionId!,
      programWorkoutPosition: 1,
      workoutName: "Ahilej C",
      sourceReference: {
        channel: "manual" as const, externalSystem: null, externalRecordId: null,
        occurredAt: "2026-09-25T16:00:00.000Z"
      },
      dedupeKey: "task-0133-named-session-1"
    };
    const namedSession = await service.createWorkoutSession(namedSessionInput);
    await expect(repository.importExternalActivity({
      ...importInput, providerIdentity: "task-0133-named-activity",
      normalizedChecksum: "1".repeat(64), localDate: "2026-09-25",
      occurredAt: "2026-09-25T16:06:00.000Z", name: "Ahilej C"
    })).resolves.toBe("created");
    expect((await repository.findWorkoutSession(personE, namedSession.session.id))?.externalActivityId).toBeNull();
    const trustCommand = {
      expectedProgramId: savedProgram.program!.id,
      expectedProgramVersionId: savedProgram.program!.activeVersionId!,
      expectedLockVersion: savedProgram.program!.lockVersion,
      workoutPosition: 1,
      expectedCurrentTitle: null,
      title: "Ahilej C"
    };
    await expect(service.setTrustedExternalActivityTitle(trustCommand)).resolves.toEqual({
      outcome: "created", currentTitle: "Ahilej C"
    });
    await expect(service.setTrustedExternalActivityTitle(trustCommand)).resolves.toEqual({
      outcome: "unchanged", currentTitle: "Ahilej C"
    });
    await expect(service.setTrustedExternalActivityTitle({
      ...trustCommand, title: "Other title"
    })).resolves.toEqual({ outcome: "stale", currentTitle: "Ahilej C" });
    expect(await service.listTrustedExternalActivityTitles(trustCommand.expectedProgramId, trustCommand.expectedProgramVersionId))
      .toEqual([{ programVersionId: trustCommand.expectedProgramVersionId,
        workoutPosition: 1, title: "Ahilej C" }]);
    expect((await repository.findWorkoutSession(personE, namedSession.session.id))?.externalActivityId)
      .not.toBeNull();
    await expect(service.setTrustedExternalActivityTitle({
      ...trustCommand, expectedCurrentTitle: "Ahilej C", title: "Other title"
    })).resolves.toEqual({ outcome: "replaced", currentTitle: "Other title" });
    expect((await repository.findWorkoutSession(personE, namedSession.session.id))?.externalActivityId).toBeNull();
    await expect(service.setTrustedExternalActivityTitle({
      ...trustCommand, expectedCurrentTitle: "Other title"
    })).resolves.toEqual({ outcome: "replaced", currentTitle: "Ahilej C" });
    expect((await repository.findWorkoutSession(personE, namedSession.session.id))?.externalActivityId)
      .not.toBeNull();
    const competitor = await service.createWorkoutSession({
      ...namedSessionInput, dedupeKey: "task-0133-named-session-2"
    });
    expect((await repository.findWorkoutSession(personE, namedSession.session.id))?.externalActivityId).toBeNull();
    expect((await repository.findWorkoutSession(personE, competitor.session.id))?.externalActivityId).toBeNull();
    await service.correctWorkoutSession(competitor.session.id, {
      ...namedSessionInput,
      workoutName: "Other session",
      dedupeKey: "task-0133-named-session-2-corrected",
      correctionReason: "Corrected workout identity"
    });
    const namedActivity = (await repository.listExternalActivities(personE, 10))
      .find((item) => item.providerIdentity === "task-0133-named-activity")!;
    expect((await repository.findWorkoutSession(personE, namedSession.session.id))?.externalActivityId)
      .toBe(namedActivity.id);
    expect(namedActivity.classification).toBeNull();
    expect(namedActivity.sessionCovered).toBe(true);
    await expect(repository.importExternalActivity({
      ...importInput, providerIdentity: "task-0133-named-activity",
      normalizedChecksum: "3".repeat(64), localDate: "2026-09-25",
      occurredAt: "2026-09-25T16:06:00.000Z", name: "Strength Training"
    })).resolves.toBe("corrected");
    expect((await repository.findWorkoutSession(personE, namedSession.session.id))?.externalActivityId)
      .toBeNull();

    await expect(repository.importExternalActivity({
      ...importInput, providerIdentity: "task-0133-named-activity",
      normalizedChecksum: "4".repeat(64), localDate: "2026-09-25",
      occurredAt: "2026-09-25T16:06:00.000Z", name: "Ahilej C"
    })).resolves.toBe("corrected");
    expect((await repository.findWorkoutSession(personE, namedSession.session.id))?.externalActivityId)
      .not.toBeNull();

    await expect(service.setTrustedExternalActivityTitle({
      ...trustCommand, expectedCurrentTitle: "Ahilej C", title: null
    })).resolves.toEqual({ outcome: "revoked", currentTitle: null });
    expect((await repository.findWorkoutSession(personE, namedSession.session.id))?.externalActivityId)
      .toBeNull();
    expect(await service.listTrustedExternalActivityTitles(trustCommand.expectedProgramId, trustCommand.expectedProgramVersionId))
      .toEqual([]);

    await expect(repository.importExternalActivity({
      ...importInput, providerIdentity: "task-0133-activity-first",
      normalizedChecksum: "2".repeat(64), localDate: "2026-09-26",
      occurredAt: "2026-09-26T16:05:00.000Z", name: "Strength Training"
    })).resolves.toBe("created");
    const activityFirst = (await repository.listExternalActivities(personE, 10))
      .find((item) => item.providerIdentity === "task-0133-activity-first")!;
    const sessionAfterActivity = await service.createWorkoutSession({
      ...sessionInput,
      occurredAt: "2026-09-26T16:00:00.000Z",
      sourceReference: {
        channel: "import", externalSystem: "intervals_icu",
        externalRecordId: "task-0133-activity-first",
        occurredAt: "2026-09-26T16:00:00.000Z"
      },
      dedupeKey: "task-0133-session-after-activity"
    });
    expect(sessionAfterActivity.session.externalActivityId).toBe(activityFirst.id);
  });

  it("reconciles confirmed generic Garmin recording mode without assigning A or B from its title", async () => {
    const oldDay = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    const firstDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const secondDay = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const personId = "00000000-0000-4000-8000-000000000006";
    const providerId = "00000000-0000-4000-8000-000000000611";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000612";
    const consentId = "00000000-0000-4000-8000-000000000613";
    const connectionId = "00000000-0000-4000-8000-000000000614";
    await database.pool.query("insert into persons (id, kind, status) values ($1, 'real', 'active')", [personId]);
    await database.pool.query(
      "insert into recovery_providers (id, key, name) values ($1, 'task-0134-provider', 'TASK-0134 provider')",
      [providerId]
    );
    await database.pool.query(
      "insert into recovery_connections (id, person_id, provider_id, dedupe_key) values ($1, $2, $3, 'task-0134-connection')",
      [recoveryConnectionId, personId, providerId]
    );
    await database.pool.query(
      "insert into recovery_consents (id, person_id, connection_id, purpose, retention_mode) values ($1, $2, $3, 'training', 'indefinite')",
      [consentId, personId, recoveryConnectionId]
    );
    await database.pool.query(
      "insert into integration_connections (id, person_id, recovery_connection_id, consent_id, provider_key, external_user_id) values ($1, $2, $3, $4, 'task-0134-provider', 'task-0134-user')",
      [connectionId, personId, recoveryConnectionId, consentId]
    );
    const repository = new TrainingRepository(database);
    const service = new TrainingService(repository, new SyntheticPersonContext(personId));
    const exercise = await service.createExercise({
      visibility: "private", name: "TASK-0134 squat", category: "strength",
      movementPattern: null, equipment: null, instructions: null, note: null
    });
    const program = await service.saveConfirmedProgram({
      expectedActiveProgramId: null, expectedLockVersion: null,
      name: "TASK-0134 A/B", note: null,
      cadence: { kind: "rolling_weekly", strengthSessionsPerWeek: 2,
        workoutSequence: [1, 2], lightCardio: null },
      workouts: ["Ahilej A", "Ahilej B"].map((name) => ({
        name,
        prescriptions: [{
          exercise: { name: "TASK-0134 squat", category: "strength" as const,
            movementPattern: null, equipment: null, instructions: null, note: null },
          loadBasis: "external_weight" as const, targetWeightKg: 40,
          targetSets: 1, targetRepsMin: 8, targetRepsMax: 10,
          targetRir: 2, progressionIncrementKg: 2, note: null
        }]
      }))
    });
    const versionId = program.program!.activeVersionId!;
    const sessionInput = (day: string, position: number, start: string) => ({
      occurredAt: start, timezone: "Europe/Belgrade", venueLabel: "Ahilej",
      programVersionId: versionId, programWorkoutPosition: position,
      externalActivityId: null, workoutName: `Ahilej ${position === 1 ? "A" : "B"}`,
      feeling: null, note: null,
      exercises: [{ exerciseVersionId: exercise.currentVersion.id,
        loadBasis: "external_weight" as const, feeling: null, note: null,
        sets: [{ weightKg: 40, reps: 8, rir: 2 }] }],
      sourceReference: { channel: "manual" as const, externalSystem: null,
        externalRecordId: null, occurredAt: start },
      dedupeKey: `task-0134-${day}-${position}`, confidence: 1
    });
    const importInput = (identity: string, start: string, checksum: string) => ({
      connectionId, personId, consentId, providerIdentity: identity,
      normalizedChecksum: checksum.repeat(64), occurredAt: start,
      localDate: start.slice(0, 10), timezone: "Europe/Belgrade",
      name: "Силовая тренировка", durationSeconds: 2765, distanceMeters: null,
      trainingLoad: 15, trainingLoadBasis: "relative_training_stress" as const,
      trainingLoadBasisVersion: "1", averageHeartRate: 104,
      maximumHeartRate: 127, deviceName: "Garmin Forerunner 970",
      sourceProvider: "intervals_icu", garminAttributed: true
    });
    const b = await service.createWorkoutSession(sessionInput(firstDay, 2, `${firstDay}T18:10:00.000Z`));
    await repository.importExternalActivity(importInput("task-0134-b", `${firstDay}T17:57:09.000Z`, "a"));
    const activityB = (await repository.listExternalActivities(personId, 10))[0]!;
    expect((await repository.findWorkoutSession(personId, b.session.id))?.externalActivityId).toBeNull();
    expect(await repository.setActivityRecordingMode(personId, {
      expectedLockVersion: 0, title: "Силовая тренировка"
    })).toMatchObject({ outcome: "created", current: { lockVersion: 1 } });
    expect((await repository.findWorkoutSession(personId, b.session.id))?.externalActivityId).toBe(activityB.id);
    const link = await database.pool.query<{ match_basis: string; match_policy_version: string }>(
      "select match_basis, match_policy_version from training_workout_session_activity_links where session_id = $1",
      [b.session.id]
    );
    expect(link.rows).toEqual([{
      match_basis: "confirmed_recording_context", match_policy_version: "automatic-activity-link-v3"
    }]);
    expect((await repository.listExternalActivities(personId, 10))[0]?.classification).toBeNull();

    const historical = await service.createWorkoutSession(
      sessionInput(oldDay, 1, `${oldDay}T18:10:00.000Z`)
    );
    await repository.importExternalActivity(importInput(
      "task-0134-historical", `${oldDay}T18:00:00.000Z`, "d"
    ));
    expect((await repository.findWorkoutSession(personId, historical.session.id))?.externalActivityId)
      .not.toBeNull();

    const a = await service.createWorkoutSession(sessionInput(secondDay, 1, `${secondDay}T18:10:00.000Z`));
    const replacementVersionId = "00000000-0000-4000-8000-000000000615";
    await database.pool.query(
      "insert into training_program_versions (id, program_id, person_id, version, name, note) values ($1, $2, $3, 2, 'New program version', null)",
      [replacementVersionId, program.program!.id, personId]
    );
    await database.pool.query(
      "insert into training_program_workouts (program_version_id, position, name) values ($1, 1, 'Other strength')",
      [replacementVersionId]
    );
    await database.pool.query(
      "update training_programs set active_version_id = $1, current_version_id = $1, lock_version = lock_version + 1 where id = $2",
      [replacementVersionId, program.program!.id]
    );
    await database.pool.query(
      "insert into training_program_workout_activity_titles (program_version_id, workout_position, person_id, title, normalized_title) values ($1, 1, $2, 'Ahilej A imported', 'ahilej a imported')",
      [versionId, personId]
    );
    expect(await repository.listActivityLinkProgramContextForLocalDate(personId, secondDay))
      .toContainEqual({ sessionId: a.session.id, programWorkoutName: "Ahilej A",
        trustedExternalTitle: "Ahilej A imported" });

    await repository.importExternalActivity(importInput("task-0134-a-1", `${secondDay}T18:00:00.000Z`, "b"));
    expect((await repository.findWorkoutSession(personId, a.session.id))?.externalActivityId).not.toBeNull();
    await repository.importExternalActivity(importInput("task-0134-a-2", `${secondDay}T18:05:00.000Z`, "c"));
    expect((await repository.findWorkoutSession(personId, a.session.id))?.externalActivityId).toBeNull();
    const ambiguousContext = await service.getTrainingContext({ localDate: secondDay, historyLimit: 1 });
    expect(ambiguousContext.recentExternalActivities).toHaveLength(1);
    expect(ambiguousContext.pendingActivityLinkQuestion).toMatchObject({
      localDate: secondDay,
      options: [
        { sessionId: a.session.id, venueLabel: "Ahilej" },
        { sessionId: a.session.id, venueLabel: "Ahilej" }
      ]
    });
    for (let index = 0; index < 19; index += 1) {
      await repository.importExternalActivity(importInput(
        `task-0134-a-extra-${index}`, `${secondDay}T18:00:00.000Z`,
        String.fromCharCode(101 + index)
      ));
    }
    const crowdedContext = await service.getTrainingContext({ localDate: secondDay, historyLimit: 1 });
    expect(crowdedContext.pendingActivityLinkQuestion?.options).toHaveLength(20);
    expect(crowdedContext.pendingActivityLinkQuestion?.question).toContain("найдено 21 возможных пар");
    await repository.reconcileRecentActivityLinks(personId, firstDay, secondDay);
    expect((await repository.findWorkoutSession(personId, a.session.id))?.externalActivityId).toBeNull();
    expect(await repository.setActivityRecordingMode(personId, {
      expectedLockVersion: 1, title: null
    })).toMatchObject({ outcome: "revoked", current: { lockVersion: 2, title: null } });
    expect((await repository.findWorkoutSession(personId, b.session.id))?.externalActivityId).toBeNull();
    expect((await repository.findWorkoutSession(personId, historical.session.id))?.externalActivityId)
      .toBeNull();
  });

  it("classifies one external lineage append-only across provider correction and erasure", async () => {
    const repository = new TrainingRepository(database);
    const service = new TrainingService(
      repository,
      new SyntheticPersonContext(personD)
    );
    const saved = await service.saveConfirmedProgram({
      expectedActiveProgramId: null,
      expectedLockVersion: null,
      name: "Imported A/B",
      note: null,
      cadence: {
        kind: "rolling_weekly",
        strengthSessionsPerWeek: 4,
        workoutSequence: [1, 2],
        lightCardio: null
      },
      workouts: ["A", "B"].map((name) => ({
        name,
        prescriptions: [{
          exercise: {
            name: `TASK-0130 ${name}`,
            category: "strength",
            movementPattern: null,
            equipment: null,
            instructions: null,
            note: null
          },
          loadBasis: "external_weight" as const,
          targetWeightKg: 20,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          targetRir: 2,
          progressionIncrementKg: 2,
          note: null
        }]
      }))
    });
    expect(saved.outcome).toBe("created");
    const program = saved.program!;
    const versionId = program.activeVersionId!;

    const providerId = "00000000-0000-4000-8000-000000000501";
    const recoveryConnectionId = "00000000-0000-4000-8000-000000000502";
    const consentId = "00000000-0000-4000-8000-000000000503";
    const connectionId = "00000000-0000-4000-8000-000000000504";
    await database.pool.query(
      "insert into recovery_providers (id, key, name) values ($1, $2, 'TASK-0130 provider')",
      [providerId, "task-0130-provider"]
    );
    await database.pool.query(
      "insert into recovery_connections (id, person_id, provider_id, dedupe_key) values ($1, $2, $3, $4)",
      [recoveryConnectionId, personD, providerId, "task-0130-connection"]
    );
    await database.pool.query(
      "insert into recovery_consents (id, person_id, connection_id, purpose, retention_mode) values ($1, $2, $3, 'training', 'indefinite')",
      [consentId, personD, recoveryConnectionId]
    );
    await database.pool.query(
      "insert into integration_connections (id, person_id, recovery_connection_id, consent_id, provider_key, external_user_id) values ($1, $2, $3, $4, $5, 'task-0130-user')",
      [
        connectionId,
        personD,
        recoveryConnectionId,
        consentId,
        "task-0130-provider"
      ]
    );
    const activity = {
      connectionId,
      personId: personD,
      consentId,
      providerIdentity: "strength-1",
      normalizedChecksum: "a".repeat(64),
      occurredAt: "2026-09-21T06:00:00.000Z",
      localDate: "2026-09-21",
      timezone: "Europe/Belgrade",
      name: "Strength",
      durationSeconds: 3600,
      distanceMeters: null,
      trainingLoad: 60,
      trainingLoadBasis: "relative_training_stress" as const,
      trainingLoadBasisVersion: "1",
      averageHeartRate: 120,
      maximumHeartRate: 160,
      deviceName: null,
      sourceProvider: "intervals_icu",
      garminAttributed: true
    };
    await expect(repository.importExternalActivity({
      ...activity,
      providerIdentity: "strength-old-week",
      normalizedChecksum: "0".repeat(64),
      occurredAt: "2026-09-20T06:00:00.000Z",
      localDate: "2026-09-20"
    })).resolves.toBe("created");
    await expect(repository.importExternalActivity(activity)).resolves.toBe("created");
    await expect(repository.importExternalActivity({
      ...activity,
      providerIdentity: "strength-future",
      normalizedChecksum: "f".repeat(64),
      occurredAt: "2026-09-23T06:00:00.000Z",
      localDate: "2026-09-23"
    })).resolves.toBe("created");
    const firstActivity = (await repository.listExternalActivities(personD, 10))
      .find((candidate) => candidate.providerIdentity === "strength-1")!;
    await expect(service.getTrainingContext({
      historyLimit: 10,
      localDate: "2026-09-21"
    })).resolves.toMatchObject({
      nextStep: {
        state: "needs_classification",
        externalActivityId: firstActivity.id
      }
    });
    const dailyRepository = new DailyAssessmentRepository(database);
    const revisionBeforeClassification = await dailyRepository.getEvidenceRevision(
      personD,
      "2026-09-01",
      "2026-09-30"
    );
    const command = {
      expectedExternalActivityId: firstActivity.id,
      expectedLocalDate: "2026-09-21",
      expectedActiveProgramId: program.id,
      expectedActiveVersionId: versionId,
      expectedLockVersion: program.lockVersion,
      expectedCurrentClassificationId: null,
      classification: { kind: "program_workout" as const, workoutPosition: 1 }
    };
    const created = await service.classifyExternalActivity(command);
    expect(created).toMatchObject({ outcome: "created" });
    await expect(dailyRepository.getEvidenceRevision(
      personD,
      "2026-09-01",
      "2026-09-30"
    )).resolves.not.toBe(revisionBeforeClassification);
    await expect(service.classifyExternalActivity({
      ...command,
      expectedCurrentClassificationId: created.classification!.id
    })).resolves.toMatchObject({ outcome: "unchanged" });
    const corrected = await service.classifyExternalActivity({
      ...command,
      expectedCurrentClassificationId: created.classification!.id,
      classification: { kind: "program_workout", workoutPosition: 2 }
    });
    expect(corrected).toMatchObject({ outcome: "corrected" });
    await expect(service.classifyExternalActivity(command)).resolves.toMatchObject({
      outcome: "stale"
    });
    await expect(new TrainingService(
      repository,
      new SyntheticPersonContext(personA)
    ).classifyExternalActivity(command)).resolves.toMatchObject({ outcome: "stale" });
    const appendOnlyRows = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from external_activity_program_classifications where person_id = $1",
      [personD]
    );
    expect(appendOnlyRows.rows[0]?.count).toBe("2");

    await expect(repository.importExternalActivity({
      ...activity,
      providerIdentity: "strength-before-last-classified",
      normalizedChecksum: "c".repeat(64),
      occurredAt: "2026-09-21T05:00:00.000Z"
    })).resolves.toBe("created");
    await expect(service.getTrainingContext({
      historyLimit: 1,
      localDate: "2026-09-22"
    })).resolves.toMatchObject({ nextStep: { state: "strength" } });

    await expect(repository.importExternalActivity({
      ...activity,
      providerIdentity: "strength-stale-after-session",
      normalizedChecksum: "d".repeat(64),
      occurredAt: "2026-09-22T07:00:00.000Z",
      localDate: "2026-09-22"
    })).resolves.toBe("created");
    const staleAfterSessionActivity = (await repository.listExternalActivities(personD, 10))
      .find((candidate) => candidate.providerIdentity === "strength-stale-after-session")!;
    await expect(service.getTrainingContext({
      historyLimit: 1,
      localDate: "2026-09-22"
    })).resolves.toMatchObject({
      nextStep: {
        state: "needs_classification",
        externalActivityId: staleAfterSessionActivity.id
      }
    });
    const exerciseVersionId = program.activeVersion!.workouts[0]!
      .prescriptions[0]!.exerciseVersionId;
    await service.createWorkoutSession({
      occurredAt: "2026-09-22T08:00:00.000Z",
      timezone: "Europe/Belgrade",
      programVersionId: versionId,
      programWorkoutPosition: 2,
      externalActivityId: null,
      workoutName: "B detail",
      feeling: null,
      note: null,
      exercises: [{
        exerciseVersionId,
        loadBasis: "external_weight",
        feeling: null,
        note: null,
        sets: [{ weightKg: 20, reps: 8, rir: 2 }]
      }],
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-09-22T08:00:00.000Z"
      },
      dedupeKey: "task-0130-new-session",
      confidence: 1
    });
    await expect(service.classifyExternalActivity({
      ...command,
      expectedExternalActivityId: staleAfterSessionActivity.id,
      expectedLocalDate: "2026-09-22",
      expectedCurrentClassificationId: null
    })).resolves.toMatchObject({ outcome: "not_pending" });

    await expect(repository.importExternalActivity({
      ...activity,
      normalizedChecksum: "b".repeat(64),
      name: "Strength corrected"
    })).resolves.toBe("corrected");
    const correctedActivity = (await repository.listExternalActivities(personD, 10))
      .find((candidate) => candidate.providerIdentity === "strength-1")!;
    expect(correctedActivity.id).not.toBe(firstActivity.id);
    expect(correctedActivity.classification).toMatchObject({
      classification: { kind: "program_workout", workoutPosition: 2 }
    });

    const linkedSession = await service.createWorkoutSession({
      occurredAt: correctedActivity.occurredAt,
      timezone: correctedActivity.timezone,
      programVersionId: versionId,
      programWorkoutPosition: 1,
      externalActivityId: correctedActivity.id,
      workoutName: "A detail",
      feeling: null,
      note: null,
      exercises: [{
        exerciseVersionId,
        loadBasis: "external_weight",
        feeling: null,
        note: null,
        sets: [{ weightKg: 20, reps: 8, rir: 2 }]
      }],
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: correctedActivity.occurredAt
      },
      dedupeKey: "task-0130-linked-session",
      confidence: 1
    });
    expect(linkedSession.created).toBe(true);
    const covered = (await repository.listExternalActivities(personD, 10))
      .find((candidate) => candidate.providerIdentity === "strength-1")!;
    expect(covered.sessionCovered).toBe(true);
    await expect(service.classifyExternalActivity({
      ...command,
      expectedExternalActivityId: correctedActivity.id,
      expectedCurrentClassificationId: corrected.classification!.id,
      classification: { kind: "not_program_workout" }
    })).resolves.toMatchObject({ outcome: "not_pending" });
    await expect(service.getTrainingContext({
      historyLimit: 5,
      localDate: correctedActivity.localDate
    })).resolves.toMatchObject({
      nextStep: {
        state: "complete_today",
        evidenceIds: [linkedSession.session.id]
      }
    });

    const personDConfig: AppConfig = {
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3_000,
      DATABASE_URL: databaseUrl,
      LOG_LEVEL: "silent",
      PERSON_CONTEXT_MODE: "synthetic",
      SYNTHETIC_PERSON_ID: personD,
      SHUTDOWN_TIMEOUT_MS: 1_000
    };
    await dailyRepository.setTimezone(personD, "Europe/Belgrade");
    const personDApp = await buildApp({ config: personDConfig, database });
    try {
      const personDFastify = getFastifyInstance(personDApp);
      const localDate = derivePersonLocalDate("Europe/Belgrade");
      const beforeAssessment = await personDFastify.inject({
        method: "GET",
        url: "/v1/daily-assessment"
      });
      expect(beforeAssessment.statusCode, beforeAssessment.body).toBe(200);
      expect(beforeAssessment.json().usedFacts.trainingNextStep).toMatchObject({
        state: "needs_classification"
      });
      const storedBeforeAssessment = await database.pool.query<{
        personal_baseline_calculation: DailyAssessmentPersonalCalculation;
      }>(
        `select personal_baseline_calculation
           from coaching_daily_assessment_details
          where recommendation_id = $1`,
        [beforeAssessment.json().snapshotId]
      );
      const revisionBeforeFinalClassification = await dailyRepository.getEvidenceRevision(
        personD,
        "2026-06-01",
        localDate
      );
      const futureActivity = (await repository.listExternalActivities(personD, 10))
        .find((candidate) => candidate.providerIdentity === "strength-future")!;
      const finalClassificationCommand = {
        ...command,
        expectedExternalActivityId: futureActivity.id,
        expectedLocalDate: localDate,
        expectedCurrentClassificationId: null,
        classification: { kind: "program_workout", workoutPosition: 1 }
      } as const;
      const appTraining = personDApp.get(TrainingService);
      const originalGetTrainingContext = appTraining.getTrainingContext.bind(appTraining);
      let classificationTriggered = false;
      const contextSpy = vi.spyOn(appTraining, "getTrainingContext")
        .mockImplementation(async (query) => {
          const context = await originalGetTrainingContext(query);
          if (!classificationTriggered) {
            classificationTriggered = true;
            await expect(service.classifyExternalActivity(finalClassificationCommand))
              .resolves.toMatchObject({ outcome: "created" });
          }
          return context;
        });
      const afterAssessment = await personDApp.get(DailyAssessmentService).read();
      const contextReadCount = contextSpy.mock.calls.length;
      contextSpy.mockRestore();
      expect(classificationTriggered).toBe(true);
      expect(contextReadCount).toBeGreaterThanOrEqual(2);
      const contextAfterWrite = await service.getTrainingContext({
        historyLimit: 1,
        localDate
      });
      expect(contextAfterWrite.nextStep).toMatchObject({
        state: "strength",
        workoutPosition: 2,
        workoutName: "B"
      });
      expect(afterAssessment).toMatchObject({
        state: "available",
        usedFacts: {
          trainingNextStep: {
            state: "strength",
            workoutPosition: 2,
            workoutName: "B"
          }
        }
      });
      if (afterAssessment.state !== "available") {
        throw new Error("Expected an available assessment after classification");
      }
      expect(afterAssessment.snapshotId).not.toBe(beforeAssessment.json().snapshotId);
      expect(afterAssessment.evidenceChecksum).not.toBe(
        beforeAssessment.json().evidenceChecksum
      );

      const staleSnapshot = beforeAssessment.json();
      await expect(dailyRepository.createOrGet(personD, {
        localDate: staleSnapshot.localDate,
        timezone: staleSnapshot.timezone,
        status: staleSnapshot.status,
        usedFacts: staleSnapshot.usedFacts,
        missingImportantData: staleSnapshot.missingImportantData,
        reasons: staleSnapshot.reasons,
        recommendedAction: staleSnapshot.recommendedAction,
        alternatives: staleSnapshot.alternatives,
        limitations: staleSnapshot.limitations,
        confidence: staleSnapshot.confidence,
        policyVersion: staleSnapshot.policyVersion,
        evidenceChecksum: staleSnapshot.evidenceChecksum,
        personalBaseline: staleSnapshot.personalBaseline,
        personalBaselineCalculation:
          storedBeforeAssessment.rows[0]!.personal_baseline_calculation,
        movement: staleSnapshot.movement
      }, {
        expectedRevision: revisionBeforeFinalClassification,
        expectedTimezone: "Europe/Belgrade",
        expectedPreferencesUpdatedAt: (await dailyRepository.getPreferences(personD)).updatedAt,
        from: "2026-06-01",
        to: localDate
      })).rejects.toBeInstanceOf(DailyAssessmentEvidenceChangedError);
    } finally {
      await personDApp.close();
    }

    await database.pool.query(
      "delete from integration_connections where id = $1",
      [connectionId]
    );
    const erased = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from external_activity_program_classifications where person_id = $1",
      [personD]
    );
    expect(erased.rows[0]?.count).toBe("0");
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
      cadence: {
        kind: "rolling_weekly",
        strengthSessionsPerWeek: 3,
        workoutSequence: [1],
        lightCardio: null
      },
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
      programWorkoutPosition: 1,
      externalActivityId: null,
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
    expect(session.json()).toMatchObject({
      programVersionId: versionId,
      programWorkoutPosition: 1,
      externalActivityId: null
    });
    expect(session.json().exercises[0].sets).toHaveLength(3);
    const invalidPosition = await fastify.inject({
      method: "POST",
      url: "/v1/training/sessions",
      payload: { ...sessionPayload, programWorkoutPosition: 2, dedupeKey: "training:session:invalid-position" }
    });
    expect(invalidPosition.statusCode).toBe(404);
    expect(
      await repository.findWorkoutSession(personB, session.json().id)
    ).toBeNull();
    expect(await repository.getDataCoverage(
      personA,
      "2026-07-01",
      "2026-07-31",
      "2026-08-01"
    )).toMatchObject({
      firstDataDate: "2026-07-31",
      lastDataDate: "2026-07-31"
    });
    await database.pool.query(
      `update source_references source
          set evidence_purpose = 'operational_verification'
         from workout_sessions session
        where session.id = $1
          and session.source_reference_id = source.id
          and session.person_id = source.person_id`,
      [session.json().id]
    );
    expect(await repository.getDataCoverage(
      personA,
      "2026-07-01",
      "2026-07-31",
      "2026-08-01"
    )).toEqual({ firstDataDate: null, lastDataDate: null, days: [] });

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
    expect(accepted.json().currentVersion.cadence).toEqual(programPayload.cadence);
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

  it("atomically saves confirmed programs with deduplication, concurrency, and Person isolation", async () => {
    const repository = new TrainingRepository(database);
    const personBService = new TrainingService(
      repository,
      new SyntheticPersonContext(personB)
    );
    await expect(personBService.getTrainingContext({ historyLimit: 1 }))
      .resolves.toEqual({
        status: "absent",
        program: null,
        recentSessions: { items: [] },
        recentExternalActivities: [],
        trustedExternalTitles: [],
        activityRecordingMode: { title: null, lockVersion: 0, updatedAt: null },
        nextStep: { state: "no_active_program", policyVersion: "training-next-step-v2" }
      });
    const exercise = await repository.createExercise(personA, {
      visibility: "shared",
      name: "TASK-0108 Press",
      category: "strength",
      movementPattern: "push",
      equipment: "dumbbell",
      instructions: null,
      note: null
    });
    const snapshot = {
      expectedActiveProgramId: null,
      expectedLockVersion: null,
      name: "Confirmed A/B",
      note: "Confirmed by the user",
      cadence: {
        kind: "rolling_weekly" as const,
        strengthSessionsPerWeek: 3,
        workoutSequence: [1],
        lightCardio: {
          sessionsPerWeek: 2,
          durationSeconds: 2400,
          targetAverageHeartRateMin: 135,
          targetAverageHeartRateMax: 145,
          warmupSeconds: 300,
          workSeconds: 1800,
          cooldownSeconds: 300
        }
      },
      workouts: [
        {
          name: "A",
          prescriptions: [
            {
              exerciseVersionId: exercise.currentVersion.id,
              loadBasis: "external_weight" as const,
              targetWeightKg: 20,
              targetSets: 3,
              targetRepsMin: 8,
              targetRepsMax: 10,
              targetRir: 2,
              progressionIncrementKg: 2,
              note: null
            }
          ]
        }
      ]
    };

    const created = await repository.saveConfirmedProgram(personB, snapshot);
    if (created.outcome === "needs_clarification") {
      throw new Error("Expected the confirmed program to be saved");
    }
    expect(created).toMatchObject({
      outcome: "created",
      program: {
        personId: personB,
        lockVersion: 1,
        activeVersionId: expect.any(String),
        activeVersion: { version: 1, name: "Confirmed A/B", cadence: snapshot.cadence },
        currentVersion: { version: 1, name: "Confirmed A/B" }
      }
    });
    await expect(personBService.getTrainingContext({ historyLimit: 1 }))
      .resolves.toMatchObject({
        status: "active",
        program: { id: created.program.id, personId: personB },
        recentSessions: { items: [] },
        recentExternalActivities: [],
        nextStep: { state: "local_date_required" }
      });
    expect(await repository.findProgram(personA, created.program.id)).toBeNull();

    const duplicate = await repository.saveConfirmedProgram(personB, snapshot);
    expect(duplicate).toMatchObject({
      outcome: "unchanged",
      program: {
        id: created.program.id,
        lockVersion: 1,
        activeVersionId: created.program.activeVersionId
      }
    });
    const afterDuplicate = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from training_program_versions
        where program_id = $1`,
      [created.program.id]
    );
    expect(afterDuplicate.rows[0]?.count).toBe("1");

    const updated = await repository.saveConfirmedProgram(personB, {
      ...snapshot,
      expectedActiveProgramId: created.program.id,
      expectedLockVersion: created.program.lockVersion,
      workouts: snapshot.workouts.map((workout) => ({
        ...workout,
        prescriptions: workout.prescriptions.map((prescription) => ({
          ...prescription,
          targetWeightKg: 22
        }))
      }))
    });
    if (updated.outcome === "needs_clarification") {
      throw new Error("Expected the confirmed program to be updated");
    }
    expect(updated).toMatchObject({
      outcome: "updated",
      program: {
        id: created.program.id,
        lockVersion: 2,
        activeVersion: { version: 2 },
        currentVersion: { version: 2 }
      }
    });
    expect(updated.program.activeVersionId).toBe(
      updated.program.currentVersion.id
    );

    await expect(
      repository.saveConfirmedProgram(personB, {
        ...snapshot,
        expectedActiveProgramId: created.program.id,
        expectedLockVersion: 1,
        note: "Stale overwrite"
      })
    ).rejects.toThrow("changed concurrently");
    const afterConflict = await repository.findActiveProgram(personB);
    expect(afterConflict).toMatchObject({
      id: created.program.id,
      lockVersion: 2,
      activeVersion: { version: 2, note: "Confirmed by the user" }
    });
    const afterConflictVersions = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from training_program_versions
        where program_id = $1`,
      [created.program.id]
    );
    expect(afterConflictVersions.rows[0]?.count).toBe("2");

    await expect(
      repository.saveConfirmedProgram(personA, {
        ...snapshot,
        expectedActiveProgramId: created.program.id,
        expectedLockVersion: 2,
        note: "Cross-person overwrite"
      })
    ).rejects.toThrow("changed concurrently");
    expect((await repository.findActiveProgram(personB))?.lockVersion).toBe(2);
  });

  it("materializes accepted cadence as an exact immutable active successor", async () => {
    const repository = new TrainingRepository(database);
    const service = new TrainingService(
      repository,
      new SyntheticPersonContext(personC)
    );
    const exercise = await repository.createExercise(personA, {
      visibility: "shared",
      name: "TASK-0128 Cadence Press",
      category: "strength",
      movementPattern: "push",
      equipment: "machine",
      instructions: null,
      note: null
    });
    const legacy = await repository.saveConfirmedProgram(personC, {
      expectedActiveProgramId: null,
      expectedLockVersion: null,
      name: "TASK-0128 Ahilej A/B",
      note: "Legacy schedule remains prose only",
      workouts: [{
        name: "A",
        prescriptions: [{
          exerciseVersionId: exercise.currentVersion.id,
          loadBasis: "external_weight",
          targetWeightKg: 22.5,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          targetRir: 2,
          progressionIncrementKg: null,
          note: null
        }]
      }]
    });
    if (legacy.outcome === "needs_clarification") {
      throw new Error("Expected the legacy program to be saved");
    }
    const legacyVersion = legacy.program.activeVersion;
    if (!legacyVersion) throw new Error("Expected an active legacy version");
    expect(legacyVersion.cadence).toBeNull();
    await expect(service.getTrainingContext({
      historyLimit: 1,
      localDate: "2026-09-23"
    })).resolves.toMatchObject({ nextStep: { state: "schedule_unavailable" } });

    const cadence = {
      kind: "rolling_weekly" as const,
      strengthSessionsPerWeek: 3,
      workoutSequence: [1],
      lightCardio: {
        sessionsPerWeek: 2,
        durationSeconds: 2400,
        targetAverageHeartRateMin: 135,
        targetAverageHeartRateMax: 145,
        warmupSeconds: 300,
        workSeconds: 1800,
        cooldownSeconds: 300
      }
    };
    const updated = await service.materializeProgramCadence({
      expectedActiveProgramId: legacy.program.id,
      expectedActiveVersionId: legacyVersion.id,
      expectedLockVersion: legacy.program.lockVersion,
      cadence
    });
    expect(updated).toMatchObject({
      outcome: "updated",
      program: {
        id: legacy.program.id,
        lockVersion: legacy.program.lockVersion + 1,
        activeVersion: {
          version: legacyVersion.version + 1,
          name: legacyVersion.name,
          note: legacyVersion.note,
          cadence,
          workouts: legacyVersion.workouts
        }
      }
    });
    expect(updated.program.activeVersionId).toBe(updated.program.currentVersion.id);
    await expect(service.getTrainingContext({
      historyLimit: 1,
      localDate: "2026-09-23"
    })).resolves.toMatchObject({
      program: { activeVersion: { cadence } },
      nextStep: { state: "strength", workoutPosition: 1, workoutName: "A" }
    });

    const oldVersionCadence = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from training_program_cadences
        where program_version_id = $1`,
      [legacyVersion.id]
    );
    expect(oldVersionCadence.rows[0]?.count).toBe("0");

    const duplicate = await service.materializeProgramCadence({
      expectedActiveProgramId: updated.program.id,
      expectedActiveVersionId: updated.program.activeVersionId!,
      expectedLockVersion: updated.program.lockVersion,
      cadence: {
        lightCardio: cadence.lightCardio === null ? null : {
          cooldownSeconds: cadence.lightCardio.cooldownSeconds,
          workSeconds: cadence.lightCardio.workSeconds,
          warmupSeconds: cadence.lightCardio.warmupSeconds,
          targetAverageHeartRateMax:
            cadence.lightCardio.targetAverageHeartRateMax,
          targetAverageHeartRateMin:
            cadence.lightCardio.targetAverageHeartRateMin,
          durationSeconds: cadence.lightCardio.durationSeconds,
          sessionsPerWeek: cadence.lightCardio.sessionsPerWeek
        },
        workoutSequence: [...cadence.workoutSequence],
        strengthSessionsPerWeek: cadence.strengthSessionsPerWeek,
        kind: "rolling_weekly"
      }
    });
    expect(duplicate).toMatchObject({
      outcome: "unchanged",
      program: {
        activeVersionId: updated.program.activeVersionId,
        lockVersion: updated.program.lockVersion
      }
    });

    const beforeFailures = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from training_program_versions
        where program_id = $1`,
      [updated.program.id]
    );
    await expect(service.materializeProgramCadence({
      expectedActiveProgramId: updated.program.id,
      expectedActiveVersionId: legacyVersion.id,
      expectedLockVersion: updated.program.lockVersion,
      cadence: { ...cadence, workoutSequence: [1, 1] }
    })).rejects.toThrow("changed concurrently");
    await expect(service.materializeProgramCadence({
      expectedActiveProgramId: updated.program.id,
      expectedActiveVersionId: updated.program.activeVersionId!,
      expectedLockVersion: updated.program.lockVersion,
      cadence: { ...cadence, workoutSequence: [2] }
    })).rejects.toThrow("must reference an existing workout position");
    const afterFailures = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from training_program_versions
        where program_id = $1`,
      [updated.program.id]
    );
    expect(afterFailures.rows[0]?.count).toBe(beforeFailures.rows[0]?.count);
  });

  it("resolves exact exercises or creates private versions inside the confirmed-program transaction", async () => {
    const repository = new TrainingRepository(database);
    const shared = await repository.createExercise(personA, {
      visibility: "shared",
      name: "TASK-0126 Exact Press",
      category: "strength",
      movementPattern: "push",
      equipment: "dumbbell",
      instructions: null,
      note: null
    });
    const aliased = await repository.createExercise(personA, {
      visibility: "shared",
      name: "TASK-0126 Canonical Row",
      category: "strength",
      movementPattern: "pull",
      equipment: "cable",
      instructions: null,
      note: null
    });
    await repository.upsertExerciseOverlay(personB, aliased.id, {
      alias: "TASK-0126 My Row",
      available: true,
      note: null
    });
    const unavailable = await repository.createExercise(personA, {
      visibility: "shared",
      name: "TASK-0126 Hidden Cardio",
      category: "cardio",
      movementPattern: null,
      equipment: "bike",
      instructions: null,
      note: null
    });
    await repository.upsertExerciseOverlay(personB, unavailable.id, {
      alias: null,
      available: false,
      note: null
    });
    const similar = await repository.createExercise(personA, {
      visibility: "shared",
      name: "TASK-0126 Cable Row Machine",
      category: "strength",
      movementPattern: "pull",
      equipment: "cable",
      instructions: null,
      note: null
    });
    const inaccessiblePrivate = await repository.createExercise(personA, {
      visibility: "private",
      name: "TASK-0126 Person Only",
      category: "strength",
      movementPattern: null,
      equipment: null,
      instructions: null,
      note: null
    });
    const active = await repository.findActiveProgram(personB);
    if (!active) {
      throw new Error("Expected the preceding confirmed program fixture");
    }
    const prescription = (
      name: string,
      category: string | null,
      movementPattern: string | null,
      equipment: string | null
    ) => ({
      exercise: {
        name,
        category,
        movementPattern,
        equipment,
        instructions: null,
        note: null
      },
      loadBasis: "external_weight" as const,
      targetWeightKg: null,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetRir: 2,
      progressionIncrementKg: null,
      note: null
    });
    const resolved = await repository.saveConfirmedProgram(personB, {
      expectedActiveProgramId: active.id,
      expectedLockVersion: active.lockVersion,
      name: "TASK-0126 Resolution",
      note: null,
      workouts: [{
        name: "A",
        prescriptions: [
          prescription("  task-0126   EXACT press  ", "strength", "push", "dumbbell"),
          prescription("TASK-0126 My Row", "strength", "pull", "cable"),
          prescription("TASK-0126 Hidden Cardio", "cardio", null, "bike"),
          prescription("TASK-0126 Cable Row", "strength", "pull", "cable"),
          prescription("TASK-0126 Cable Row", "strength", "pull", "cable"),
          prescription("TASK-0126 Person Only", "strength", null, null)
        ]
      }]
    });
    if (resolved.outcome === "needs_clarification") {
      throw new Error("Expected exact resolution and private creation");
    }
    const prescriptions = resolved.program.activeVersion?.workouts[0]?.prescriptions;
    expect(prescriptions?.[0]?.exerciseVersionId).toBe(shared.currentVersion.id);
    expect(prescriptions?.[1]?.exerciseVersionId).toBe(aliased.currentVersion.id);
    expect(prescriptions?.[2]?.exerciseId).not.toBe(unavailable.id);
    expect(prescriptions?.[3]?.exerciseId).toBe(prescriptions?.[4]?.exerciseId);
    expect(prescriptions?.[3]?.exerciseId).not.toBe(similar.id);
    expect(prescriptions?.[5]?.exerciseId).not.toBe(inaccessiblePrivate.id);
    const privateRows = await database.pool.query<{
      name: string;
      visibility: string;
      owner_person_id: string | null;
    }>(
      `select ev.name, e.visibility, e.owner_person_id
         from training_exercises e
         join training_exercise_versions ev on ev.id = e.current_version_id
        where ev.name in (
          'TASK-0126 Hidden Cardio',
          'TASK-0126 Cable Row',
          'TASK-0126 Person Only'
        )
          and e.owner_person_id = $1
        order by ev.name`,
      [personB]
    );
    expect(privateRows.rows).toEqual([
      {
        name: "TASK-0126 Cable Row",
        visibility: "private",
        owner_person_id: personB
      },
      {
        name: "TASK-0126 Hidden Cardio",
        visibility: "private",
        owner_person_id: personB
      },
      {
        name: "TASK-0126 Person Only",
        visibility: "private",
        owner_person_id: personB
      }
    ]);

    await repository.createExercise(personA, {
      visibility: "shared",
      name: "TASK-0126 Ambiguous",
      category: "strength",
      movementPattern: null,
      equipment: "cable",
      instructions: null,
      note: null
    });
    await repository.createExercise(personA, {
      visibility: "shared",
      name: "TASK-0126 Ambiguous",
      category: "strength",
      movementPattern: null,
      equipment: "machine",
      instructions: null,
      note: null
    });
    const exerciseCountBeforeAmbiguity = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from training_exercises"
    );
    const ambiguous = await repository.saveConfirmedProgram(personB, {
      expectedActiveProgramId: resolved.program.id,
      expectedLockVersion: resolved.program.lockVersion,
      name: "TASK-0126 Ambiguous Program",
      note: null,
      workouts: [{
        name: "A",
        prescriptions: [
          prescription("TASK-0126 Ambiguous", "strength", null, null)
        ]
      }]
    });
    expect(ambiguous).toMatchObject({
      outcome: "needs_clarification",
      program: null,
      ambiguities: [{
        requestedName: "TASK-0126 Ambiguous",
        candidates: [{ name: "TASK-0126 Ambiguous" }, { name: "TASK-0126 Ambiguous" }]
      }]
    });
    const exerciseCountAfterAmbiguity = await database.pool.query<{ count: string }>(
      "select count(*)::text as count from training_exercises"
    );
    expect(exerciseCountAfterAmbiguity.rows[0]?.count).toBe(
      exerciseCountBeforeAmbiguity.rows[0]?.count
    );
    expect((await repository.findActiveProgram(personB))?.id).toBe(resolved.program.id);

    const orphanCountBefore = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from training_exercise_versions
        where name = 'TASK-0126 Must Roll Back'`
    );
    await expect(repository.saveConfirmedProgram(personB, {
      expectedActiveProgramId: resolved.program.id,
      expectedLockVersion: resolved.program.lockVersion - 1,
      name: "TASK-0126 Stale",
      note: null,
      workouts: [{
        name: "A",
        prescriptions: [
          prescription("TASK-0126 Must Roll Back", null, null, null)
        ]
      }]
    })).rejects.toThrow("changed concurrently");
    const orphanCountAfter = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from training_exercise_versions
        where name = 'TASK-0126 Must Roll Back'`
    );
    expect(orphanCountAfter.rows[0]?.count).toBe(orphanCountBefore.rows[0]?.count);

    const concurrentSnapshot = {
      expectedActiveProgramId: resolved.program.id,
      expectedLockVersion: resolved.program.lockVersion,
      name: "TASK-0126 Concurrent",
      note: null,
      workouts: [{
        name: "A",
        prescriptions: [prescription("TASK-0126 Concurrent New", null, null, null)]
      }]
    };
    const concurrent = await Promise.all([
      repository.saveConfirmedProgram(personB, concurrentSnapshot),
      repository.saveConfirmedProgram(personB, concurrentSnapshot)
    ]);
    expect(concurrent.map((result) => result.outcome).sort()).toEqual([
      "unchanged",
      "updated"
    ]);
    const concurrentExercises = await database.pool.query<{ count: string }>(
      `select count(*)::text as count
         from training_exercise_versions
        where name = 'TASK-0126 Concurrent New'`
    );
    expect(concurrentExercises.rows[0]?.count).toBe("1");
  });
});
