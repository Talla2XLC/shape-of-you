import { describe, expect, it, vi } from "vitest";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";

import {
  NextTrainingStepSchema,
  type CreateTrainingProgram,
  type ExternalActivitySummary,
  type TrainingProgram,
  type TrainingProgramVersion,
  type WorkoutSession
} from "@shape-of-you/contracts";

import {
  canAccessTrainingExercise,
  evaluateNextTrainingStep,
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

  it("compares confirmed programs by ordered domain meaning only", () => {
    const confirmed = {
      expectedActiveProgramId: null,
      expectedLockVersion: null,
      ...program()
    };
    const active: TrainingProgramVersion = {
      id: "00000000-0000-4000-8000-000000000010",
      version: 4,
      name: confirmed.name,
      note: confirmed.note,
      cadence: confirmed.cadence ?? null,
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

    expect(trainingProgramSnapshotMatches(active, { ...confirmed, cadence: confirmed.cadence ?? null })).toBe(true);
    expect(
      trainingProgramSnapshotMatches(active, {
        ...confirmed,
        cadence: confirmed.cadence ?? null,
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
        personId,
        activeVersion: null
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
      supersedesId: null,
      classification: null,
      sessionCovered: false
    }]);
    const service = new TrainingService(
      {
        findActiveProgram,
        listWorkoutSessions,
        listExternalActivities,
        readActivityRecordingMode: vi.fn().mockResolvedValue({ title: null, lockVersion: 0, updatedAt: null }),
        listTrustedExternalActivityTitles: vi.fn().mockResolvedValue([])
      } as unknown as TrainingStore,
      new SyntheticPersonContext(personId)
    );

    await expect(service.getTrainingContext({ historyLimit: 3 })).resolves.toEqual({
      status: "absent",
      program: null,
      recentSessions: { items: [] },
      trustedExternalTitles: [],
      activityRecordingMode: { title: null, lockVersion: 0, updatedAt: null },
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
        garminAttributed: true,
        classification: null
      }],
      nextStep: { state: "no_active_program", policyVersion: "training-next-step-v4" }
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
      recentExternalActivities: [{ name: "Morning run" }],
      nextStep: { state: "no_active_program" }
    });
    expect(listWorkoutSessions).toHaveBeenNthCalledWith(2, personId, 1);
    expect(listExternalActivities).toHaveBeenNthCalledWith(2, personId, 1);
  });
});

describe("next training step", () => {
  const activeProgram = {
    id: "00000000-0000-4000-8000-000000000201",
    personId: "00000000-0000-4000-8000-000000000202",
    activeVersionId: "00000000-0000-4000-8000-000000000203",
    activeVersion: {
      id: "00000000-0000-4000-8000-000000000203",
      cadence: {
        kind: "rolling_weekly",
        strengthSessionsPerWeek: 3,
        workoutSequence: [1, 2],
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
        { position: 1, name: "A", prescriptions: [{ exerciseVersionId: "00000000-0000-4000-8000-000000000211", loadBasis: "external_weight" }] },
        { position: 2, name: "B", prescriptions: [{ exerciseVersionId: "00000000-0000-4000-8000-000000000212", loadBasis: "external_weight" }] }
      ]
    }
  } as TrainingProgram;

  const cardio = {
    id: "00000000-0000-4000-8000-000000000204",
    occurredAt: "2026-09-22T06:00:00.000Z",
    localDate: "2026-09-22",
    durationSeconds: 2395,
    trainingLoad: 20,
    distanceMeters: 4880,
    averageHeartRate: 134
  } as ExternalActivitySummary;

  it("keeps persisted v1 next-step snapshots readable while accepting v2", () => {
    const ajv = new Ajv({ strict: false });
    const installFormats = addFormats as unknown as (instance: Ajv) => Ajv;
    installFormats(ajv);
    const validate = ajv.compile(NextTrainingStepSchema);
    expect(validate({
      state: "needs_classification",
      policyVersion: "training-next-step-v1",
      localDate: "2026-09-22",
      externalActivityId: "00000000-0000-4000-8000-000000000204",
      question: "Последняя силовая была тренировкой A или B?"
    })).toBe(true);
    expect(validate(evaluateNextTrainingStep({
      program: null,
      localDate: "2026-09-22",
      sessions: [],
      externalActivities: []
    }))).toBe(true);
    const options = evaluateNextTrainingStep({
      program: activeProgram, localDate: "2026-09-28", sessions: [], externalActivities: []
    });
    expect(validate(options)).toBe(true);
    if (options.state === "training_options") {
      expect(validate({ ...options, strength: null, lightCardio: null })).toBe(false);
    }
  });

  it("does not prescribe another workout after qualifying cardio today", () => {
    expect(evaluateNextTrainingStep({
      program: activeProgram,
      localDate: "2026-09-22",
      sessions: [],
      externalActivities: [cardio]
    })).toMatchObject({ state: "complete_today", evidenceIds: [cardio.id] });
  });

  it("asks one classification question instead of guessing an A/B position", () => {
    expect(evaluateNextTrainingStep({
      program: activeProgram,
      localDate: "2026-09-22",
      sessions: [],
      externalActivities: [{ ...cardio, id: "00000000-0000-4000-8000-000000000205", distanceMeters: null }]
    })).toMatchObject({
      state: "needs_classification",
      question: "Силовая 2026-09-22 — 1 — A, 2 — B или не по этой программе?"
    });
  });

  it("uses an exact external classification as cadence evidence without session details", () => {
    const noCardio = {
      ...activeProgram,
      activeVersion: {
        ...activeProgram.activeVersion!,
        cadence: { ...activeProgram.activeVersion!.cadence!, lightCardio: null }
      }
    };
    const classifiedActivity = {
      ...cardio,
      id: "00000000-0000-4000-8000-000000000250",
      occurredAt: "2026-09-21T06:00:00.000Z",
      localDate: "2026-09-21",
      distanceMeters: null,
      classification: {
        id: "00000000-0000-4000-8000-000000000251",
        programId: activeProgram.id,
        programVersionId: activeProgram.activeVersionId!,
        classification: { kind: "program_workout" as const, workoutPosition: 1 },
        createdAt: "2026-09-21T07:00:00.000Z"
      }
    };

    expect(evaluateNextTrainingStep({
      program: noCardio,
      localDate: "2026-09-22",
      sessions: [],
      externalActivities: [classifiedActivity]
    })).toMatchObject({
      state: "training_options",
      policyVersion: "training-next-step-v4",
      strength: { workoutPosition: 2, workoutName: "B" },
      lightCardio: null
    });
  });

  it("suppresses the question for a negative classification and refuses an unresolved old version", () => {
    const noCardio = {
      ...activeProgram,
      activeVersion: {
        ...activeProgram.activeVersion!,
        cadence: { ...activeProgram.activeVersion!.cadence!, lightCardio: null }
      }
    };
    const activity = {
      ...cardio,
      distanceMeters: null,
      classification: {
        id: "00000000-0000-4000-8000-000000000252",
        programId: activeProgram.id,
        programVersionId: activeProgram.activeVersionId!,
        classification: { kind: "not_program_workout" as const },
        createdAt: "2026-09-22T07:00:00.000Z"
      }
    };
    expect(evaluateNextTrainingStep({
      program: noCardio,
      localDate: "2026-09-22",
      sessions: [],
      externalActivities: [activity]
    })).toMatchObject({ state: "training_options", strength: { workoutPosition: 1 } });

    expect(evaluateNextTrainingStep({
      program: noCardio,
      localDate: "2026-09-22",
      sessions: [],
      externalActivities: [{
        ...activity,
        classification: {
          ...activity.classification,
          programVersionId: "00000000-0000-4000-8000-000000000299",
          classification: { kind: "program_workout" as const, workoutPosition: 2 }
        }
      }]
    })).toMatchObject({ state: "schedule_unavailable" });
  });

  it("preserves weekly occurrences and A/B sequence across compatible versions", () => {
    const noCardio = {
      ...activeProgram,
      activeVersion: {
        ...activeProgram.activeVersion!,
        cadence: { ...activeProgram.activeVersion!.cadence!, lightCardio: null }
      }
    };
    const oldVersion = {
      ...noCardio.activeVersion,
      id: "00000000-0000-4000-8000-000000000220",
      workouts: noCardio.activeVersion.workouts.map((workout) => ({
        ...workout,
        prescriptions: workout.prescriptions.map((prescription) => ({
          ...prescription,
          targetWeightKg: 75
        }))
      }))
    } as TrainingProgramVersion;
    const session = (id: string, versionId: string, date: string, position: number) => ({
      id, programVersionId: versionId, programWorkoutPosition: position,
      externalActivityId: null, localDate: date,
      occurredAt: `${date}T06:00:00.000Z`, createdAt: `${date}T07:00:00.000Z`
    }) as WorkoutSession;
    const priorVersions = [{ programId: noCardio.id, version: oldVersion }];
    const previous = session("00000000-0000-4000-8000-000000000221", oldVersion.id, "2026-09-23", 2);
    const current = session("00000000-0000-4000-8000-000000000222", noCardio.activeVersionId!, "2026-09-25", 1);
    expect(evaluateNextTrainingStep({
      program: noCardio, localDate: "2026-09-26", sessions: [previous, current],
      externalActivities: [], priorVersions
    })).toMatchObject({ state: "training_options", strength: { workoutPosition: 2 }, policyVersion: "training-next-step-v4" });
    expect(evaluateNextTrainingStep({
      program: noCardio, localDate: "2026-09-26",
      sessions: [session("00000000-0000-4000-8000-000000000223", oldVersion.id, "2026-09-21", 1), previous, current],
      externalActivities: [], priorVersions
    })).toMatchObject({ state: "week_complete", evidenceIds: [
      "00000000-0000-4000-8000-000000000223", previous.id, current.id
    ] });
  });

  it("does not infer A/B across incompatible versions or before classifying an earlier strength activity", () => {
    const noCardio = {
      ...activeProgram,
      activeVersion: {
        ...activeProgram.activeVersion!,
        cadence: { ...activeProgram.activeVersion!.cadence!, lightCardio: null }
      }
    };
    const prior = {
      ...noCardio.activeVersion,
      id: "00000000-0000-4000-8000-000000000224",
      workouts: noCardio.activeVersion.workouts.map((workout) => ({
        ...workout,
        prescriptions: workout.prescriptions.map((prescription) => ({
          ...prescription,
          exerciseVersionId: "00000000-0000-4000-8000-000000000225"
        }))
      }))
    } as TrainingProgramVersion;
    const oldSession = {
      id: "00000000-0000-4000-8000-000000000226",
      programVersionId: prior.id, programWorkoutPosition: 2,
      externalActivityId: null, localDate: "2026-09-23",
      occurredAt: "2026-09-23T06:00:00.000Z"
    } as WorkoutSession;
    expect(evaluateNextTrainingStep({
      program: noCardio, localDate: "2026-09-26", sessions: [oldSession],
      externalActivities: [], priorVersions: [{ programId: noCardio.id, version: prior }]
    })).toMatchObject({ state: "schedule_unavailable" });

    const later = { ...oldSession, id: "00000000-0000-4000-8000-000000000227",
      programVersionId: noCardio.activeVersionId, localDate: "2026-09-25",
      occurredAt: "2026-09-25T06:00:00.000Z" } as WorkoutSession;
    expect(evaluateNextTrainingStep({
      program: noCardio, localDate: "2026-09-26", sessions: [later],
      externalActivities: [{ ...cardio, id: "00000000-0000-4000-8000-000000000228",
        localDate: "2026-09-21", occurredAt: "2026-09-21T06:00:00.000Z",
        distanceMeters: null, durationSeconds: 2780, trainingLoad: 23 }]
    })).toMatchObject({ state: "needs_classification", externalActivityId: "00000000-0000-4000-8000-000000000228" });
    expect(evaluateNextTrainingStep({
      program: noCardio, localDate: "2026-09-26", sessions: [later],
      externalActivities: [{ ...cardio, id: "00000000-0000-4000-8000-000000000229",
        localDate: "2026-09-21", occurredAt: "2026-09-21T06:00:00.000Z",
        distanceMeters: null, durationSeconds: 579, trainingLoad: 7 }]
    })).toMatchObject({ state: "training_options", strength: { workoutPosition: 1 } });
  });

  it("continues A/B across Monday and a missed week without carrying over weekly quota", () => {
    const noCardio = {
      ...activeProgram,
      activeVersion: {
        ...activeProgram.activeVersion!,
        cadence: { ...activeProgram.activeVersion!.cadence!, lightCardio: null }
      }
    };
    const priorClassified = [
      { id: "00000000-0000-4000-8000-000000000231", localDate: "2026-09-23",
        occurredAt: "2026-09-23T06:00:00.000Z", programVersionId: noCardio.activeVersionId!, workoutPosition: 2 },
      { id: "00000000-0000-4000-8000-000000000232", localDate: "2026-09-25",
        occurredAt: "2026-09-25T06:00:00.000Z", programVersionId: noCardio.activeVersionId!, workoutPosition: 1 }
    ];
    for (const localDate of ["2026-09-28", "2026-10-12"]) {
      expect(evaluateNextTrainingStep({
        program: noCardio, localDate, sessions: [], externalActivities: [], priorClassified
      })).toMatchObject({
        state: "training_options", strength: { workoutPosition: 2, workoutName: "B", reason: "sequence_continues" },
        weeklyProgress: { strengthCompleted: 0, cardioCompleted: 0 }
      });
    }
    expect(evaluateNextTrainingStep({
      program: noCardio, localDate: "2026-09-28", sessions: [], externalActivities: [],
      priorClassified: [{ ...priorClassified[1]!, workoutPosition: 2 }]
    })).toMatchObject({ state: "training_options", strength: { workoutPosition: 1 } });
  });

  it("offers strength B and light cardio after Friday A across a week boundary or missed days", () => {
    const fridayA = {
      id: "00000000-0000-4000-8000-000000000236",
      localDate: "2026-09-25", occurredAt: "2026-09-25T06:00:00.000Z",
      programVersionId: activeProgram.activeVersionId!, workoutPosition: 1
    };
    for (const localDate of ["2026-09-28", "2026-10-12"]) {
      const step = evaluateNextTrainingStep({
        program: activeProgram, localDate, sessions: [], externalActivities: [],
        priorClassified: [fridayA]
      });
      expect(step).toMatchObject({
        state: "training_options", policyVersion: "training-next-step-v4",
        lastStrengthLocalDate: "2026-09-25",
        weeklyProgress: { strengthCompleted: 0, strengthTarget: 3, cardioCompleted: 0, cardioTarget: 2 },
        strength: { workoutPosition: 2, workoutName: "B" },
        lightCardio: { durationSeconds: 2400 }
      });
    }
  });

  it("removes cardio after two qualifying sessions in the new week", () => {
    const activities = ["2026-09-28", "2026-09-29"].map((localDate, index) => ({
      ...cardio,
      id: `00000000-0000-4000-8000-00000000024${index}`,
      localDate,
      occurredAt: `${localDate}T06:00:00.000Z`
    }));
    expect(evaluateNextTrainingStep({
      program: activeProgram, localDate: "2026-09-30", sessions: [],
      externalActivities: activities,
      priorClassified: [{ id: "00000000-0000-4000-8000-000000000242",
        localDate: "2026-09-25", occurredAt: "2026-09-25T06:00:00.000Z",
        programVersionId: activeProgram.activeVersionId!, workoutPosition: 1 }]
    })).toMatchObject({
      state: "training_options",
      weeklyProgress: { cardioCompleted: 2, cardioTarget: 2 },
      strength: { workoutPosition: 2 },
      lightCardio: null
    });
  });

  it("refuses an incompatible or unavailable cross-week sequence anchor", () => {
    const noCardio = {
      ...activeProgram,
      activeVersion: {
        ...activeProgram.activeVersion!,
        cadence: { ...activeProgram.activeVersion!.cadence!, lightCardio: null }
      }
    };
    const oldVersion = {
      ...noCardio.activeVersion!,
      id: "00000000-0000-4000-8000-000000000233",
      workouts: noCardio.activeVersion!.workouts.map((workout) => ({
        ...workout,
        prescriptions: workout.prescriptions.map((prescription) => ({
          ...prescription,
          exerciseVersionId: "00000000-0000-4000-8000-000000000234"
        }))
      }))
    } as TrainingProgramVersion;
    const anchor = { id: "00000000-0000-4000-8000-000000000235",
      localDate: "2026-09-25", occurredAt: "2026-09-25T06:00:00.000Z",
      programVersionId: oldVersion.id, workoutPosition: 1 };
    const compatibleVersion = {
      ...noCardio.activeVersion!, id: oldVersion.id,
      workouts: noCardio.activeVersion!.workouts.map((workout) => ({
        ...workout,
        prescriptions: workout.prescriptions.map((prescription) => ({
          ...prescription, targetWeightKg: 42
        }))
      }))
    } as TrainingProgramVersion;
    expect(evaluateNextTrainingStep({
      program: noCardio, localDate: "2026-09-28", sessions: [], externalActivities: [],
      priorClassified: [anchor], priorVersions: [{ programId: noCardio.id, version: compatibleVersion }]
    })).toMatchObject({ state: "training_options", strength: { workoutPosition: 2 } });
    expect(evaluateNextTrainingStep({
      program: noCardio, localDate: "2026-09-28", sessions: [], externalActivities: [],
      priorClassified: [anchor], priorVersions: [{ programId: noCardio.id, version: oldVersion }]
    })).toMatchObject({ state: "schedule_unavailable" });
    expect(evaluateNextTrainingStep({
      program: noCardio, localDate: "2026-09-28", sessions: [], externalActivities: [],
      priorClassified: [anchor]
    })).toMatchObject({ state: "schedule_unavailable" });
  });

  it("keeps an API-generated classification question within the contract bound", () => {
    const longNames = {
      ...activeProgram,
      activeVersion: {
        ...activeProgram.activeVersion!,
        workouts: activeProgram.activeVersion!.workouts.map((workout) => ({
          ...workout,
          name: workout.name.repeat(200)
        }))
      }
    };
    const result = evaluateNextTrainingStep({
      program: longNames,
      localDate: "2026-09-22",
      sessions: [],
      externalActivities: [{ ...cardio, distanceMeters: null, classification: null }]
    });
    expect(result.state).toBe("needs_classification");
    if (
      result.state === "needs_classification" &&
      result.policyVersion === "training-next-step-v4"
    ) {
      expect(result.question.length).toBeLessThanOrEqual(256);
      expect(result.options).toHaveLength(2);
    }
  });

  it("continues A/B after an explicitly linked strength session and intervening cardio", () => {
    const session = {
      id: "00000000-0000-4000-8000-000000000206",
      programVersionId: activeProgram.activeVersionId,
      programWorkoutPosition: 1,
      externalActivityId: "00000000-0000-4000-8000-000000000207",
      localDate: "2026-09-21",
      occurredAt: "2026-09-21T06:00:00.000Z",
      createdAt: "2026-09-21T07:00:00.000Z"
    } as WorkoutSession;
    const yesterdayCardio = {
      ...cardio,
      id: "00000000-0000-4000-8000-000000000208",
      occurredAt: "2026-09-21T18:00:00.000Z",
      localDate: "2026-09-21"
    };

    expect(evaluateNextTrainingStep({
      program: activeProgram,
      localDate: "2026-09-22",
      sessions: [session],
      externalActivities: [yesterdayCardio]
    })).toMatchObject({ state: "training_options", strength: { workoutPosition: 2, workoutName: "B" } });
  });

  it("counts explicitly linked detailed and external evidence only once", () => {
    const session = {
      id: "00000000-0000-4000-8000-000000000209",
      programVersionId: activeProgram.activeVersionId,
      programWorkoutPosition: 1,
      externalActivityId: cardio.id,
      localDate: cardio.localDate,
      occurredAt: cardio.occurredAt,
      createdAt: cardio.occurredAt
    } as WorkoutSession;

    expect(evaluateNextTrainingStep({
      program: activeProgram,
      localDate: cardio.localDate,
      sessions: [session],
      externalActivities: [cardio]
    })).toMatchObject({
      state: "complete_today",
      evidenceIds: [session.id]
    });
  });

  it("anchors the next step to an explicit repeat instead of rewriting history", () => {
    const sessions = ["2026-09-21T06:00:00.000Z", "2026-09-21T18:00:00.000Z"].map(
      (occurredAt, index) => ({
        id: `00000000-0000-4000-8000-00000000021${index}`,
        programVersionId: activeProgram.activeVersionId,
        programWorkoutPosition: 1,
        externalActivityId: null,
        localDate: "2026-09-21",
        occurredAt,
        createdAt: occurredAt
      } as WorkoutSession)
    );
    const noCardio = {
      ...activeProgram,
      activeVersion: {
        ...activeProgram.activeVersion!,
        cadence: { ...activeProgram.activeVersion!.cadence!, lightCardio: null }
      }
    };

    expect(evaluateNextTrainingStep({
      program: noCardio,
      localDate: "2026-09-22",
      sessions,
      externalActivities: []
    })).toMatchObject({
      state: "training_options",
      strength: { workoutPosition: 2, reason: "sequence_reanchored_after_deviation" }
    });
  });

  it("does not parse a legacy note when typed cadence is absent", () => {
    const legacy = {
      ...activeProgram,
      activeVersion: { ...activeProgram.activeVersion!, cadence: null, note: "A/B/A then B/A/B" }
    };
    expect(evaluateNextTrainingStep({
      program: legacy,
      localDate: "2026-09-22",
      sessions: [],
      externalActivities: []
    })).toEqual({ state: "schedule_unavailable", policyVersion: "training-next-step-v4" });
  });
});
