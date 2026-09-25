import type { FromSchema } from "json-schema-to-ts";

import {
  SourceReferenceInputSchema,
  SourceReferenceSchema
} from "./source-reference.js";

const uuidSchema = { type: "string", format: "uuid" } as const;
const nullableUuidSchema = {
  anyOf: [uuidSchema, { type: "null" }]
} as const;
const nullableShortTextSchema = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 256 },
    { type: "null" }
  ]
} as const;
const nullableTextSchema = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 4096 },
    { type: "null" }
  ]
} as const;
const nullableConfidenceSchema = {
  anyOf: [
    { type: "number", minimum: 0, maximum: 1, multipleOf: 0.001 },
    { type: "null" }
  ]
} as const;
const nullableWeightSchema = {
  anyOf: [
    {
      type: "number",
      minimum: 0,
      maximum: 100000,
      multipleOf: 0.001
    },
    { type: "null" }
  ]
} as const;
const nullableRirSchema = {
  anyOf: [
    { type: "number", minimum: 0, maximum: 20, multipleOf: 0.5 },
    { type: "null" }
  ]
} as const;

export const TrainingProgramCadenceSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "strengthSessionsPerWeek",
    "workoutSequence",
    "lightCardio"
  ],
  properties: {
    kind: { const: "rolling_weekly" },
    strengthSessionsPerWeek: { type: "integer", minimum: 1, maximum: 14 },
    workoutSequence: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: { type: "integer", minimum: 1, maximum: 100 }
    },
    lightCardio: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: [
            "sessionsPerWeek",
            "durationSeconds",
            "targetAverageHeartRateMin",
            "targetAverageHeartRateMax",
            "warmupSeconds",
            "workSeconds",
            "cooldownSeconds"
          ],
          properties: {
            sessionsPerWeek: { type: "integer", minimum: 1, maximum: 14 },
            durationSeconds: { type: "integer", minimum: 60, maximum: 86400 },
            targetAverageHeartRateMin: { type: "integer", minimum: 30, maximum: 250 },
            targetAverageHeartRateMax: { type: "integer", minimum: 30, maximum: 250 },
            warmupSeconds: { type: "integer", minimum: 0, maximum: 86400 },
            workSeconds: { type: "integer", minimum: 1, maximum: 86400 },
            cooldownSeconds: { type: "integer", minimum: 0, maximum: 86400 }
          }
        },
        { type: "null" }
      ]
    }
  }
} as const;

/** Typed non-weekday cadence pinned to one immutable program version. */
export type TrainingProgramCadence = FromSchema<typeof TrainingProgramCadenceSchema>;

export const TrainingCatalogVisibilitySchema = {
  type: "string",
  enum: ["shared", "private"]
} as const;

export const TrainingLoadBasisSchema = {
  type: "string",
  enum: ["external_weight", "body_weight", "assisted"]
} as const;

export const WorkoutTemporalPrecisionSchema = {
  type: "string",
  enum: ["instant", "local_date"]
} as const;

const exerciseVersionProperties = {
  name: { type: "string", minLength: 1, maxLength: 256 },
  category: nullableShortTextSchema,
  movementPattern: nullableShortTextSchema,
  equipment: nullableShortTextSchema,
  instructions: nullableTextSchema,
  note: nullableTextSchema
} as const;

export const ExerciseVersionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "version",
    "name",
    "category",
    "movementPattern",
    "equipment",
    "instructions",
    "note",
    "createdAt"
  ],
  properties: {
    id: uuidSchema,
    version: { type: "integer", minimum: 1 },
    ...exerciseVersionProperties,
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export const ExerciseSchema = {
  $id: "TrainingExercise",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "visibility",
    "ownerPersonId",
    "lockVersion",
    "createdAt",
    "currentVersion"
  ],
  properties: {
    id: uuidSchema,
    visibility: TrainingCatalogVisibilitySchema,
    ownerPersonId: nullableUuidSchema,
    lockVersion: { type: "integer", minimum: 0 },
    createdAt: { type: "string", format: "date-time" },
    currentVersion: ExerciseVersionSchema
  }
} as const;

/** Stable shared or Person-private exercise and its current revision. */
export type Exercise = FromSchema<typeof ExerciseSchema>;

export const CreateExerciseSchema = {
  $id: "CreateTrainingExercise",
  type: "object",
  additionalProperties: false,
  required: ["visibility", "name"],
  properties: {
    visibility: TrainingCatalogVisibilitySchema,
    ...exerciseVersionProperties
  }
} as const;

/** Command creating an exercise and its first immutable revision. */
export type CreateExercise = FromSchema<typeof CreateExerciseSchema>;

export const CreateExerciseVersionSchema = {
  $id: "CreateTrainingExerciseVersion",
  type: "object",
  additionalProperties: false,
  required: ["expectedLockVersion", "name"],
  properties: {
    expectedLockVersion: { type: "integer", minimum: 0 },
    ...exerciseVersionProperties
  }
} as const;

/** Command appending and selecting one immutable exercise revision. */
export type CreateExerciseVersion = FromSchema<
  typeof CreateExerciseVersionSchema
>;

export const ExerciseOverlaySchema = {
  $id: "TrainingExerciseOverlay",
  type: "object",
  additionalProperties: false,
  required: [
    "personId",
    "exerciseId",
    "alias",
    "available",
    "note",
    "updatedAt"
  ],
  properties: {
    personId: uuidSchema,
    exerciseId: uuidSchema,
    alias: nullableShortTextSchema,
    available: { type: "boolean" },
    note: nullableTextSchema,
    updatedAt: { type: "string", format: "date-time" }
  }
} as const;

/** Person-owned preferences for one accessible exercise. */
export type ExerciseOverlay = FromSchema<typeof ExerciseOverlaySchema>;

export const UpsertExerciseOverlaySchema = {
  $id: "UpsertTrainingExerciseOverlay",
  type: "object",
  additionalProperties: false,
  required: ["alias", "available", "note"],
  properties: {
    alias: nullableShortTextSchema,
    available: { type: "boolean" },
    note: nullableTextSchema
  }
} as const;

/** Complete replacement of a Person's exercise overlay. */
export type UpsertExerciseOverlay = FromSchema<
  typeof UpsertExerciseOverlaySchema
>;

const prescriptionInputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "exerciseVersionId",
    "loadBasis",
    "targetWeightKg",
    "targetSets",
    "targetRepsMin",
    "targetRepsMax",
    "targetRir",
    "progressionIncrementKg",
    "note"
  ],
  properties: {
    exerciseVersionId: uuidSchema,
    loadBasis: TrainingLoadBasisSchema,
    targetWeightKg: nullableWeightSchema,
    targetSets: { type: "integer", minimum: 1, maximum: 100 },
    targetRepsMin: { type: "integer", minimum: 1, maximum: 10000 },
    targetRepsMax: { type: "integer", minimum: 1, maximum: 10000 },
    targetRir: nullableRirSchema,
    progressionIncrementKg: nullableWeightSchema,
    note: nullableTextSchema
  }
} as const;

const confirmedExerciseDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "category",
    "movementPattern",
    "equipment",
    "instructions",
    "note"
  ],
  properties: exerciseVersionProperties
} as const;

const confirmedPrescriptionProperties = {
  loadBasis: TrainingLoadBasisSchema,
  targetWeightKg: nullableWeightSchema,
  targetSets: { type: "integer", minimum: 1, maximum: 100 },
  targetRepsMin: { type: "integer", minimum: 1, maximum: 10000 },
  targetRepsMax: { type: "integer", minimum: 1, maximum: 10000 },
  targetRir: nullableRirSchema,
  progressionIncrementKg: nullableWeightSchema,
  note: nullableTextSchema
} as const;

const confirmedPrescriptionRequired = [
  "loadBasis",
  "targetWeightKg",
  "targetSets",
  "targetRepsMin",
  "targetRepsMax",
  "targetRir",
  "progressionIncrementKg",
  "note"
] as const;

const confirmedPrescriptionSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["exerciseVersionId", ...confirmedPrescriptionRequired],
      properties: {
        exerciseVersionId: uuidSchema,
        ...confirmedPrescriptionProperties
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["exercise", ...confirmedPrescriptionRequired],
      properties: {
        exercise: confirmedExerciseDescriptorSchema,
        ...confirmedPrescriptionProperties
      }
    }
  ]
} as const;

const confirmedProgramWorkoutInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "prescriptions"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 256 },
    prescriptions: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: confirmedPrescriptionSchema
    }
  }
} as const;

const confirmedProgramVersionInputProperties = {
  name: { type: "string", minLength: 1, maxLength: 256 },
  note: nullableTextSchema,
  cadence: TrainingProgramCadenceSchema,
  workouts: {
    type: "array",
    minItems: 1,
    maxItems: 100,
    items: confirmedProgramWorkoutInputSchema
  }
} as const;

export const ProgramWorkoutInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "prescriptions"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 256 },
    prescriptions: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: prescriptionInputSchema
    }
  }
} as const;

const programVersionInputProperties = {
  name: { type: "string", minLength: 1, maxLength: 256 },
  note: nullableTextSchema,
  cadence: TrainingProgramCadenceSchema,
  workouts: {
    type: "array",
    minItems: 1,
    maxItems: 100,
    items: ProgramWorkoutInputSchema
  }
} as const;

export const CreateTrainingProgramSchema = {
  $id: "CreateTrainingProgram",
  type: "object",
  additionalProperties: false,
  required: ["name", "note", "workouts"],
  properties: programVersionInputProperties
} as const;

/** Command creating a Person-owned program and its first draft version. */
export type CreateTrainingProgram = FromSchema<
  typeof CreateTrainingProgramSchema
>;

export const CreateTrainingProgramVersionSchema = {
  $id: "CreateTrainingProgramVersion",
  type: "object",
  additionalProperties: false,
  required: ["expectedLockVersion", "name", "note", "workouts"],
  properties: {
    expectedLockVersion: { type: "integer", minimum: 0 },
    ...programVersionInputProperties
  }
} as const;

/** Command appending one immutable draft version to a program. */
export type CreateTrainingProgramVersion = FromSchema<
  typeof CreateTrainingProgramVersionSchema
>;

export const ProgramPrescriptionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "position",
    "exerciseId",
    "exerciseVersionId",
    "exerciseLabel",
    "loadBasis",
    "targetWeightKg",
    "targetSets",
    "targetRepsMin",
    "targetRepsMax",
    "targetRir",
    "progressionIncrementKg",
    "note"
  ],
  properties: {
    position: { type: "integer", minimum: 1 },
    exerciseId: uuidSchema,
    exerciseLabel: { type: "string", minLength: 1, maxLength: 256 },
    ...prescriptionInputSchema.properties
  }
} as const;

export const ProgramWorkoutSchema = {
  type: "object",
  additionalProperties: false,
  required: ["position", "name", "prescriptions"],
  properties: {
    position: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    prescriptions: {
      type: "array",
      items: ProgramPrescriptionSchema
    }
  }
} as const;

export const TrainingProgramVersionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "version", "name", "note", "cadence", "workouts", "createdAt"],
  properties: {
    id: uuidSchema,
    version: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    note: nullableTextSchema,
    cadence: {
      anyOf: [TrainingProgramCadenceSchema, { type: "null" }]
    },
    workouts: { type: "array", items: ProgramWorkoutSchema },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

/** Immutable ordered prescription snapshot for one training program. */
export type TrainingProgramVersion = FromSchema<
  typeof TrainingProgramVersionSchema
>;

export const TrainingProgramSchema = {
  $id: "TrainingProgram",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "lockVersion",
    "activeVersionId",
    "activeVersion",
    "createdAt",
    "currentVersion"
  ],
  properties: {
    id: uuidSchema,
    personId: uuidSchema,
    lockVersion: { type: "integer", minimum: 0 },
    activeVersionId: nullableUuidSchema,
    activeVersion: {
      anyOf: [TrainingProgramVersionSchema, { type: "null" }]
    },
    createdAt: { type: "string", format: "date-time" },
    currentVersion: TrainingProgramVersionSchema
  }
} as const;

/** Person-owned training program and its current immutable draft version. */
export type TrainingProgram = FromSchema<typeof TrainingProgramSchema>;

export const TrustedExternalActivityTitleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["programVersionId", "workoutPosition", "title"],
  properties: {
    programVersionId: uuidSchema,
    workoutPosition: { type: "integer", minimum: 1 },
    title: { type: "string", minLength: 1, maxLength: 256 }
  }
} as const;

/** Person-confirmed title authority for one exact immutable program workout. */
export type TrustedExternalActivityTitle = FromSchema<typeof TrustedExternalActivityTitleSchema>;

export const TrustedExternalActivityTitleListSchema = {
  $id: "TrustedExternalActivityTitleList",
  type: "array",
  items: TrustedExternalActivityTitleSchema
} as const;

export const SetTrustedExternalActivityTitleSchema = {
  $id: "SetTrustedExternalActivityTitle",
  type: "object",
  additionalProperties: false,
  required: ["expectedProgramId", "expectedProgramVersionId", "expectedLockVersion",
    "workoutPosition", "expectedCurrentTitle", "title"],
  properties: {
    expectedProgramId: uuidSchema,
    expectedProgramVersionId: uuidSchema,
    expectedLockVersion: { type: "integer", minimum: 0 },
    workoutPosition: { type: "integer", minimum: 1 },
    expectedCurrentTitle: { anyOf: [
      { type: "string", minLength: 1, maxLength: 256 }, { type: "null" }
    ] },
    title: { anyOf: [
      { type: "string", minLength: 1, maxLength: 256 }, { type: "null" }
    ] }
  }
} as const;

/** Optimistic explicit confirmation, replacement, or revocation of a title. */
export type SetTrustedExternalActivityTitle = FromSchema<typeof SetTrustedExternalActivityTitleSchema>;

export const SetTrustedExternalActivityTitleResultSchema = {
  $id: "SetTrustedExternalActivityTitleResult",
  type: "object",
  additionalProperties: false,
  required: ["outcome", "currentTitle"],
  properties: {
    outcome: { type: "string", enum: ["created", "replaced", "revoked", "unchanged", "stale"] },
    currentTitle: { anyOf: [
      { type: "string", minLength: 1, maxLength: 256 }, { type: "null" }
    ] }
  }
} as const;

/** Current title state and closed result of one title-authority command. */
export type SetTrustedExternalActivityTitleResult = FromSchema<typeof SetTrustedExternalActivityTitleResultSchema>;

export const ActivateTrainingProgramVersionSchema = {
  $id: "ActivateTrainingProgramVersion",
  type: "object",
  additionalProperties: false,
  required: ["expectedLockVersion"],
  properties: {
    expectedLockVersion: { type: "integer", minimum: 0 }
  }
} as const;

/** Optimistic-lock command that explicitly activates a program version. */
export type ActivateTrainingProgramVersion = FromSchema<
  typeof ActivateTrainingProgramVersionSchema
>;

const confirmedProgramExpectationProperties = {
  expectedActiveProgramId: nullableUuidSchema,
  expectedLockVersion: {
    anyOf: [
      { type: "integer", minimum: 0 },
      { type: "null" }
    ]
  }
} as const;

export const SaveConfirmedTrainingProgramSchema = {
  $id: "SaveConfirmedTrainingProgram",
  type: "object",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: [
        "expectedActiveProgramId",
        "expectedLockVersion",
        "name",
        "note",
        "workouts"
      ],
      properties: {
        ...confirmedProgramExpectationProperties,
        expectedActiveProgramId: { type: "null" },
        expectedLockVersion: { type: "null" },
        ...confirmedProgramVersionInputProperties
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "expectedActiveProgramId",
        "expectedLockVersion",
        "name",
        "note",
        "workouts"
      ],
      properties: {
        ...confirmedProgramExpectationProperties,
        expectedActiveProgramId: uuidSchema,
        expectedLockVersion: { type: "integer", minimum: 0 },
        ...confirmedProgramVersionInputProperties
      }
    }
  ]
} as const;

/** Explicitly confirmed complete program snapshot with an optimistic active-state expectation. */
export type SaveConfirmedTrainingProgram = FromSchema<
  typeof SaveConfirmedTrainingProgramSchema
>;

export const SaveConfirmedTrainingProgramResultSchema = {
  $id: "SaveConfirmedTrainingProgramResult",
  type: "object",
  additionalProperties: false,
  required: ["outcome", "program"],
  properties: {
    outcome: {
      type: "string",
      enum: ["created", "updated", "unchanged", "needs_clarification"]
    },
    program: {
      anyOf: [TrainingProgramSchema, { type: "null" }]
    },
    ambiguities: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requestedName", "candidates"],
        properties: {
          requestedName: { type: "string", minLength: 1, maxLength: 256 },
          candidates: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "exerciseId",
                "exerciseVersionId",
                "name",
                "category",
                "movementPattern",
                "equipment"
              ],
              properties: {
                exerciseId: uuidSchema,
                exerciseVersionId: uuidSchema,
                name: { type: "string", minLength: 1, maxLength: 256 },
                category: nullableShortTextSchema,
                movementPattern: nullableShortTextSchema,
                equipment: nullableShortTextSchema
              }
            }
          }
        }
      }
    }
  },
  oneOf: [
    {
      properties: {
        outcome: {
          type: "string",
          enum: ["created", "updated", "unchanged"]
        },
        program: TrainingProgramSchema
      },
      not: { required: ["ambiguities"] }
    },
    {
      required: ["ambiguities"],
      properties: {
        outcome: { type: "string", const: "needs_clarification" },
        program: { type: "null" }
      }
    }
  ]
} as const;

/** Result of an atomic confirmed save or a write-free exact-match ambiguity. */
export type SaveConfirmedTrainingProgramResult = FromSchema<
  typeof SaveConfirmedTrainingProgramResultSchema
>;

export const MaterializeTrainingProgramCadenceSchema = {
  $id: "MaterializeTrainingProgramCadence",
  type: "object",
  additionalProperties: false,
  required: [
    "expectedActiveProgramId",
    "expectedActiveVersionId",
    "expectedLockVersion",
    "cadence"
  ],
  properties: {
    expectedActiveProgramId: uuidSchema,
    expectedActiveVersionId: uuidSchema,
    expectedLockVersion: { type: "integer", minimum: 0 },
    cadence: TrainingProgramCadenceSchema
  }
} as const;

/** Accepted typed cadence bound to one exact active immutable program version. */
export type MaterializeTrainingProgramCadence = FromSchema<
  typeof MaterializeTrainingProgramCadenceSchema
>;

export const MaterializeTrainingProgramCadenceResultSchema = {
  $id: "MaterializeTrainingProgramCadenceResult",
  type: "object",
  additionalProperties: false,
  required: ["outcome", "program"],
  properties: {
    outcome: { type: "string", enum: ["updated", "unchanged"] },
    program: TrainingProgramSchema
  }
} as const;

/** Result of atomically materializing cadence on the exact active program. */
export type MaterializeTrainingProgramCadenceResult = FromSchema<
  typeof MaterializeTrainingProgramCadenceResultSchema
>;

export const ExternalActivityProgramClassificationValueSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["kind", "workoutPosition"],
      properties: {
        kind: { const: "program_workout" },
        workoutPosition: { type: "integer", minimum: 1, maximum: 100 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "not_program_workout" } }
    }
  ]
} as const;

/** Explicit user authority about one imported activity and active program. */
export type ExternalActivityProgramClassificationValue = FromSchema<
  typeof ExternalActivityProgramClassificationValueSchema
>;

export const ClassifyExternalActivitySchema = {
  $id: "ClassifyExternalActivity",
  type: "object",
  additionalProperties: false,
  required: [
    "expectedExternalActivityId",
    "expectedLocalDate",
    "expectedActiveProgramId",
    "expectedActiveVersionId",
    "expectedLockVersion",
    "expectedCurrentClassificationId",
    "classification"
  ],
  properties: {
    expectedExternalActivityId: uuidSchema,
    expectedLocalDate: { type: "string", format: "date" },
    expectedActiveProgramId: uuidSchema,
    expectedActiveVersionId: uuidSchema,
    expectedLockVersion: { type: "integer", minimum: 0 },
    expectedCurrentClassificationId: nullableUuidSchema,
    classification: ExternalActivityProgramClassificationValueSchema
  }
} as const;

/** Optimistic command classifying one exact current imported activity. */
export type ClassifyExternalActivity = FromSchema<
  typeof ClassifyExternalActivitySchema
>;

export const ExternalActivityProgramClassificationSchema = {
  $id: "ExternalActivityProgramClassification",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "programId",
    "programVersionId",
    "classification",
    "createdAt"
  ],
  properties: {
    id: uuidSchema,
    programId: uuidSchema,
    programVersionId: uuidSchema,
    classification: ExternalActivityProgramClassificationValueSchema,
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

/** Current append-only classification projected without provider internals. */
export type ExternalActivityProgramClassification = FromSchema<
  typeof ExternalActivityProgramClassificationSchema
>;

export const ClassifyExternalActivityResultSchema = {
  $id: "ClassifyExternalActivityResult",
  type: "object",
  additionalProperties: false,
  required: ["outcome", "classification"],
  properties: {
    outcome: {
      type: "string",
      enum: ["created", "corrected", "unchanged", "stale", "not_pending"]
    },
    classification: {
      anyOf: [ExternalActivityProgramClassificationSchema, { type: "null" }]
    }
  }
} as const;

/** Closed outcome of an idempotent or optimistic classification command. */
export type ClassifyExternalActivityResult = FromSchema<
  typeof ClassifyExternalActivityResultSchema
>;

const performedSetInputProperties = {
  weightKg: nullableWeightSchema,
  reps: {
    anyOf: [
      { type: "integer", minimum: 1, maximum: 10000 },
      { type: "null" }
    ]
  },
  durationSeconds: {
    anyOf: [
      { type: "integer", minimum: 1, maximum: 604800 },
      { type: "null" }
    ]
  },
  distanceMeters: {
    anyOf: [
      { type: "number", exclusiveMinimum: 0, maximum: 1000000, multipleOf: 0.001 },
      { type: "null" }
    ]
  },
  rir: nullableRirSchema
} as const;

const performedSetInputSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["weightKg", "reps", "rir"],
      properties: {
        ...performedSetInputProperties,
        reps: { type: "integer", minimum: 1, maximum: 10000 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["weightKg", "reps", "durationSeconds", "rir"],
      properties: {
        ...performedSetInputProperties,
        durationSeconds: { type: "integer", minimum: 1, maximum: 604800 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["weightKg", "reps", "distanceMeters", "rir"],
      properties: {
        ...performedSetInputProperties,
        distanceMeters: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 1000000,
          multipleOf: 0.001
        }
      }
    }
  ]
} as const;

const performedExerciseInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["exerciseVersionId", "loadBasis", "feeling", "note", "sets"],
  properties: {
    exerciseVersionId: uuidSchema,
    loadBasis: TrainingLoadBasisSchema,
    feeling: nullableShortTextSchema,
    note: nullableTextSchema,
    sets: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: performedSetInputSchema
    }
  }
} as const;

const workoutSessionInputProperties = {
  occurredAt: { type: "string", format: "date-time" },
  timezone: { type: "string", minLength: 1, maxLength: 64 },
  programVersionId: nullableUuidSchema,
  programWorkoutPosition: {
    anyOf: [{ type: "integer", minimum: 1, maximum: 100 }, { type: "null" }]
  },
  externalActivityId: nullableUuidSchema,
  workoutName: { type: "string", minLength: 1, maxLength: 256 },
  feeling: nullableShortTextSchema,
  note: nullableTextSchema,
  exercises: {
    type: "array",
    minItems: 1,
    maxItems: 200,
    items: performedExerciseInputSchema
  },
  sourceReference: SourceReferenceInputSchema,
  dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
  confidence: nullableConfidenceSchema
} as const;

export const CreateWorkoutSessionSchema = {
  $id: "CreateWorkoutSession",
  type: "object",
  additionalProperties: false,
  required: [
    "occurredAt",
    "timezone",
    "programVersionId",
    "workoutName",
    "feeling",
    "note",
    "exercises",
    "sourceReference",
    "dedupeKey",
    "confidence"
  ],
  properties: workoutSessionInputProperties
} as const;

/** Command creating one immutable workout session with individual sets. */
export type CreateWorkoutSession = FromSchema<
  typeof CreateWorkoutSessionSchema
>;

export const CorrectWorkoutSessionSchema = {
  $id: "CorrectWorkoutSession",
  type: "object",
  additionalProperties: false,
  required: [
    "occurredAt",
    "timezone",
    "programVersionId",
    "workoutName",
    "feeling",
    "note",
    "exercises",
    "sourceReference",
    "dedupeKey",
    "confidence",
    "correctionReason"
  ],
  properties: {
    ...workoutSessionInputProperties,
    correctionReason: {
      type: "string",
      minLength: 1,
      maxLength: 512
    }
  }
} as const;

/** Full immutable replacement for one workout session. */
export type CorrectWorkoutSession = FromSchema<
  typeof CorrectWorkoutSessionSchema
>;

export const PerformedSetSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "position",
    "weightKg",
    "reps",
    "durationSeconds",
    "distanceMeters",
    "rir"
  ],
  properties: {
    id: uuidSchema,
    position: { type: "integer", minimum: 1 },
    ...performedSetInputProperties
  }
} as const;

export const PerformedExerciseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "position",
    "exerciseId",
    "exerciseVersionId",
    "exerciseLabel",
    "loadBasis",
    "feeling",
    "note",
    "sets"
  ],
  properties: {
    id: uuidSchema,
    position: { type: "integer", minimum: 1 },
    exerciseId: uuidSchema,
    exerciseVersionId: uuidSchema,
    exerciseLabel: { type: "string", minLength: 1, maxLength: 256 },
    loadBasis: TrainingLoadBasisSchema,
    feeling: nullableShortTextSchema,
    note: nullableTextSchema,
    sets: { type: "array", items: PerformedSetSchema }
  }
} as const;

export const WorkoutSessionSchema = {
  $id: "WorkoutSession",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "occurredAt",
    "temporalPrecision",
    "localDate",
    "timezone",
    "programVersionId",
    "programWorkoutPosition",
    "externalActivityId",
    "workoutName",
    "feeling",
    "note",
    "exercises",
    "sourceReference",
    "dedupeKey",
    "confidence",
    "supersedesId",
    "correctionReason",
    "createdAt"
  ],
  properties: {
    id: uuidSchema,
    personId: uuidSchema,
    occurredAt: {
      anyOf: [
        { type: "string", format: "date-time" },
        { type: "null" }
      ]
    },
    temporalPrecision: WorkoutTemporalPrecisionSchema,
    localDate: { type: "string", format: "date" },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    programVersionId: nullableUuidSchema,
    programWorkoutPosition: {
      anyOf: [{ type: "integer", minimum: 1, maximum: 100 }, { type: "null" }]
    },
    externalActivityId: nullableUuidSchema,
    workoutName: { type: "string", minLength: 1, maxLength: 256 },
    feeling: nullableShortTextSchema,
    note: nullableTextSchema,
    exercises: { type: "array", items: PerformedExerciseSchema },
    sourceReference: SourceReferenceSchema,
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
    confidence: nullableConfidenceSchema,
    supersedesId: nullableUuidSchema,
    correctionReason: nullableShortTextSchema,
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

/** Immutable Person-owned workout session fact. */
export type WorkoutSession = FromSchema<typeof WorkoutSessionSchema>;

export const WorkoutSessionHistorySchema = {
  $id: "WorkoutSessionHistory",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", minItems: 1, items: WorkoutSessionSchema }
  }
} as const;

/** Original-to-current correction chain for a workout session. */
export type WorkoutSessionHistory = FromSchema<
  typeof WorkoutSessionHistorySchema
>;

export const ListWorkoutSessionsQuerySchema = {
  $id: "ListWorkoutSessionsQuery",
  type: "object",
  additionalProperties: false,
  properties: {
    limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    localDate: { type: "string", format: "date" }
  }
} as const;

/** Filters for a bounded current-session list. */
export type ListWorkoutSessionsQuery = FromSchema<
  typeof ListWorkoutSessionsQuerySchema
>;

export const WorkoutSessionListSchema = {
  $id: "WorkoutSessionList",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", items: WorkoutSessionSchema }
  }
} as const;

/** Bounded current workout-session list. */
export type WorkoutSessionList = FromSchema<
  typeof WorkoutSessionListSchema
>;

export const ExternalActivitySummarySchema = {
  $id: "ExternalActivitySummary",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "occurredAt",
    "localDate",
    "timezone",
    "name",
    "durationSeconds",
    "distanceMeters",
    "trainingLoad",
    "averageHeartRate",
    "maximumHeartRate",
    "deviceName",
    "garminAttributed",
    "classification"
  ],
  properties: {
    id: uuidSchema,
    occurredAt: { type: "string", format: "date-time" },
    localDate: { type: "string", format: "date" },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    durationSeconds: {
      type: "number",
      minimum: 0,
      maximum: 604800,
      multipleOf: 0.001
    },
    distanceMeters: {
      anyOf: [
        {
          type: "number",
          minimum: 0,
          maximum: 10000000,
          multipleOf: 0.001
        },
        { type: "null" }
      ]
    },
    trainingLoad: {
      anyOf: [
        {
          type: "number",
          minimum: 0,
          maximum: 100000,
          multipleOf: 0.001
        },
        { type: "null" }
      ]
    },
    averageHeartRate: {
      anyOf: [
        {
          type: "number",
          minimum: 0,
          maximum: 300,
          multipleOf: 0.001
        },
        { type: "null" }
      ]
    },
    maximumHeartRate: {
      anyOf: [
        {
          type: "number",
          minimum: 0,
          maximum: 300,
          multipleOf: 0.001
        },
        { type: "null" }
      ]
    },
    deviceName: nullableShortTextSchema,
    garminAttributed: { type: "boolean" },
    classification: {
      anyOf: [ExternalActivityProgramClassificationSchema, { type: "null" }]
    }
  }
} as const;

/** Safe provider-neutral projection of one current connected activity fact. */
export type ExternalActivitySummary = FromSchema<
  typeof ExternalActivitySummarySchema
>;

export const TrainingContextQuerySchema = {
  $id: "TrainingContextQuery",
  type: "object",
  additionalProperties: false,
  properties: {
    historyLimit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
    localDate: { type: "string", format: "date" }
  }
} as const;

/** Bounded query for active training authority and recent completed evidence. */
export type TrainingContextQuery = FromSchema<
  typeof TrainingContextQuerySchema
>;

export const NextTrainingStepSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "policyVersion"],
      properties: {
        state: { enum: ["no_active_program", "local_date_required", "schedule_unavailable"] },
        policyVersion: { enum: ["training-next-step-v1", "training-next-step-v2"] }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "policyVersion", "localDate", "externalActivityId", "question"],
      properties: {
        state: { const: "needs_classification" },
        policyVersion: { const: "training-next-step-v1" },
        localDate: { type: "string", format: "date" },
        externalActivityId: uuidSchema,
        question: { type: "string", minLength: 1, maxLength: 256 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "policyVersion", "localDate", "externalActivityId", "options", "question"],
      properties: {
        state: { const: "needs_classification" },
        policyVersion: { const: "training-next-step-v2" },
        localDate: { type: "string", format: "date" },
        externalActivityId: uuidSchema,
        options: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["workoutPosition", "workoutName"],
            properties: {
              workoutPosition: { type: "integer", minimum: 1, maximum: 100 },
              workoutName: { type: "string", minLength: 1, maxLength: 256 }
            }
          }
        },
        question: { type: "string", minLength: 1, maxLength: 256 }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "policyVersion", "localDate", "reason", "evidenceIds"],
      properties: {
        state: { enum: ["complete_today", "week_complete"] },
        policyVersion: { enum: ["training-next-step-v1", "training-next-step-v2"] },
        localDate: { type: "string", format: "date" },
        reason: { enum: ["training_already_completed_today", "weekly_targets_completed"] },
        evidenceIds: { type: "array", items: uuidSchema, uniqueItems: true }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "policyVersion", "localDate", "programVersionId", "workoutPosition", "workoutName", "reason"],
      properties: {
        state: { const: "strength" },
        policyVersion: { enum: ["training-next-step-v1", "training-next-step-v2"] },
        localDate: { type: "string", format: "date" },
        programVersionId: uuidSchema,
        workoutPosition: { type: "integer", minimum: 1, maximum: 100 },
        workoutName: { type: "string", minLength: 1, maxLength: 256 },
        reason: { enum: ["sequence_start", "sequence_continues", "after_cardio", "sequence_reanchored_after_deviation", "cardio_target_completed"] }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "policyVersion", "localDate", "reason", "prescription"],
      properties: {
        state: { const: "light_cardio" },
        policyVersion: { enum: ["training-next-step-v1", "training-next-step-v2"] },
        localDate: { type: "string", format: "date" },
        reason: { enum: ["between_strength_sessions", "strength_target_completed"] },
        prescription: {
          type: "object",
          additionalProperties: false,
          required: ["durationSeconds", "targetAverageHeartRateMin", "targetAverageHeartRateMax", "warmupSeconds", "workSeconds", "cooldownSeconds"],
          properties: {
            durationSeconds: { type: "integer" },
            targetAverageHeartRateMin: { type: "integer" },
            targetAverageHeartRateMax: { type: "integer" },
            warmupSeconds: { type: "integer" },
            workSeconds: { type: "integer" },
            cooldownSeconds: { type: "integer" }
          }
        }
      }
    }
  ]
} as const;

/** Deterministic Training-owned projection of the next program step. */
export type NextTrainingStep = FromSchema<typeof NextTrainingStepSchema>;

export const TrainingContextSchema = {
  $id: "TrainingContext",
  type: "object",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: [
        "status",
        "program",
        "recentSessions",
        "recentExternalActivities",
        "nextStep"
      ],
      properties: {
        status: { const: "active" },
        program: TrainingProgramSchema,
        recentSessions: WorkoutSessionListSchema,
        recentExternalActivities: {
          type: "array",
          items: ExternalActivitySummarySchema
        },
        trustedExternalTitles: TrustedExternalActivityTitleListSchema,
        nextStep: NextTrainingStepSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "status",
        "program",
        "recentSessions",
        "recentExternalActivities",
        "nextStep"
      ],
      properties: {
        status: { const: "absent" },
        program: { type: "null" },
        recentSessions: WorkoutSessionListSchema,
        recentExternalActivities: {
          type: "array",
          items: ExternalActivitySummarySchema
        },
        trustedExternalTitles: TrustedExternalActivityTitleListSchema,
        nextStep: NextTrainingStepSchema
      }
    }
  ]
} as const;

/** Active planned authority plus separate bounded manual and connected evidence. */
export type TrainingContext = FromSchema<typeof TrainingContextSchema>;

export const PersonalRecordSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "exerciseId",
    "exerciseVersionId",
    "exerciseLabel",
    "sessionId",
    "performedSetId",
    "weightKg",
    "reps",
    "occurredAt"
  ],
  properties: {
    exerciseId: uuidSchema,
    exerciseVersionId: uuidSchema,
    exerciseLabel: { type: "string", minLength: 1, maxLength: 256 },
    sessionId: uuidSchema,
    performedSetId: uuidSchema,
    weightKg: {
      type: "number",
      minimum: 0,
      maximum: 100000,
      multipleOf: 0.001
    },
    reps: { type: "integer", minimum: 1 },
    occurredAt: { type: "string", format: "date-time" }
  }
} as const;

export const PersonalRecordListSchema = {
  $id: "TrainingPersonalRecordList",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", items: PersonalRecordSchema }
  }
} as const;

/** Current strength records calculated from non-superseded sets. */
export type PersonalRecordList = FromSchema<
  typeof PersonalRecordListSchema
>;

export const ProgressionCandidateSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "programId",
    "programLockVersion",
    "programVersionId",
    "workoutPosition",
    "prescriptionPosition",
    "exerciseId",
    "exerciseVersionId",
    "exerciseLabel",
    "currentTargetWeightKg",
    "suggestedTargetWeightKg",
    "evidenceSessionId"
  ],
  properties: {
    programId: uuidSchema,
    programLockVersion: { type: "integer", minimum: 0 },
    programVersionId: uuidSchema,
    workoutPosition: { type: "integer", minimum: 1 },
    prescriptionPosition: { type: "integer", minimum: 1 },
    exerciseId: uuidSchema,
    exerciseVersionId: uuidSchema,
    exerciseLabel: { type: "string", minLength: 1, maxLength: 256 },
    currentTargetWeightKg: {
      type: "number",
      minimum: 0,
      maximum: 100000,
      multipleOf: 0.001
    },
    suggestedTargetWeightKg: {
      type: "number",
      minimum: 0,
      maximum: 100000,
      multipleOf: 0.001
    },
    evidenceSessionId: uuidSchema
  }
} as const;

export const ProgressionCandidateListSchema = {
  $id: "TrainingProgressionCandidateList",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", items: ProgressionCandidateSchema }
  }
} as const;

/** Eligible weight increases derived from the active program and latest facts. */
export type ProgressionCandidateList = FromSchema<
  typeof ProgressionCandidateListSchema
>;

export const AcceptProgressionCandidateSchema = {
  $id: "AcceptProgressionCandidate",
  type: "object",
  additionalProperties: false,
  required: [
    "expectedLockVersion",
    "programVersionId",
    "workoutPosition",
    "prescriptionPosition",
    "evidenceSessionId"
  ],
  properties: {
    expectedLockVersion: { type: "integer", minimum: 0 },
    programVersionId: uuidSchema,
    workoutPosition: { type: "integer", minimum: 1 },
    prescriptionPosition: { type: "integer", minimum: 1 },
    evidenceSessionId: uuidSchema
  }
} as const;

/** Command accepting one still-valid progression candidate as a draft version. */
export type AcceptProgressionCandidate = FromSchema<
  typeof AcceptProgressionCandidateSchema
>;

export const TrainingIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: { id: uuidSchema }
} as const;

/** UUID path parameter for a Training resource. */
export type TrainingIdParams = FromSchema<typeof TrainingIdParamsSchema>;

export const TrainingVersionParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "versionId"],
  properties: { id: uuidSchema, versionId: uuidSchema }
} as const;

/** Program and immutable version UUID path parameters. */
export type TrainingVersionParams = FromSchema<
  typeof TrainingVersionParamsSchema
>;
