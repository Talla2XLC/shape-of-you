import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { TrainingService } from "../src/training/training.service.js";
import { TrainingRepository } from "../src/storage/training-repository.js";
import { mcpWorkoutServer } from "./fixtures/mcp-workout-server.js";

let container: StartedPostgreSqlContainer;
let database: DatabaseContext;
beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = randomUUID();
  const databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  database = createDatabase({ NODE_ENV: "test", HOST: "127.0.0.1", PORT: 3000, DATABASE_URL: databaseUrl,
    LOG_LEVEL: "silent", PERSON_CONTEXT_MODE: "synthetic", SYNTHETIC_PERSON_ID: process.env.SYNTHETIC_PERSON_ID,
    SHUTDOWN_TIMEOUT_MS: 1000 });
});
afterAll(async () => { await database?.pool.end(); await container?.stop(); });
async function fixture() {
  const personId = randomUUID();
  await database.pool.query("insert into persons (id,kind,status,timezone) values ($1,'real','active','Europe/Belgrade')", [personId]);
  const repository = new TrainingRepository(database);
  const training = new TrainingService(repository, new SyntheticPersonContext(personId));
  let receipt = "2026-10-07T16:30:00.000Z";
  const mcp = mcpWorkoutServer(training, personId, () => new Date(receipt));
  return { ...mcp, personId, repository, training, setReceipt: (value: string) => { receipt = value; } };
}


async function provider(f: Awaited<ReturnType<typeof fixture>>, time: string, identity = "synthetic-garmin") {
  const providerId = randomUUID(), recoveryId = randomUUID(), consentId = randomUUID(), connectionId = randomUUID();
  await database.pool.query("insert into recovery_providers (id,key,name) values ($1,$2,'Synthetic provider')", [providerId, providerId]);
  await database.pool.query("insert into recovery_connections (id,person_id,provider_id,dedupe_key) values ($1,$2,$3,$4)", [recoveryId, f.personId, providerId, recoveryId]);
  await database.pool.query("insert into recovery_consents (id,person_id,connection_id,purpose,retention_mode) values ($1,$2,$3,'training','indefinite')", [consentId, f.personId, recoveryId]);
  await database.pool.query("insert into integration_connections (id,person_id,recovery_connection_id,consent_id,provider_key,external_user_id) values ($1,$2,$3,$4,$5,'synthetic-user')", [connectionId, f.personId, recoveryId, consentId, providerId]);
  const input: Parameters<typeof f.repository.importExternalActivity>[0] = { connectionId, personId: f.personId, consentId,
    providerIdentity: identity, normalizedChecksum: "a".repeat(64), occurredAt: time,
    localDate: "2026-10-07", timezone: "Europe/Belgrade", name: "Силовая тренировка",
    durationSeconds: 2765, distanceMeters: null, trainingLoad: 15, trainingLoadBasis: "relative_training_stress",
    trainingLoadBasisVersion: "1", averageHeartRate: 104, maximumHeartRate: 127,
    deviceName: "Garmin Forerunner 970", sourceProvider: "intervals_icu", garminAttributed: true };
  await f.repository.importExternalActivity(input);
  return input;
}

async function exactB(f: Awaited<ReturnType<typeof fixture>>, category: "strength" | "cardio" = "strength") {
  const program = await f.training.saveConfirmedProgram({ expectedActiveProgramId: null, expectedLockVersion: null,
    name: "Synthetic B program", note: null,
    cadence: { kind: "rolling_weekly", strengthSessionsPerWeek: 2, workoutSequence: [1], lightCardio: null },
    workouts: [{ name: "Synthetic B", prescriptions: [{ exercise: { name: "Synthetic movement", category,
      movementPattern: null, equipment: null, instructions: null, note: null }, loadBasis: "external_weight",
      targetWeightKg: 40, targetSets: 3, targetRepsMin: 8, targetRepsMax: 10, targetRir: 2,
      progressionIncrementKg: 2, note: null }] }] });
  return { programVersionId: program.program!.activeVersionId, programWorkoutPosition: 1 };
}
const report = { timezone: "Europe/Belgrade", temporalPrecision: "local_date", localDate: "2026-10-07",
  completionState: "completed", workoutName: "Synthetic B", dedupeKey: "yesterday-B", exercises: [] };

describe("Natural retrospective workout report across MCP and PostgreSQL", () => {
  it.each(["report-first", "provider-first"])("links exact B without sets/start: %s", async (order) => {
    const f = await fixture();
    try {
      const pin = await exactB(f);
      await f.training.setActivityRecordingMode({ expectedLockVersion: 0, title: "Силовая тренировка" });
      if (order === "provider-first") await provider(f, "2026-10-07T16:32:37.000Z");
      const saved = await f.call("record_workout_session_v2", { ...report, ...pin });
      expect(saved.isError, JSON.stringify(saved.content)).not.toBe(true);
      expect(saved.structuredContent).toMatchObject({ occurredAt: null, temporalPrecision: "local_date", completionState: "completed", exercises: [] });
      if (order === "report-first") await provider(f, "2026-10-07T16:32:37.000Z");
      const retry = await f.call("record_workout_session_v2", { ...report, ...pin });
      expect(retry.structuredContent.id).toBe(saved.structuredContent.id);
      const read = await f.call("get_training_context_v2", { localDate: report.localDate, historyLimit: 1 });
      expect(read.isError, JSON.stringify(read.content)).not.toBe(true);
      expect(read.structuredContent.pendingActivityLinkQuestion).toBeUndefined();
      const current = await f.repository.findWorkoutSession(f.personId, saved.structuredContent.id);
      expect(current!.externalActivityId).not.toBeNull();
      expect(current!.occurredAt).toBeNull();
      expect(current!.sourceReference).toMatchObject({ channel: "manual", occurredAt: null, externalSystem: null });
      expect((await f.repository.personalRecords(f.personId)).items).toEqual([]);
      const links = await database.pool.query("select match_basis,match_policy_version from training_workout_session_activity_links where person_id=$1", [f.personId]);
      expect(links.rows).toEqual([{ match_basis: "reported_strength_day", match_policy_version: "automatic-activity-link-v4" }]);
      const imported = await f.repository.listExternalActivities(f.personId, 10);
      expect(imported[0]!.occurredAt).toBe("2026-10-07T16:32:37.000Z");
      expect(imported[0]!.sessionCovered).toBe(true);
      expect(read.structuredContent.nextStep.state).toBe("complete_today");
      const followingDay = await f.call("get_training_context_v2", { localDate: "2026-10-08", historyLimit: 1 });
      const projection = followingDay.structuredContent.nextStep;
      expect(projection.state).toBe("training_options");
      expect(projection.recentProgress.strengthCompleted).toBe(1);
    } finally { await f.server.close(); }
  });

  it("rejects in-progress and exact cardio program evidence; preserves actually reported partial work", async () => {
    const f = await fixture();
    try {
      const pin = await exactB(f);
      await f.training.setActivityRecordingMode({ expectedLockVersion: 0, title: "Силовая тренировка" });
      await provider(f, "2026-10-07T16:32:37.000Z");
      const partial = await f.call("record_workout_session_v2", { ...report, ...pin, completionState: "in_progress",
        exercises: [{ exerciseLabel: "Synthetic movement", sets: [{ reps: 8 }] }] });
      expect(partial.isError).not.toBe(true);
      expect(partial.structuredContent.externalActivityId).toBeNull();
      expect(partial.structuredContent.exercises[0].sets).toHaveLength(1);
      expect(partial.structuredContent.exercises[0].sets[0]).toMatchObject({ reps: 8, weightKg: null });
      const completed = await f.call("correct_workout_session_v2", { ...report, ...pin, id: partial.structuredContent.id,
        correctionReason: "Finished B", dedupeKey: "finished-B", exercises: partial.structuredContent.exercises.map((exercise: { exerciseLabel: string }) => ({ exerciseLabel: exercise.exerciseLabel, sets: [{ reps: 8 }] })) });
      expect(completed.isError, JSON.stringify(completed.content)).not.toBe(true);
      expect(completed.structuredContent.externalActivityId).not.toBeNull();
    } finally { await f.server.close(); }
    const cardio = await fixture();
    try {
      const pin = await exactB(cardio, "cardio");
      await cardio.training.setActivityRecordingMode({ expectedLockVersion: 0, title: "Силовая тренировка" });
      await provider(cardio, "2026-10-07T16:32:37.000Z");
      const saved = await cardio.call("record_workout_session_v2", { ...report, ...pin });
      expect(saved.isError, JSON.stringify(saved.content)).not.toBe(true);
      expect(saved.structuredContent.externalActivityId).toBeNull();
    } finally { await cardio.server.close(); }
  });

  it.each(["activity", "session"])("withdraws the day association for a late second %s and exposes ambiguity", async (kind) => {
    const f = await fixture();
    try {
      const pin = await exactB(f);
      await f.training.setActivityRecordingMode({ expectedLockVersion: 0, title: "Силовая тренировка" });
      await provider(f, "2026-10-07T16:32:37.000Z");
      const saved = await f.call("record_workout_session_v2", { ...report, ...pin });
      expect(saved.structuredContent.externalActivityId).not.toBeNull();
      if (kind === "activity") await provider(f, "2026-10-07T19:00:00.000Z", "second-activity");
      else await f.call("record_workout_session_v2", { ...report, ...pin, dedupeKey: "second-report" });
      expect((await f.repository.findWorkoutSession(f.personId, saved.structuredContent.id))!.externalActivityId).toBeNull();
      const context = await f.training.getTrainingContext({ localDate: report.localDate, historyLimit: 1 });
      expect(context.pendingActivityLinkQuestion!.options).toHaveLength(2);
    } finally { await f.server.close(); }
  });

  it("revokes old day links outside the recent window while preserving explicit occupied links", async () => {
    const f = await fixture();
    try {
      const pin = await exactB(f);
      await f.training.setActivityRecordingMode({ expectedLockVersion: 0, title: "Силовая тренировка" });
      await provider(f, "2026-10-07T16:32:37.000Z");
      const saved = await f.call("record_workout_session_v2", { ...report, ...pin });
      await database.pool.query("update workout_sessions set local_date='2026-08-01' where id=$1", [saved.structuredContent.id]);
      await database.pool.query("update integration_activity_facts set local_date='2026-08-01' where id=$1", [saved.structuredContent.externalActivityId]);
      await f.training.setActivityRecordingMode({ expectedLockVersion: 1, title: null });
      expect((await f.repository.findWorkoutSession(f.personId, saved.structuredContent.id))!.externalActivityId).toBeNull();
    } finally { await f.server.close(); }
    const f2 = await fixture();
    try {
      const pin = await exactB(f2);
      await f2.training.setActivityRecordingMode({ expectedLockVersion: 0, title: "Силовая тренировка" });
      await provider(f2, "2026-10-07T16:32:37.000Z");
      const activity = (await f2.repository.listExternalActivities(f2.personId, 10))[0]!;
      const explicit = await f2.call("record_workout_session_v2", { ...report, ...pin, externalActivityId: activity.id });
      expect(explicit.isError, JSON.stringify(explicit.content)).not.toBe(true);
      const other = await f2.call("record_workout_session_v2", { ...report, ...pin, dedupeKey: "competing" });
      expect(other.structuredContent.externalActivityId).toBeNull();
      await f2.training.setActivityRecordingMode({ expectedLockVersion: 1, title: null });
      expect((await f2.repository.findWorkoutSession(f2.personId, explicit.structuredContent.id))!.externalActivityId).toBe(activity.id);
    } finally { await f2.server.close(); }
  });
  it("reconciles report and provider correction lineages without duplicates", async () => {
    const f = await fixture();
    try {
      const pin = await exactB(f);
      await f.training.setActivityRecordingMode({ expectedLockVersion: 0, title: "Силовая тренировка" });
      const imported = await provider(f, "2026-10-07T16:32:37.000Z");
      const first = await f.call("record_workout_session_v2", { ...report, ...pin });
      const correction = { ...report, ...pin, id: first.structuredContent.id, dedupeKey: "B-sets",
        correctionReason: "Reported actual set", exercises: [{ exerciseLabel: "Synthetic movement", sets: [{ reps: 8, weightKg: 40 }] }] };
      const corrected = await f.call("correct_workout_session_v2", correction);
      expect(corrected.isError, JSON.stringify(corrected.content)).not.toBe(true);
      expect(corrected.structuredContent.id).not.toBe(first.structuredContent.id);
      expect(corrected.structuredContent.externalActivityId).toBe(first.structuredContent.externalActivityId);
      expect((await f.call("correct_workout_session_v2", correction)).structuredContent.id).toBe(corrected.structuredContent.id);
      expect(await f.repository.importExternalActivity({ ...imported, normalizedChecksum: "b".repeat(64), occurredAt: "2026-10-07T16:33:00.000Z" })).toBe("corrected");
      const activity = (await f.repository.listExternalActivities(f.personId, 10))[0]!;
      expect(activity.id).not.toBe(first.structuredContent.externalActivityId);
      expect((await f.repository.findWorkoutSession(f.personId, corrected.structuredContent.id))!.externalActivityId).toBe(activity.id);
      expect((await f.call("list_workout_sessions_v2", { localDate: report.localDate })).structuredContent.items).toHaveLength(1);
    } finally { await f.server.close(); }
  });

  it("the additive constraint migration preserves legal explicit, v2 and v3 associations", async () => {
    const ids: string[] = [];
    for (const basis of [null, "source_identity", "confirmed_recording_context"]) {
      const f = await fixture();
      try {
        await f.training.setActivityRecordingMode({ expectedLockVersion: 0, title: "Силовая тренировка" });
        await provider(f, "2026-10-07T16:32:37.000Z");
        const saved = await f.call("record_workout_session_v2", { ...report, temporalPrecision: "instant", occurredAt: "2026-10-07T16:30:00Z",
          exercises: [{ exerciseLabel: "Synthetic squat", sets: [{ weightKg: 40, reps: 8 }] }] });
        expect(saved.structuredContent.externalActivityId).not.toBeNull();
        ids.push(saved.structuredContent.id);
        await database.pool.query("update training_workout_session_activity_links set match_basis=$1,match_policy_version=$2 where session_id=$3",
          [basis, basis === null ? null : basis === "source_identity" ? "automatic-activity-link-v2" : "automatic-activity-link-v3", saved.structuredContent.id]);
      } finally { await f.server.close(); }
    }
    const query = "select * from training_workout_session_activity_links where session_id=any($1::uuid[]) order by session_id";
    const before = (await database.pool.query(query, [ids])).rows;
    const migration = await readFile(new URL("../drizzle/20261007202525_natural_workout_report_links.sql", import.meta.url), "utf8");
    await database.pool.query(migration.replaceAll("--> statement-breakpoint", ""));
    expect((await database.pool.query(query, [ids])).rows).toEqual(before);
    expect(before).toHaveLength(3);
    await expect(database.pool.query("update training_workout_session_activity_links set match_policy_version='automatic-activity-link-v4' where session_id=$1", [ids[1]])).rejects.toMatchObject({ code: "23514" });
  });

});
