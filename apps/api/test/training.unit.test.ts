import { describe, expect, it } from "vitest";

import type { CreateTrainingProgram } from "@shape-of-you/contracts";

import {
  calculateProgressionWeight,
  canAccessTrainingExercise,
  validateTrainingProgramVersion
} from "../src/domain/training.js";

const program = (
  targetRepsMin = 6,
  targetRepsMax = 8,
  progressionIncrementKg: number | null = 2.5
): CreateTrainingProgram => ({
  name: "Силовая программа",
  note: null,
  workouts: [
    {
      name: "Тренировка A",
      prescriptions: [
        {
          exerciseVersionId: "00000000-0000-4000-8000-000000000001",
          loadBasis: "external_weight",
          targetWeightKg: 100,
          targetSets: 3,
          targetRepsMin,
          targetRepsMax,
          targetRir: 2,
          progressionIncrementKg,
          note: null
        }
      ]
    }
  ]
});

describe("Training domain", () => {
  it("isolates private exercises while sharing canonical definitions", () => {
    expect(canAccessTrainingExercise("shared", null, "person-b")).toBe(true);
    expect(
      canAccessTrainingExercise("private", "person-a", "person-a")
    ).toBe(true);
    expect(
      canAccessTrainingExercise("private", "person-a", "person-b")
    ).toBe(false);
  });

  it("rejects an inverted repetition range and a zero increment", () => {
    expect(() => validateTrainingProgramVersion(program(10, 8))).toThrow(
      "cannot exceed"
    );
    expect(() => validateTrainingProgramVersion(program(6, 8, 0))).toThrow(
      "must be positive"
    );
  });

  it("proposes only an explicit increment after all required sets qualify", () => {
    const prescription = {
      targetSets: 3,
      targetRepsMax: 8,
      targetRir: 2,
      targetWeightKg: 100,
      progressionIncrementKg: 2.5
    };

    expect(
      calculateProgressionWeight(prescription, [
        { reps: 8, rir: 2 },
        { reps: 9, rir: 3 },
        { reps: 8, rir: 2 }
      ])
    ).toBe(102.5);
    expect(
      calculateProgressionWeight(prescription, [
        { reps: 8, rir: 2 },
        { reps: 7, rir: 3 },
        { reps: 8, rir: 2 }
      ])
    ).toBeNull();
    expect(
      calculateProgressionWeight(
        { ...prescription, progressionIncrementKg: null },
        [
          { reps: 8, rir: 2 },
          { reps: 8, rir: 2 },
          { reps: 8, rir: 2 }
        ]
      )
    ).toBeNull();
  });
});
