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

  it("does not treat in-progress sessions or unresolved substitutions as progression evidence", () => {
    const ongoing = { ...latest, completionState: "in_progress" as const };
    expect(evaluateTrainingProgression(versionId, 1, prescription, [ongoing], "2026-09-25").reason).toBe("no_detailed_session");
    const substituted = { ...latest, exercises: latest.exercises.map((exercise) => ({ ...exercise, exerciseVersionId: null })) };
    expect(evaluateTrainingProgression(versionId, 1, prescription, [substituted, previous], "2026-09-25").action).toBe("insufficient_evidence");
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

  it("never turns body-weight or assisted evidence into an external-weight increase", () => {
    for (const loadBasis of ["body_weight", "assisted"] as const) {
      expect(evaluateTrainingProgression(versionId, 1,
        { ...prescription, loadBasis }, [latest, previous], "2026-09-25"))
        .toMatchObject({ action: "insufficient_evidence", reason: "unsupported_load_basis" });
    }
  });
  it("uses only the latest high-reserve session, even when the previous session failed", () => {
    const high = session(latest.id, 1, [8, 8, 8], 100, 4);
    const failed = session(previous.id, 1, [6, 6, 6]);
    for (const evidence of [[high], [high, failed]]) {
      expect(evaluateTrainingProgression(versionId, 1, prescription, evidence, "2026-09-25"))
        .toMatchObject({ action: "add_weight", reason: "single_session_high_reserve",
          suggestedTargetWeightKg: 102.5, evidenceSessionIds: [latest.id] });
    }
  });

  it.each([[0, 3], [1, 3], [2, 4], [4, 6]])("bounds reserve for target %s at %s", (targetRir, threshold) => {
    const target = { ...prescription, targetRir };
    expect(evaluateTrainingProgression(versionId, 1, target,
      [session(latest.id, 1, [8, 8, 8], 100, threshold)], "2026-09-25").reason)
      .toBe("single_session_high_reserve");
    const uneven = session(latest.id, 1, [8, 8, 8], 100, threshold);
    uneven.exercises[0]!.sets[1]!.rir = threshold - 0.5;
    expect(evaluateTrainingProgression(versionId, 1, target, [uneven], "2026-09-25").action).toBe("hold");
  });

  it("requires an explicit target and complete prescribed measurements, without substituting extra sets", () => {
    const high = session(latest.id, 1, [8, 8, 8], 100, 4);
    expect(evaluateTrainingProgression(versionId, 1, { ...prescription, targetRir: null },
      [high], "2026-09-25").reason).toBe("second_session_needed");
    const bad = session(latest.id, 1, [8, 8, 8, 8], 100, 4);
    bad.exercises[0]!.sets[0]!.rir = 3;
    expect(evaluateTrainingProgression(versionId, 1, prescription, [bad], "2026-09-25").reason)
      .toBe("second_session_needed");
    for (const value of [session(latest.id, 1, [8, 7, 8], 100, 4),
      session(latest.id, 1, [8, 8, 8], 99, 4), session(latest.id, 1, [8, 8], 100, 4),
      session(latest.id, 1, [8, 8, 8], 100, null)]) {
      expect(evaluateTrainingProgression(versionId, 1, prescription, [value], "2026-09-25").action)
        .not.toBe("add_weight");
    }
  });

  it("retains increment caps on the single-session path", () => {
    const high = session(latest.id, 1, [8, 8, 8], 100, 4);
    for (const increment of [null, 0, 5.001, 11]) {
      expect(evaluateTrainingProgression(versionId, 1, { ...prescription, progressionIncrementKg: increment },
        [high], "2026-09-25").action).toBe("hold");
    }
    expect(evaluateTrainingProgression(versionId, 1, { ...prescription, targetWeightKg: 20,
      progressionIncrementKg: 2.001 }, [session(latest.id, 1, [8, 8, 8], 20, 4)], "2026-09-25").reason)
      .toBe("increment_too_large");
  });

});
