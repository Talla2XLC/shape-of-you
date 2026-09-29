import { type FromSchema } from "json-schema-to-ts";

import { ProgressionCandidateSchema } from "./training.js";

const uuid = { type: "string", format: "uuid" } as const;

export const WorkingWeightProposalSchema = {
  type: "object",
  additionalProperties: false,
  required: [...ProgressionCandidateSchema.required, "localDate", "evidenceSessionIds", "assessmentEvidenceChecksum", "evidenceRevision"],
  properties: {
    ...ProgressionCandidateSchema.properties,
    localDate: { type: "string", format: "date" },
    evidenceSessionIds: { type: "array", items: uuid, minItems: 2, maxItems: 2, uniqueItems: true },
    assessmentEvidenceChecksum: { type: "string", minLength: 64, maxLength: 64 },
    evidenceRevision: { type: "string", minLength: 64, maxLength: 64 }
  }
} as const;

/** One exact read-only working-weight change backed by current detailed sessions. */
export type WorkingWeightProposal = FromSchema<typeof WorkingWeightProposalSchema>;

export const WorkingWeightProposalListSchema = {
  $id: "WorkingWeightProposalList",
  type: "object",
  additionalProperties: false,
  required: ["state", "reason", "localDate", "items"],
  properties: {
    state: { enum: ["available", "unavailable"] },
    reason: { enum: ["ready", "timezone_required", "recovery_not_ready", "training_step_unavailable", "program_changed", "evidence_changed"] },
    localDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
    items: { type: "array", items: WorkingWeightProposalSchema }
  }
} as const;

/** Current-day proposals; an unavailable result never authorizes a write. */
export type WorkingWeightProposalList = FromSchema<typeof WorkingWeightProposalListSchema>;

export const ApplyConfirmedWorkingWeightSchema = {
  $id: "ApplyConfirmedWorkingWeight",
  type: "object",
  additionalProperties: false,
  required: ["requestId", "confirmed", "proposal"],
  properties: {
    requestId: uuid,
    confirmed: { const: true },
    proposal: WorkingWeightProposalSchema
  }
} as const;

/** One explicit human confirmation bound to the exact last presented proposal. */
export type ApplyConfirmedWorkingWeight = FromSchema<typeof ApplyConfirmedWorkingWeightSchema>;

export const AppliedWorkingWeightSchema = {
  $id: "AppliedWorkingWeight",
  type: "object",
  additionalProperties: false,
  required: ["status", "changeId", "programId", "appliedVersionId"],
  properties: {
    status: { enum: ["applied", "already_applied"] },
    changeId: uuid,
    programId: uuid,
    appliedVersionId: uuid
  }
} as const;

/** Stable identity of one applied change; read the active program before claiming success. */
export type AppliedWorkingWeight = FromSchema<typeof AppliedWorkingWeightSchema>;
