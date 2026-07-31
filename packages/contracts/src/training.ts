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

export const TrainingCatalogVisibilitySchema = {
  type: "string",
  enum: ["shared", "private"]
} as const;

export const TrainingLoadBasisSchema = {
  type: "string",
  enum: ["external_weight", "body_weight", "assisted"]
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
  required: ["id", "version", "name", "note", "workouts", "createdAt"],
  properties: {
    id: uuidSchema,
    version: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    note: nullableTextSchema,
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

const performedSetInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["weightKg", "reps", "rir"],
  properties: {
    weightKg: nullableWeightSchema,
    reps: { type: "integer", minimum: 1, maximum: 10000 },
    rir: nullableRirSchema
  }
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
  required: ["id", "position", "weightKg", "reps", "rir"],
  properties: {
    id: uuidSchema,
    position: { type: "integer", minimum: 1 },
    ...performedSetInputSchema.properties
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
    "localDate",
    "timezone",
    "programVersionId",
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
    occurredAt: { type: "string", format: "date-time" },
    localDate: { type: "string", format: "date" },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    programVersionId: nullableUuidSchema,
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
