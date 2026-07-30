import type { FromSchema } from "json-schema-to-ts";

import {
  EmbeddedSourceReferenceSchema,
  SourceReferenceInputSchema,
} from "./source-reference.js";

export const PhysicalGoalStatusSchema = {
  type: "string",
  enum: ["draft", "active", "completed", "cancelled"]
} as const;

export const PhysicalGoalMetricSchema = {
  type: "string",
  enum: [
    "weight",
    "body_fat_percentage",
    "lean_mass",
    "waist",
    "chest",
    "hips",
    "thigh",
    "biceps"
  ]
} as const;

export const PhysicalGoalCriterionInputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "metric",
    "mode",
    "direction",
    "targetValue",
    "minimumValue",
    "maximumValue",
    "unit"
  ],
  properties: {
    metric: PhysicalGoalMetricSchema,
    mode: {
      type: "string",
      enum: ["directional", "exact", "range", "dynamic"]
    },
    direction: {
      anyOf: [
        {
          type: "string",
          enum: ["decrease", "maintain", "increase"]
        },
        { type: "null" }
      ]
    },
    targetValue: {
      anyOf: [{ type: "number", minimum: 0 }, { type: "null" }]
    },
    minimumValue: {
      anyOf: [{ type: "number", minimum: 0 }, { type: "null" }]
    },
    maximumValue: {
      anyOf: [{ type: "number", minimum: 0 }, { type: "null" }]
    },
    unit: { type: "string", enum: ["kg", "percent", "cm"] }
  }
} as const;

export type PhysicalGoalCriterionInput = FromSchema<
  typeof PhysicalGoalCriterionInputSchema
>;

const physicalGoalCriterionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "position", ...PhysicalGoalCriterionInputSchema.required],
  properties: {
    id: { type: "string", format: "uuid" },
    position: { type: "integer", minimum: 1 },
    ...PhysicalGoalCriterionInputSchema.properties
  }
} as const;

export const PhysicalGoalCriterionSchema = {
  $id: "PhysicalGoalCriterion",
  ...physicalGoalCriterionSchema
} as const;

export type PhysicalGoalCriterion = FromSchema<
  typeof PhysicalGoalCriterionSchema
>;

const physicalGoalVersionSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "goalId",
    "version",
    "intent",
    "effectiveFrom",
    "targetDate",
    "criteria",
    "sourceReference",
    "dedupeKey",
    "createdAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    goalId: { type: "string", format: "uuid" },
    version: { type: "integer", minimum: 1 },
    intent: { type: "string", minLength: 1, maxLength: 4096 },
    effectiveFrom: {
      anyOf: [{ type: "string", format: "date" }, { type: "null" }]
    },
    targetDate: {
      anyOf: [{ type: "string", format: "date" }, { type: "null" }]
    },
    criteria: {
      type: "array",
      maxItems: 32,
      items: physicalGoalCriterionSchema
    },
    sourceReference: EmbeddedSourceReferenceSchema,
    dedupeKey: { type: "string", minLength: 1, maxLength: 256 },
    createdAt: { type: "string", format: "date-time" }
  }
} as const;

export const PhysicalGoalVersionSchema = {
  $id: "PhysicalGoalVersion",
  ...physicalGoalVersionSchema
} as const;

export type PhysicalGoalVersion = FromSchema<
  typeof PhysicalGoalVersionSchema
>;

const nullableDateTimeSchema = {
  anyOf: [
    { type: "string", format: "date-time" },
    { type: "null" }
  ]
} as const;

const physicalGoalSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "personId",
    "status",
    "currentVersion",
    "latestVersion",
    "lockVersion",
    "createdAt",
    "activatedAt",
    "completedAt",
    "cancelledAt"
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    personId: { type: "string", format: "uuid" },
    status: PhysicalGoalStatusSchema,
    currentVersion: {
      anyOf: [physicalGoalVersionSchema, { type: "null" }]
    },
    latestVersion: physicalGoalVersionSchema,
    lockVersion: { type: "integer", minimum: 0 },
    createdAt: { type: "string", format: "date-time" },
    activatedAt: nullableDateTimeSchema,
    completedAt: nullableDateTimeSchema,
    cancelledAt: nullableDateTimeSchema
  }
} as const;

export const PhysicalGoalSchema = {
  $id: "PhysicalGoal",
  ...physicalGoalSchema
} as const;

export type PhysicalGoal = FromSchema<typeof PhysicalGoalSchema>;

const goalVersionInputProperties = {
  intent: { type: "string", minLength: 1, maxLength: 4096 },
  effectiveFrom: {
    anyOf: [{ type: "string", format: "date" }, { type: "null" }]
  },
  targetDate: {
    anyOf: [{ type: "string", format: "date" }, { type: "null" }]
  },
  criteria: {
    type: "array",
    maxItems: 32,
    items: PhysicalGoalCriterionInputSchema
  },
  sourceReference: SourceReferenceInputSchema,
  dedupeKey: { type: "string", minLength: 1, maxLength: 256 }
} as const;

export const CreatePhysicalGoalSchema = {
  $id: "CreatePhysicalGoal",
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "effectiveFrom",
    "targetDate",
    "criteria",
    "sourceReference",
    "dedupeKey"
  ],
  properties: goalVersionInputProperties
} as const;

export type CreatePhysicalGoal = FromSchema<
  typeof CreatePhysicalGoalSchema
>;

export const CreatePhysicalGoalVersionSchema = {
  ...CreatePhysicalGoalSchema,
  $id: "CreatePhysicalGoalVersion"
} as const;

export type CreatePhysicalGoalVersion = FromSchema<
  typeof CreatePhysicalGoalVersionSchema
>;

export const PhysicalGoalIdParamsSchema = {
  $id: "PhysicalGoalIdParams",
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" }
  }
} as const;

export type PhysicalGoalIdParams = FromSchema<
  typeof PhysicalGoalIdParamsSchema
>;

export const PhysicalGoalVersionParamsSchema = {
  $id: "PhysicalGoalVersionParams",
  type: "object",
  additionalProperties: false,
  required: ["id", "version"],
  properties: {
    id: { type: "string", format: "uuid" },
    version: { type: "integer", minimum: 1 }
  }
} as const;

export type PhysicalGoalVersionParams = FromSchema<
  typeof PhysicalGoalVersionParamsSchema
>;

export const PhysicalGoalTransitionSchema = {
  $id: "PhysicalGoalTransition",
  type: "object",
  additionalProperties: false,
  required: ["expectedLockVersion"],
  properties: {
    expectedLockVersion: { type: "integer", minimum: 0 }
  }
} as const;

export type PhysicalGoalTransition = FromSchema<
  typeof PhysicalGoalTransitionSchema
>;

export const ListPhysicalGoalsQuerySchema = {
  $id: "ListPhysicalGoalsQuery",
  type: "object",
  additionalProperties: false,
  properties: {
    status: PhysicalGoalStatusSchema
  }
} as const;

export type ListPhysicalGoalsQuery = FromSchema<
  typeof ListPhysicalGoalsQuerySchema
>;

export const PhysicalGoalListSchema = {
  $id: "PhysicalGoalList",
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: { type: "array", items: PhysicalGoalSchema }
  }
} as const;

export type PhysicalGoalList = FromSchema<
  typeof PhysicalGoalListSchema
>;

export const PhysicalGoalHistorySchema = {
  $id: "PhysicalGoalHistory",
  type: "object",
  additionalProperties: false,
  required: ["goal", "versions"],
  properties: {
    goal: physicalGoalSchema,
    versions: {
      type: "array",
      minItems: 1,
      items: physicalGoalVersionSchema
    }
  }
} as const;

export type PhysicalGoalHistory = FromSchema<
  typeof PhysicalGoalHistorySchema
>;
