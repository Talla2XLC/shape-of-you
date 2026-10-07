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
const start = { startReportedNow: true, timezone: "Europe/Belgrade", completionState: "in_progress",
  workoutName: "Synthetic B", dedupeKey: "synthetic-start", exercises: [] };

async function provider(f: Awaited<ReturnType<typeof fixture>>, time: string) {
  const providerId = randomUUID(), recoveryId = randomUUID(), consentId = randomUUID(), connectionId = randomUUID();
  await database.pool.query("insert into recovery_providers (id,key,name) values ($1,$2,'Synthetic provider')", [providerId, providerId]);
  await database.pool.query("insert into recovery_connections (id,person_id,provider_id,dedupe_key) values ($1,$2,$3,$4)", [recoveryId, f.personId, providerId, recoveryId]);
  await database.pool.query("insert into recovery_consents (id,person_id,connection_id,purpose,retention_mode) values ($1,$2,$3,'training','indefinite')", [consentId, f.personId, recoveryId]);
  await database.pool.query("insert into integration_connections (id,person_id,recovery_connection_id,consent_id,provider_key,external_user_id) values ($1,$2,$3,$4,$5,'synthetic-user')", [connectionId, f.personId, recoveryId, consentId, providerId]);
  await f.repository.importExternalActivity({ connectionId, personId: f.personId, consentId,
    providerIdentity: "synthetic-garmin", normalizedChecksum: "a".repeat(64), occurredAt: time,
    localDate: "2026-10-07", timezone: "Europe/Belgrade", name: "Силовая тренировка",
    durationSeconds: 2765, distanceMeters: null, trainingLoad: 15, trainingLoadBasis: "relative_training_stress",
    trainingLoadBasisVersion: "1", averageHeartRate: 104, maximumHeartRate: 127,
    deviceName: "Garmin Forerunner 970", sourceProvider: "intervals_icu", garminAttributed: true });
}

describe("MCP workout start receipt, PostgreSQL and existing matching policy", () => {
  it.each(["provider-first", "completion-first", "distant-provider"])("preserves receipt through retry and completion: %s", async (order) => {
    const f = await fixture();
    try {
      await f.training.setActivityRecordingMode({ expectedLockVersion: 0, title: "Силовая тренировка" });
      if (order === "provider-first") await provider(f, "2026-10-07T16:32:37.000Z");
      const catalog = await f.list();
      const published = catalog.tools.find((tool: { name: string }) => tool.name === "record_workout_session_v2").inputSchema;
      expect(published.anyOf).toBeUndefined();
      expect(published.properties).toHaveProperty("workoutName");
      expect(published.properties).toHaveProperty("startReportedNow");
      const first = await f.call("record_workout_session_v2", start);
      expect(first.isError, JSON.stringify(first.content)).not.toBe(true);
      const saved = first.structuredContent;
      expect(saved).toMatchObject({ occurredAt: "2026-10-07T16:30:00.000Z", temporalPrecision: "instant",
        localDate: "2026-10-07", completionState: "in_progress", externalActivityId: null,
        sourceReference: { channel: "manual", externalSystem: "mcp_start_report:v1", externalRecordId: start.dedupeKey,
          occurredAt: "2026-10-07T16:30:00.000Z" } });
      f.setReceipt("2026-10-07T17:10:00.000Z");
      const retry = await f.call("record_workout_session_v2", start);
      expect(retry.isError, JSON.stringify(retry.content)).not.toBe(true);
      expect(retry.structuredContent.id).toBe(saved.id);
      expect(retry.structuredContent.occurredAt).toBe(saved.occurredAt);
      const exercise = await f.training.createExercise({ visibility: "private", name: "Synthetic squat", category: "strength",
        movementPattern: null, equipment: null, instructions: null, note: null });
      const source = saved.sourceReference;
      const completed = await f.call("correct_workout_session_v2", { id: saved.id,
        occurredAt: saved.occurredAt, temporalPrecision: saved.temporalPrecision, localDate: saved.localDate,
        timezone: saved.timezone, completionState: "completed", workoutName: saved.workoutName,
        dedupeKey: "synthetic-finish", correctionReason: "Finished workout",
        sourceReference: { channel: source.channel, externalSystem: source.externalSystem,
          externalRecordId: source.externalRecordId, occurredAt: source.occurredAt },
        exercises: [{ exerciseVersionId: exercise.currentVersion.id, exerciseLabel: "Synthetic squat",
          loadBasis: "external_weight", sets: [{ weightKg: 40, reps: 8, rir: 2 }] }] });
      expect(completed.isError, JSON.stringify(completed.content)).not.toBe(true);
      if (order !== "provider-first") await provider(f, order === "distant-provider" ? "2026-10-07T17:32:37.000Z" : "2026-10-07T16:32:37.000Z");
      const read = await f.call("list_workout_sessions_v2", { localDate: saved.localDate });
      expect(read.structuredContent.items).toHaveLength(1);
      const current = read.structuredContent.items[0];
      expect(current).toMatchObject({ occurredAt: saved.occurredAt, temporalPrecision: "instant", completionState: "completed",
        sourceReference: { externalSystem: source.externalSystem, externalRecordId: source.externalRecordId } });
      if (order === "distant-provider") expect(current.externalActivityId).toBeNull();
      else expect(current.externalActivityId).not.toBeNull();
      const history = await database.pool.query("select occurred_at,temporal_precision,completion_state from workout_sessions where person_id=$1 order by created_at", [f.personId]);
      expect(history.rows).toHaveLength(2);
      expect(history.rows.map((row) => new Date(row.occurred_at).toISOString())).toEqual([saved.occurredAt, saved.occurredAt]);
      expect(history.rows.map((row) => row.completion_state)).toEqual(["in_progress", "completed"]);
      const links = await database.pool.query("select match_basis,match_policy_version from training_workout_session_activity_links where person_id=$1", [f.personId]);
      expect(links.rows).toEqual(order === "distant-provider" ? [] : [expect.objectContaining({ match_basis: "confirmed_recording_context", match_policy_version: "automatic-activity-link-v3" })]);
    } finally { await f.server.close(); }
  });

  it("uses timezone across UTC midnight and does not invent a start for a finish report", async () => {
    const f = await fixture();
    try {
      f.setReceipt("2026-10-07T22:30:00.000Z");
      const begun = await f.call("record_workout_session_v2", start);
      expect(begun.structuredContent.localDate).toBe("2026-10-08");
      const finish = await f.call("record_workout_session_v2", { timezone: start.timezone, localDate: "2026-10-07",
        temporalPrecision: "local_date", completionState: "completed", workoutName: "Unknown start",
        dedupeKey: "finish-only", note: "Finished now", exercises: [] });
      expect(finish.isError, JSON.stringify(finish.content)).not.toBe(true);
      expect(finish.structuredContent).toMatchObject({ occurredAt: null, temporalPrecision: "local_date" });
    } finally { await f.server.close(); }
  });

  it("retains exact reported time and rejects contradictions and empty measurement sets before persistence", async () => {
    const f = await fixture();
    try {
      for (const overlay of [{ occurredAt: "2026-10-07T16:00:00Z" }, { completionState: "completed" },
        { temporalPrecision: "local_date" }, { localDate: "2026-10-06" }, { timezone: "Invalid/Timezone" },
        { sourceReference: { channel: "import", externalSystem: "intervals_icu", externalRecordId: "a" } }]) {
        expect((await f.call("record_workout_session_v2", { ...start, ...overlay })).isError).toBe(true);
      }
      const invalid = { ...start, startReportedNow: false, occurredAt: "2026-10-07T16:00:00Z", temporalPrecision: "instant",
        exercises: [{ exerciseLabel: "Unknown exercise", sets: [{}] }] };
      expect((await f.call("record_workout_session_v2", invalid)).isError).toBe(true);
      expect((await f.call("record_workout_session_v2", { ...invalid, exercises: [{ exerciseLabel: "Unknown exercise", sets: [{ weightKg: 40.0001 }] }] })).isError).toBe(true);
      const rows = await database.pool.query("select count(*)::int as count from workout_sessions where person_id=$1", [f.personId]);
      expect(rows.rows[0].count).toBe(0);
      const exact = await f.call("record_workout_session_v2", { ...invalid, exercises: [], dedupeKey: "exact-start" });
      expect(exact.isError, JSON.stringify(exact.content)).not.toBe(true);
      expect(exact.structuredContent).toMatchObject({ occurredAt: "2026-10-07T16:00:00.000Z",
        sourceReference: { externalSystem: null, externalRecordId: null } });
    } finally { await f.server.close(); }
  });
});
