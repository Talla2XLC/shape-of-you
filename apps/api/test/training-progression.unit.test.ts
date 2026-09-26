import { describe, expect, it } from "vitest";
import type { TrainingProgramVersion, WorkoutSession } from "@shape-of-you/contracts";

import { evaluateTrainingProgression } from "../src/domain/training-progression.js";

const versionId = "00000000-0000-4000-8000-000000000001";
const exerciseVersionId = "00000000-0000-4000-8000-000000000002";
const prescription = {
  position: 1, exerciseId: "00000000-0000-4000-8000-000000000003",
  exerciseVersionId, exerciseLabel: "Press", loadBasis: "external_weight",
  targetWeightKg: 100, targetSets: 3, targetRepsMin: 6, targetRepsMax: 8,
  targetRir: 2, progressionIncrementKg: 2.5, note: null
} as TrainingProgramVersion["workouts"][number]["prescriptions"][number];

function session(id: string, position: number, reps: number[], weight = 100, rir: number | null = 2): WorkoutSession {
  return {
    id, localDate: "2026-09-24", programVersionId: versionId, programWorkoutPosition: position,
    exercises: [{ exerciseVersionId, loadBasis: "external_weight", sets: reps.map((value) => ({ reps: value, weightKg: weight, rir })) }]
  } as WorkoutSession;
}

describe("session-backed training progression", () => {
  const latest = session("00000000-0000-4000-8000-000000000011", 1, [8, 8, 8]);
  const previous = session("00000000-0000-4000-8000-000000000012", 1, [8, 8, 8]);

  it("requires two exact A sessions for a weight increase", () => {
    expect(evaluateTrainingProgression(versionId, 1, prescription, [latest], "2026-09-25").action).toBe("hold");
    expect(evaluateTrainingProgression(versionId, 1, prescription, [latest, previous], "2026-09-25")).toMatchObject({
      action: "add_weight", suggestedTargetWeightKg: 102.5,
      evidenceSessionIds: [latest.id, previous.id]
    });
    expect(evaluateTrainingProgression(versionId, 2, prescription, [latest, previous], "2026-09-25").action).toBe("insufficient_evidence");
    expect(evaluateTrainingProgression("00000000-0000-4000-8000-000000000099", 1, prescription, [latest, previous], "2026-09-25").action).toBe("insufficient_evidence");
  });

  it("adds at most one repetition per set within the current range", () => {
    expect(evaluateTrainingProgression(versionId, 1, prescription,
      [session(latest.id, 1, [6, 7, 8])], "2026-09-25")).toMatchObject({
      action: "add_reps", suggestedReps: [7, 8, 8]
    });
  });

  it("fails closed for wrong weight, missing RIR, incomplete sets and an excessive increment", () => {
    expect(evaluateTrainingProgression(versionId, 1, prescription,
      [session(latest.id, 1, [8, 8, 8], 95), previous], "2026-09-25").action).toBe("insufficient_evidence");
    expect(evaluateTrainingProgression(versionId, 1, prescription,
      [session(latest.id, 1, [8, 8, 8], 100, null), previous], "2026-09-25").reason).toBe("rir_missing");
    expect(evaluateTrainingProgression(versionId, 1, prescription,
      [session(latest.id, 1, [8, 8]), previous], "2026-09-25").reason).toBe("incomplete_sets");
    expect(evaluateTrainingProgression(versionId, 1,
      { ...prescription, progressionIncrementKg: 11 }, [latest, previous], "2026-09-25").reason).toBe("increment_too_large");
  });

  it("does not skip a failed second session to use an older success", () => {
    const failed = session("00000000-0000-4000-8000-000000000013", 1, [7, 8, 8]);
    expect(evaluateTrainingProgression(versionId, 1, prescription,
      [latest, failed, previous], "2026-09-25")).toMatchObject({ action: "hold", reason: "second_session_needed" });
  });

  it("rejects future and ambiguous prescription evidence", () => {
    const future = { ...latest, localDate: "2026-09-26" };
    expect(evaluateTrainingProgression(versionId, 1, prescription, [future, previous], "2026-09-25").action).toBe("hold");
    expect(evaluateTrainingProgression(versionId, 1, prescription, [latest, previous], "2026-09-25", true))
      .toMatchObject({ action: "insufficient_evidence", reason: "ambiguous_prescription" });
  });
});
