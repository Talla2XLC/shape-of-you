import {
  DailyAssessmentFactSummarySchema,
  DailyAssessmentV5UsedFactsSchema,
  DailyAssessmentV6UsedFactsSchema,
  DailyAssessmentV3PersonalBaselineSchema,
  DailyAssessmentMovementSchema,
  type DailyAssessmentAvailableV6,
  type DailyAssessmentV6UsedFacts
} from "./daily-assessment.js";
import {
  CurrentRecoveryContextResultSchema,
  type CurrentRecoveryContext
} from "./recovery.js";
import { NextTrainingStepSchema, type NextTrainingStep } from "./training.js";

const { recoveryRiskLevel: _riskLevel, recoveryHardStop: _hardStop, ...factSummaryProperties } =
  DailyAssessmentFactSummarySchema.properties;

/** Non-prescriptive daily facts; Recovery observations carry exact time and quality separately. */
export interface DailyDecisionFacts {
  readonly summary: Omit<DailyAssessmentV6UsedFacts["summary"], "recoveryRiskLevel" | "recoveryHardStop">;
  readonly coverageReadiness: DailyAssessmentV6UsedFacts["coverageReadiness"];
  readonly trainingDensity: DailyAssessmentV6UsedFacts["trainingDensity"];
  readonly wellbeingSignals: DailyAssessmentV6UsedFacts["wellbeingSignals"];
  readonly personalBaseline: DailyAssessmentAvailableV6["personalBaseline"];
  readonly movement: DailyAssessmentAvailableV6["movement"];
}

export const DailyDecisionFactsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "coverageReadiness", "trainingDensity", "wellbeingSignals", "personalBaseline", "movement"],
  properties: {
    summary: {
      type: "object",
      additionalProperties: false,
      required: Object.keys(factSummaryProperties),
      properties: factSummaryProperties
    },
    coverageReadiness: DailyAssessmentV6UsedFactsSchema.properties.coverageReadiness,
    trainingDensity: DailyAssessmentV5UsedFactsSchema.properties.trainingDensity,
    wellbeingSignals: DailyAssessmentV6UsedFactsSchema.properties.wellbeingSignals,
    personalBaseline: DailyAssessmentV3PersonalBaselineSchema,
    movement: DailyAssessmentMovementSchema
  }
} as const;

/** Current Person-local evidence and exact Training options without a daily action or permission status. */
export type DailyDecisionContextResult =
  | { readonly state: "timezone_required"; readonly timezone: null }
  | {
      readonly state: "available";
      readonly policyVersion: "daily-decision-context-v1";
      readonly localDate: string;
      readonly timezone: string;
      readonly evidenceChecksum: string;
      readonly facts: DailyDecisionFacts;
      readonly recovery: CurrentRecoveryContext;
      readonly training: {
        readonly activeProgramVersionId: string | null;
        readonly nextStep: NextTrainingStep;
      };
    };

export const DailyDecisionContextResultSchema = {
  $id: "DailyDecisionContextResult",
  oneOf: [
    {
      type: "object", additionalProperties: false,
      required: ["state", "timezone"],
      properties: { state: { const: "timezone_required" }, timezone: { type: "null" } }
    },
    {
      type: "object", additionalProperties: false,
      required: ["state", "policyVersion", "localDate", "timezone", "evidenceChecksum", "facts", "recovery", "training"],
      properties: {
        state: { const: "available" },
        policyVersion: { const: "daily-decision-context-v1" },
        localDate: { type: "string", format: "date" },
        timezone: { type: "string", minLength: 1, maxLength: 64 },
        evidenceChecksum: { type: "string", minLength: 64, maxLength: 64 },
        facts: DailyDecisionFactsSchema,
        recovery: CurrentRecoveryContextResultSchema.oneOf[0],
        training: {
          type: "object",
          additionalProperties: false,
          required: ["activeProgramVersionId", "nextStep"],
          properties: {
            activeProgramVersionId: {
              anyOf: [{ type: "string", format: "uuid" }, { type: "null" }]
            },
            nextStep: NextTrainingStepSchema
          }
        }
      }
    }
  ]
} as const;
