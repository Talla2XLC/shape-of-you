const uuid = { type: "string", format: "uuid" } as const;
const dateTime = { type: "string", format: "date-time" } as const;

/** Typed evidence reported about one immutable daily recommendation snapshot. */
export type DailyRecommendationFeedbackStatus =
  | "accepted"
  | "completed"
  | "skipped"
  | "too_heavy"
  | "unsuitable";

export const DailyRecommendationFeedbackStatusSchema = {
  type: "string",
  enum: ["accepted", "completed", "skipped", "too_heavy", "unsuitable"]
} as const;

/** Idempotent command adding one typed feedback event to a daily snapshot. */
export interface CreateDailyRecommendationFeedback {
  readonly snapshotId: string;
  readonly status: DailyRecommendationFeedbackStatus;
  readonly comment?: string;
  readonly idempotencyKey: string;
  readonly supersedesFeedbackId?: string;
}

export const CreateDailyRecommendationFeedbackSchema = {
  $id: "CreateDailyRecommendationFeedback",
  type: "object",
  additionalProperties: false,
  required: ["snapshotId", "status", "idempotencyKey"],
  properties: {
    snapshotId: uuid,
    status: DailyRecommendationFeedbackStatusSchema,
    comment: { type: "string", minLength: 1, maxLength: 1000, pattern: ".*\\S.*" },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 256, pattern: ".*\\S.*" },
    supersedesFeedbackId: uuid
  }
} as const;

/** One immutable Person-owned feedback event for a daily recommendation. */
export interface DailyRecommendationFeedback {
  readonly id: string;
  readonly snapshotId: string;
  readonly personId: string;
  readonly actorPersonId: string;
  readonly status: DailyRecommendationFeedbackStatus;
  readonly comment: string | null;
  readonly idempotencyKey: string;
  readonly supersedesFeedbackId: string | null;
  readonly reportedAt: string;
}

export const DailyRecommendationFeedbackSchema = {
  $id: "DailyRecommendationFeedback",
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "snapshotId",
    "personId",
    "actorPersonId",
    "status",
    "comment",
    "idempotencyKey",
    "supersedesFeedbackId",
    "reportedAt"
  ],
  properties: {
    id: uuid,
    snapshotId: uuid,
    personId: uuid,
    actorPersonId: uuid,
    status: DailyRecommendationFeedbackStatusSchema,
    comment: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 1000, pattern: ".*\\S.*" },
        { type: "null" }
      ]
    },
    idempotencyKey: { type: "string", minLength: 1, maxLength: 256, pattern: ".*\\S.*" },
    supersedesFeedbackId: { anyOf: [uuid, { type: "null" }] },
    reportedAt: dateTime
  }
} as const;

/** Ordered feedback history for one exact daily recommendation snapshot. */
export interface DailyRecommendationFeedbackList {
  readonly snapshotId: string;
  readonly items: readonly DailyRecommendationFeedback[];
}

export const DailyRecommendationFeedbackListSchema = {
  $id: "DailyRecommendationFeedbackList",
  type: "object",
  additionalProperties: false,
  required: ["snapshotId", "items"],
  properties: {
    snapshotId: uuid,
    items: { type: "array", items: DailyRecommendationFeedbackSchema }
  }
} as const;

/** Route parameters selecting one immutable daily recommendation snapshot. */
export interface DailyRecommendationSnapshotIdParams {
  readonly snapshotId: string;
}

export const DailyRecommendationSnapshotIdParamsSchema = {
  $id: "DailyRecommendationSnapshotIdParams",
  type: "object",
  additionalProperties: false,
  required: ["snapshotId"],
  properties: { snapshotId: uuid }
} as const;
