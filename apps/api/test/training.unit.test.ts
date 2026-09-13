import { describe, expect, it, vi } from "vitest";

import type {
  CreateTrainingProgram,
  SaveConfirmedTrainingProgram,
  TrainingProgramVersion
} from "@shape-of-you/contracts";

import {
  calculateProgressionWeight,
  canAccessTrainingExercise,
  trainingProgramSnapshotMatches,
  validateTrainingProgramVersion
} from "../src/domain/training.js";
import { SyntheticPersonContext } from "../src/application/person-context.js";
import type { TrainingStore } from "../src/storage/training-repository.js";
import { TrainingService } from "../src/training/training.service.js";

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

  it("compares confirmed programs by ordered domain meaning only", () => {
    const confirmed: SaveConfirmedTrainingProgram = {
      expectedActiveProgramId: null,
      expectedLockVersion: null,
      ...program()
    };
    const active: TrainingProgramVersion = {
      id: "00000000-0000-4000-8000-000000000010",
      version: 4,
      name: confirmed.name,
      note: confirmed.note,
      createdAt: "2026-09-12T08:00:00.000Z",
      workouts: confirmed.workouts.map((workout, workoutIndex) => ({
        position: workoutIndex + 1,
        name: workout.name,
        prescriptions: workout.prescriptions.map(
          (prescription, prescriptionIndex) => ({
            position: prescriptionIndex + 1,
            exerciseId: "00000000-0000-4000-8000-000000000011",
            exerciseLabel: "Historical label",
            ...prescription
          })
        )
      }))
    };

    expect(trainingProgramSnapshotMatches(active, confirmed)).toBe(true);
    expect(
      trainingProgramSnapshotMatches(active, {
        ...confirmed,
        workouts: confirmed.workouts.map((workout) => ({
          ...workout,
          prescriptions: workout.prescriptions.map((prescription) => ({
            ...prescription,
            targetWeightKg: 102.5
          }))
        }))
      })
    ).toBe(false);
  });
});

describe("Training context", () => {
  it("projects bounded connected activities without leaking persistence metadata", async () => {
    const personId = "00000000-0000-4000-8000-000000000020";
    const findActiveProgram = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000023",
        personId
      });
    const listWorkoutSessions = vi.fn().mockResolvedValue({ items: [] });
    const listExternalActivities = vi.fn().mockResolvedValue([{
      id: "00000000-0000-4000-8000-000000000021",
      connectionId: "00000000-0000-4000-8000-000000000022",
      personId,
      providerIdentity: "provider-activity-1",
      normalizedChecksum: "a".repeat(64),
      occurredAt: "2026-09-13T06:00:00.000Z",
      localDate: "2026-09-13",
      timezone: "Europe/Moscow",
      name: "Morning run",
      durationSeconds: 2_400,
      distanceMeters: 6_000,
      trainingLoad: 55,
      averageHeartRate: 144,
      maximumHeartRate: 168,
      deviceName: "Garmin Test",
      sourceProvider: "intervals_icu",
      garminAttributed: true,
      supersedesId: null
    }]);
    const service = new TrainingService(
      {
        findActiveProgram,
        listWorkoutSessions,
        listExternalActivities
      } as unknown as TrainingStore,
      new SyntheticPersonContext(personId)
    );

    await expect(service.getTrainingContext({ historyLimit: 3 })).resolves.toEqual({
      status: "absent",
      program: null,
      recentSessions: { items: [] },
      recentExternalActivities: [{
        id: "00000000-0000-4000-8000-000000000021",
        occurredAt: "2026-09-13T06:00:00.000Z",
        localDate: "2026-09-13",
        timezone: "Europe/Moscow",
        name: "Morning run",
        durationSeconds: 2_400,
        distanceMeters: 6_000,
        trainingLoad: 55,
        averageHeartRate: 144,
        maximumHeartRate: 168,
        deviceName: "Garmin Test",
        garminAttributed: true
      }]
    });
    expect(findActiveProgram).toHaveBeenCalledWith(personId);
    expect(listWorkoutSessions).toHaveBeenCalledWith(personId, 3);
    expect(listExternalActivities).toHaveBeenCalledWith(personId, 3);

    await expect(service.getTrainingContext({ historyLimit: 1 })).resolves.toMatchObject({
      status: "active",
      program: {
        id: "00000000-0000-4000-8000-000000000023",
        personId
      },
      recentSessions: { items: [] },
      recentExternalActivities: [{ name: "Morning run" }]
    });
    expect(listWorkoutSessions).toHaveBeenNthCalledWith(2, personId, 1);
    expect(listExternalActivities).toHaveBeenNthCalledWith(2, personId, 1);
  });
});
