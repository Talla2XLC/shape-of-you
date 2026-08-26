import { describe, expect, it } from "vitest";

import { FITNESS_TRACKER_SPREADSHEET_ID, type FitnessTrackerRecoverySnapshot, type FitnessTrackerTrainingSnapshot } from "../src/import/fitness-tracker-sheets-reader.js";
import { RecoveryDryRunAdapter } from "../src/import/recovery-dry-run.js";
import { TrainingDryRunAdapter } from "../src/import/training-dry-run.js";

describe("unified Fitness Tracker Training dry-run", () => {
  it("classifies strength and distance sessions without inventing a malformed row", () => {
    const source = trainingSnapshot();
    const first = new TrainingDryRunAdapter().classify(source, []);
    expect(first.safeReport.counts).toEqual({ created: 2, unchanged: 0, conflict: 0, invalid: 1 });
    expect(first.privateDetail.candidates[0]?.exercises[0]?.sets[0]).toEqual({
      weightKg: 20,
      reps: 10,
      durationSeconds: null,
      distanceMeters: null,
      rir: 2
    });
    expect(first.privateDetail.candidates[1]?.exercises[0]?.sets[0]).toEqual({
      weightKg: null,
      reps: null,
      durationSeconds: 1898,
      distanceMeters: 4220,
      rir: null
    });

    const candidate = first.privateDetail.candidates[0]!;
    const repeat = new TrainingDryRunAdapter().classify(source, [{
      kind: "session",
      id: "00000000-0000-4000-8000-000000000001",
      sourceIdentity: candidate.sourceIdentity,
      checksum: candidate.checksum
    }]);
    expect(repeat.safeReport.counts.unchanged).toBe(1);
    expect(repeat.safeReport.counts.created).toBe(1);

    const mappingConflict = new TrainingDryRunAdapter().classify(source, [{
      kind: "exercise_mapping",
      id: "00000000-0000-4000-8000-000000000002",
      sourceExerciseId: "ex-1",
      sourceName: "Renamed without a version",
      checksum: "f".repeat(64)
    }]);
    expect(mappingConflict.safeReport.findings).toContainEqual(
      expect.objectContaining({ outcome: "conflict", code: "exercise_mapping_mismatch" })
    );
  });
});

describe("unified Fitness Tracker Recovery dry-run", () => {
  it("maps raw daily values to typed date-only observations and rejects narrative values", () => {
    const result = new RecoveryDryRunAdapter().classify(recoverySnapshot(), []);
    expect(result.safeReport.counts).toEqual({ created: 9, unchanged: 0, conflict: 0, invalid: 1 });
    expect(result.privateDetail.candidates.find(({ detail }) => detail.type === "sleep")?.detail).toEqual({
      type: "sleep",
      totalSleepMinutes: 480,
      deepSleepMinutes: 60,
      remSleepMinutes: 90,
      lightSleepMinutes: 330,
      sleepQuality: null
    });
    expect(result.privateDetail.candidates.find(({ detail }) => detail.type === "metric" && detail.metric === "temperature_deviation")?.detail).toEqual({
      type: "metric",
      metric: "temperature_deviation",
      value: -0.2,
      unit: "celsius"
    });
  });
});

function trainingSnapshot(): FitnessTrackerTrainingSnapshot {
  return {
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
    locale: "ru_RU",
    timeZone: "Europe/Moscow",
    manifestChecksum: "a".repeat(64),
    training: {
      sheetId: 1052535761,
      title: "Training",
      headers: ["Date", "Workout", "Exercise", "Weight_kg", "Sets", "Reps", "RIR", "Feeling", "Notes", "Exercise_ID", "Session_ID"],
      rows: [
        { locator: "Training!2", values: ["2026-08-20", "A", "Squat", 20, 3, 10, 2, "ok", "", "ex-1", "session-1"] },
        { locator: "Training!3", values: ["2026-08-21", "Run", "Easy run", "Собственный вес", 1, "4,22 км / 31:38", "", "", "", "run-1", "session-2"] },
        { locator: "Training!4", values: ["2026-08-22", "Lunch", "Meal", 750, 62, 27, 63, "", "", "", "meal-1"] }
      ]
    }
  };
}

function recoverySnapshot(): FitnessTrackerRecoverySnapshot {
  return {
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
    locale: "ru_RU",
    timeZone: "Europe/Moscow",
    manifestChecksum: "b".repeat(64),
    dailyLog: {
      sheetId: 0,
      title: "Daily_Log",
      headers: ["Date", "Sleep", "HRV", "RHR", "NightHR", "SpO₂", "Temp", "BodyBattery", "MinSpO₂", "Respiration", "DeepSleep", "REMSleep", "LightSleep"],
      rows: [
        { locator: "Daily_Log!2", values: ["2026-08-20", 8 / 24, 45, 52, 58, 97, -0.2, 70, 88, 14.5, 1 / 24, 1.5 / 24, 5.5 / 24] },
        { locator: "Daily_Log!3", values: ["2026-08-21", "Нет данных — Garmin выключился ночью", "", "", "", "", "", "", "", "", "", "", ""] }
      ]
    }
  };
}
