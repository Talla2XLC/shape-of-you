import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../src/database/migrate.js";
import { FITNESS_TRACKER_SPREADSHEET_ID, type FitnessTrackerRecoverySnapshot, type FitnessTrackerTrainingSnapshot } from "../src/import/fitness-tracker-sheets-reader.js";
import { RecoveryImportApplyService } from "../src/import/recovery-import-apply.js";
import { TrainingImportApplyService } from "../src/import/training-import-apply.js";

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = "00000000-0000-4000-8000-000000000001";
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_training_recovery_import")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  await runMigrations(container.getConnectionUri());
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("unified Training and Recovery apply", () => {
  it("persists typed date-only facts, local invalid evidence and idempotent retries", async () => {
    const personId = "00000000-0000-4000-8000-000000000052";
    await pool.query("insert into persons (id, kind) values ($1, 'synthetic')", [personId]);
    const trainingService = new TrainingImportApplyService(pool, FITNESS_TRACKER_SPREADSHEET_ID, 1052535761);
    const recoveryService = new RecoveryImportApplyService(pool, FITNESS_TRACKER_SPREADSHEET_ID, 0);

    const trainingFirst = await trainingService.apply(personId, trainingSnapshot());
    const trainingRepeat = await trainingService.apply(personId, trainingSnapshot());
    const recoveryFirst = await recoveryService.apply(personId, recoverySnapshot());
    const recoveryRepeat = await recoveryService.apply(personId, recoverySnapshot());

    expect(trainingFirst).toMatchObject({ status: "completed", counts: { created: 3, unchanged: 0, conflict: 0, invalid: 1 } });
    expect(trainingRepeat).toMatchObject({ status: "completed", counts: { created: 0, unchanged: 3, conflict: 0, invalid: 1 } });
    expect(recoveryFirst).toMatchObject({ status: "completed", counts: { created: 9, unchanged: 0, conflict: 0, invalid: 1 } });
    expect(recoveryRepeat).toMatchObject({ status: "completed", counts: { created: 0, unchanged: 9, conflict: 0, invalid: 1 } });

    const state = await pool.query<{
      sessions: string; sets: string; mappings: string; training_versions: string; training_audits: string;
      observations: string; recovery_audits: string; sleep_stages: string;
      date_only_sessions: string; date_only_observations: string;
    }>(
      `select
        (select count(*) from workout_sessions where person_id = $1)::text sessions,
        (select count(*) from performed_sets ps join performed_exercises pe on pe.id = ps.performed_exercise_id join workout_sessions ws on ws.id = pe.session_id where ws.person_id = $1)::text sets,
        (select count(*) from training_import_exercise_mappings where person_id = $1)::text mappings,
        (select count(*) from training_exercise_versions tev join training_exercises te on te.id = tev.exercise_id where te.owner_person_id = $1)::text training_versions,
        (select count(*) from training_import_records where person_id = $1)::text training_audits,
        (select count(*) from recovery_observations where person_id = $1)::text observations,
        (select count(*) from recovery_import_records where person_id = $1)::text recovery_audits,
        (select count(*) from recovery_sleep_details where deep_sleep_minutes = 60 and rem_sleep_minutes = 90 and light_sleep_minutes = 330)::text sleep_stages,
        (select count(*) from workout_sessions where person_id = $1 and temporal_precision = 'local_date' and occurred_at is null)::text date_only_sessions,
        (select count(*) from recovery_observations where person_id = $1 and temporal_precision = 'local_date' and observed_from is null and observed_until is null)::text date_only_observations`,
      [personId]
    );
    expect(state.rows[0]).toEqual({
      sessions: "3",
      sets: "6",
      mappings: "2",
      training_versions: "3",
      training_audits: "8",
      observations: "9",
      recovery_audits: "20",
      sleep_stages: "1",
      date_only_sessions: "3",
      date_only_observations: "9"
    });
  });
});

function trainingSnapshot(): FitnessTrackerTrainingSnapshot {
  return {
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID, locale: "ru_RU", timeZone: "Europe/Moscow", manifestChecksum: "c".repeat(64),
    training: { sheetId: 1052535761, title: "Training", headers: ["Date", "Workout", "Exercise", "Weight_kg", "Sets", "Reps", "RIR", "Feeling", "Notes", "Exercise_ID", "Session_ID"], rows: [
      { locator: "Training!2", values: ["2026-08-20", "A", "Squat", 20, 3, 10, 2, "ok", "", "ex-1", "session-1"] },
      { locator: "Training!3", values: ["2026-08-21", "Run", "Easy run", "Собственный вес", 1, "4,22 км / 31:38", "", "", "", "run-1", "session-2"] },
      { locator: "Training!4", values: ["2026-08-22", "B", "Barbell squat", 30, 2, 8, 2, "ok", "", "ex-1", "session-3"] },
      { locator: "Training!5", values: ["2026-08-23", "Lunch", "Meal", 750, 62, 27, 63, "", "", "", "meal-1"] }
    ] }
  };
}

function recoverySnapshot(): FitnessTrackerRecoverySnapshot {
  return {
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID, locale: "ru_RU", timeZone: "Europe/Moscow", manifestChecksum: "d".repeat(64),
    dailyLog: { sheetId: 0, title: "Daily_Log", headers: ["Date", "Sleep", "HRV", "RHR", "NightHR", "SpO₂", "Temp", "BodyBattery", "MinSpO₂", "Respiration", "DeepSleep", "REMSleep", "LightSleep"], rows: [
      { locator: "Daily_Log!2", values: ["2026-08-20", 8 / 24, 45, 52, 58, 97, -0.2, 70, 88, 14.5, 1 / 24, 1.5 / 24, 5.5 / 24] },
      { locator: "Daily_Log!3", values: ["2026-08-21", "Нет данных", "", "", "", "", "", "", "", "", "", "", ""] }
    ] }
  };
}
