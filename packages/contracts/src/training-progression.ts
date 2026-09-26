import { type FromSchema } from "json-schema-to-ts";

const uuid = { type: "string", format: "uuid" } as const;

export const TrainingProgressionGuidanceSchema = {
  $id: "TrainingProgressionGuidance",
  type: "object",
  additionalProperties: false,
  required: ["state", "reason", "localDate", "programVersionId", "workoutPosition", "workoutName", "items"],
  properties: {
    state: { enum: ["available", "unavailable"] },
    reason: { enum: ["ready", "timezone_required", "recovery_not_ready", "training_step_unavailable", "program_changed"] },
    localDate: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
    programVersionId: { anyOf: [uuid, { type: "null" }] },
    workoutPosition: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    workoutName: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prescriptionPosition", "exerciseLabel", "currentTargetWeightKg", "targetSets", "targetRepsMin", "targetRepsMax", "targetRir", "action", "reason", "suggestedReps", "suggestedTargetWeightKg", "evidenceSessionIds", "evidence"],
        properties: {
          prescriptionPosition: { type: "integer", minimum: 1 },
          exerciseLabel: { type: "string", minLength: 1 },
          currentTargetWeightKg: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
          targetSets: { type: "integer", minimum: 1 },
          targetRepsMin: { type: "integer", minimum: 1 },
          targetRepsMax: { type: "integer", minimum: 1 },
          targetRir: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
          action: { enum: ["hold", "add_reps", "add_weight", "insufficient_evidence"] },
          reason: { enum: ["no_detailed_session", "incomplete_sets", "ambiguous_exercise", "ambiguous_prescription", "unsupported_load_basis", "weight_mismatch", "rir_missing", "below_repetition_range", "rir_below_target", "repetitions_available", "second_session_needed", "increment_missing", "increment_too_large", "two_sessions_qualified"] },
          suggestedReps: { anyOf: [{ type: "array", items: { type: "integer", minimum: 1 } }, { type: "null" }] },
          suggestedTargetWeightKg: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
          evidenceSessionIds: { type: "array", items: uuid, uniqueItems: true },
          evidence: {
            type: "array", maxItems: 2,
            items: {
              type: "object", additionalProperties: false,
              required: ["sessionId", "localDate", "sets"],
              properties: {
                sessionId: uuid,
                localDate: { type: "string", format: "date" },
                sets: {
                  type: "array",
                  items: {
                    type: "object", additionalProperties: false,
                    required: ["weightKg", "reps", "rir"],
                    properties: {
                      weightKg: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] },
                      reps: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
                      rir: { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
} as const;

/** Current-day read-only progression guidance gated by Daily Assessment. */
export type TrainingProgressionGuidance = FromSchema<typeof TrainingProgressionGuidanceSchema>;
