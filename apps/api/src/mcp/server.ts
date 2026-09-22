import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  BodyMeasurementSessionListSchema,
  CorrectBodyMeasurementSessionSchema,
  CorrectDailyContextNoteSchema,
  CorrectMealSchema,
  CorrectRecoveryObservationSchema,
  CorrectWeightMeasurementSchema,
  CorrectWorkoutSessionSchema,
  CreateBodyMeasurementSessionSchema,
  CreateDailyContextNoteSchema,
  CreateDailyRecommendationFeedbackSchema,
  CreateMealSchema,
  CreateRecoveryObservationSchema,
  CreateWeightMeasurementSchema,
  CreateWorkoutSessionSchema,
  CurrentRecoveryContextResultSchema,
  DailyContextNoteListSchema,
  DailyAssessmentResultSchema,
  DailyRecommendationFeedbackSchema,
  DailyRecommendationCompletionAssessmentSchema,
  ReadDailyRecommendationCompletionSchema,
  DailyProjectionQuerySchema,
  DailyProjectionSchema,
  ListDailyContextNotesQuerySchema,
  ListBodyMeasurementSessionsQuerySchema,
  ListMealsQuerySchema,
  ListRecoveryObservationsQuerySchema,
  ListWeightMeasurementsQuerySchema,
  ListWorkoutSessionsQuerySchema,
  MealListSchema,
  PersonPreferencesSchema,
  RecoveryObservationListSchema,
  SaveConfirmedTrainingProgramResultSchema,
  SaveConfirmedTrainingProgramSchema,
  TrainingContextQuerySchema,
  TrainingContextSchema,
  TrainingProgramSchema,
  UpdatePersonPreferencesSchema,
  WeightMeasurementListSchema,
  WorkoutSessionListSchema,
  type CorrectBodyMeasurementSession,
  type CorrectDailyContextNote,
  type CorrectMeal,
  type CorrectRecoveryObservation,
  type CorrectWeightMeasurement,
  type CorrectWorkoutSession,
  type CreateBodyMeasurementSession,
  type CreateDailyContextNote,
  type CreateDailyRecommendationFeedback,
  type CreateMeal,
  type CreateRecoveryObservation,
  type CreateWeightMeasurement,
  type CreateWorkoutSession,
  type DailyRecommendationCompletionAssessment,
  type ReadDailyRecommendationCompletion,
  type DailyProjectionQuery,
  type ListDailyContextNotesQuery,
  type ListBodyMeasurementSessionsQuery,
  type ListMealsQuery,
  type ListRecoveryObservationsQuery,
  type ListWeightMeasurementsQuery,
  type ListWorkoutSessionsQuery,
  type UpdatePersonPreferences,
  type SaveConfirmedTrainingProgram,
  type TrainingContextQuery,
} from "@shape-of-you/contracts";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";

import type { RequestPersonContext } from "../application/person-context.js";
import type { BodyMeasurementSessionService } from "../body-measurement-sessions/body-measurement-session.service.js";
import type { NutritionService } from "../nutrition/nutrition.service.js";
import type { RecoveryService } from "../recovery/recovery.service.js";
import type { TrainingService } from "../training/training.service.js";
import type { WeightMeasurementService } from "../weight-measurements/weight-measurement.service.js";
import type { DailyContextNoteService } from "../daily-context-notes/daily-context-note.service.js";
import type { DailyProjectionService } from "../daily-projections/daily-projection.service.js";
import type { DailyAssessmentService } from "../coaching/daily-assessment.service.js";
import type { DailyAssessmentCoachContext } from "../coaching/daily-assessment.service.js";
import type { CurrentRecoveryContextService } from "../coaching/current-recovery-context.service.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import {
  MCP_BODY_MEASUREMENT_WRITE_SCOPE,
  MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
  MCP_DAILY_RECOMMENDATION_FEEDBACK_WRITE_SCOPE,
  MCP_MEAL_WRITE_SCOPE,
  MCP_PERSON_TIMEZONE_WRITE_SCOPE,
  MCP_READ_SCOPE,
  MCP_RECOVERY_WRITE_SCOPE,
  MCP_WEIGHT_WRITE_SCOPE,
  MCP_WORKOUT_WRITE_SCOPE,
  McpAuthorizationError,
  type McpAuthorizationBoundary,
  type McpOAuthErrorCode
} from "./oauth.js";

interface McpServices {
  readonly weights: Pick<WeightMeasurementService, "list" | "create" | "correct">;
  readonly bodyMeasurements: Pick<BodyMeasurementSessionService, "list" | "create" | "correct">;
  readonly nutrition: Pick<NutritionService, "listMeals" | "createMeal" | "correctMeal">;
  readonly training: Pick<
    TrainingService,
    | "listWorkoutSessions"
    | "createWorkoutSession"
    | "correctWorkoutSession"
    | "findActiveProgram"
    | "saveConfirmedProgram"
    | "getTrainingContext"
  >;
  readonly recovery: Pick<RecoveryService, "listObservations" | "createObservation" | "correctObservation">;
  readonly dailyContextNotes: Pick<DailyContextNoteService, "list" | "create" | "correct">;
  readonly dailyProjection: Pick<DailyProjectionService, "projection">;
  readonly dailyAssessment?: Pick<
    DailyAssessmentService,
    "read" | "readCoachContext" | "readCompletion" | "updatePreferences" | "recordFeedback"
  >;
  readonly currentRecoveryContext: Pick<CurrentRecoveryContextService, "read">;
}

/** Dependencies required by the API-owned stateless MCP transport adapter. */
export interface McpRouteOptions {
  readonly fastify: FastifyInstance;
  readonly issuer: string;
  readonly resource: string;
  readonly authorizer: McpAuthorizationBoundary;
  readonly personContext: RequestPersonContext;
  readonly services: McpServices;
}

interface ToolDefinition {
  readonly tool: OAuthProtectedTool;
  readonly validate: ValidateFunction;
  readonly scope: string;
  readonly write: boolean;
  readonly execute: (input: Record<string, unknown>) => Promise<unknown>;
  readonly present?: (value: unknown) => string;
  readonly structured?: (value: unknown) => unknown;
}

interface DailyProjectionCompatibilityResult {
  readonly projection: unknown;
  readonly query: DailyProjectionQuery;
  readonly assessmentContext: DailyAssessmentCoachContext | null;
}

class ConnectorInputError extends Error {}

interface OAuthSecurityScheme {
  readonly type: "oauth2";
  readonly scopes: readonly string[];
}

type OAuthProtectedTool = Tool & {
  readonly securitySchemes: readonly OAuthSecurityScheme[];
};

/** Natural routine replies used to demonstrate the Coach voice to MCP clients. */
export const MCP_ROUTINE_COACH_RESPONSE_EXAMPLES = [
  "Записал чечевичный суп, говядину в перечном соусе, салат и вишнёвый сок; пенне не учитывал.",
  "По фото оценил ужин примерно в 670 ккал: около 44 г белка, 29 г жиров и 59 г углеводов. Мясо даёт хороший белок, а большую часть углеводов здесь набирает пюре.",
  "Записал ужин: лосось, кукурузу, овощи, ягоды и бокал вина. Хороший набор белка и овощей; после вина сегодня лучше перейти на воду и оставить вечер спокойным.",
  "Записал сон 7 ч 54 мин, оценку 86, HRV 48 мс, ночной пульс 59, дыхание 13,8, SpO₂ 95% и температуру без отклонения. Восстановление выглядит неплохо; сегодня можно держать обычный темп и свериться с самочувствием перед тренировкой."
] as const;

/** Current Coach behavior delivered with every successful MCP result. */
export const MCP_COACH_REPLY_POLICY =
  "COACH RESPONSE: Always use the user's language, sound like a real coach, and keep implementation mechanics invisible. " +
  "For every meaningful nutrition, training, recovery, body, or daily-summary interaction, one useful evidence-grounded observation and one concrete next step are mandatory. " +
  "Never ask whether the user wants you to record, correct, estimate, analyze, or provide an obvious next step when a direct unambiguous report already authorizes the routine low-risk action; perform the action instead. " +
  "Keep planned facts, proposed guidance, and verified completed facts distinct. Use the structured completion assessment for completion claims; neither it nor manual feedback creates an owning-domain fact.";

/** Mandatory ending delivered last in every successful MCP result. */
export const MCP_COACH_FINAL_RESPONSE_REQUIREMENT =
  "MANDATORY FINAL REPLY: Unless the user explicitly requested raw facts only, the final user-facing reply MUST include one useful evidence-grounded observation and MUST end with one direct, concrete recommendation or next step. " +
  "A reply that only confirms, records, calculates, or summarizes facts is incomplete. " +
  "If a domain-specific recommendation cannot be made safely, end with the safest useful next action supported by the verified facts or the one observation the user should provide next; never silently omit the next step.";

const routineCoachReplyShape =
  "For a routine capture, correction, or short factual answer, reply in one to three natural sentences.";

const dailyCoachReplyShape =
  "For a full Daily Coach answer, use the requested brief structure without a sentence limit.";

const coachFailurePolicy =
  "Do not claim that an unverified read or failed change succeeded. Keep implementation mechanics invisible, do not repeat an obvious permission question, and do not base guidance on unavailable or unverified facts.";

function coachResultContent(
  instruction: string,
  replyShape = routineCoachReplyShape
): string {
  return `${MCP_COACH_REPLY_POLICY} ${instruction} ${replyShape} ${MCP_COACH_FINAL_RESPONSE_REQUIREMENT}`;
}

function coachFailureResultContent(instruction: string): string {
  return `${instruction} ${coachFailurePolicy}`;
}

const routineReadResultContent = coachResultContent(
  "Use these current facts silently and answer the user's actual request."
);

const routineWriteResultContent = coachResultContent(
  "The directly reported routine fact has been saved. Complete the required owning-domain read-back silently before claiming success."
);

const mealWriteResultContent = coachResultContent(
  "The reported meal has been saved. Continue the required workflow silently before replying. " +
  "In the final reply, acknowledge what was eaten, interpret the approximate nutrition, and give one concrete useful next step. " +
  "When saved portions or nutrients are estimates, use them and clearly speak approximately rather than claiming measured precision. " +
  "Do not say calories are unavailable merely because exact grams were not measured."
);

const mealCorrectionWriteResultContent = coachResultContent(
  "The Meal correction has been committed. The returned structured Meal is the canonical transaction result and sufficient typed verification of this write. " +
  "Do not call list_meals solely to prove that this correction succeeded, and never retract this success because a later optional read is unavailable. " +
  "Use list_meals only when the user also requested the updated day collection or totals. Acknowledge the persisted correction naturally without exposing internal mechanics."
);

const mealReadResultContent = coachResultContent(
  "Use these meal facts silently. Acknowledge what was eaten, interpret the nutrition, and give one concrete useful next step. " +
  "Use stored estimates as approximate values rather than hiding them because exact grams were not measured. " +
  "Only when the user's unambiguous Meal correction is still pending and no successful correction result has been returned for it, select the current matching Meal from this result, preserve its complete canonical fields and items, overlay only the user's clarification, and immediately perform the correction with that current id. " +
  "If a successful correction result was already returned, this optional day or totals read must not reapply that correction. Do not ask the user to repeat or confirm the correction."
);

const workoutWriteResultContent = coachResultContent(
  "The reported workout has been saved. Complete the required date-scoped read-back silently before replying. " +
  "Acknowledge the completed work, interpret it against available training and recovery evidence, and give one concrete useful next step."
);

const workoutReadResultContent = coachResultContent(
  "Use these workout facts silently. Acknowledge the completed work, interpret it against available training and recovery evidence, and give one concrete useful next step."
);

const recoveryWriteResultContent = coachResultContent(
  "The reported recovery fact has been saved. Continue capturing every other independent fact from the same report " +
  "before replying, even if one separate fact could not be saved. Then complete the required day-level check silently. " +
  "Briefly acknowledge the useful recovery picture, interpret it, and give one concrete useful next step without inventing values."
);

const recoveryReadResultContent = coachResultContent(
  "Use these recovery facts silently. Summarize and interpret the useful recovery picture, then give one concrete useful next step without inventing values."
);

const currentRecoveryContextResultContent = coachResultContent(
  "Use the typed observations as the only authority for health values. Use syncState, targetDateDelivery, and metricDelivery only to explain availability; never compare timestamps yourself or let delivery status change a health assessment. " +
  "A retained_unconfirmed value is a previously saved local value whose freshness has not yet been confirmed by the current OAuth consent generation. Never present it as current, and do not infer whether reconnect, migration, or another delivery transition caused the unconfirmed state. A confirmed_absent metric was not delivered in the normalized current-consent record; this is not zero and does not prove a cause. A confirmed_present metric is current-consent delivery evidence. " +
  "For steps with periodState partial_day, always call the value intermediate or accumulated as of the exact asOf time. Never call it a final, complete, or end-of-day total and never use a low partial value as evidence of low daily activity. " +
  "For fresh_success with record_without_supported_facts, say the connected-data check succeeded but the source has not supplied supported values for today. For unknown delivery, say only that delivery for today is not established; never claim the successful request covered that date. For failed, say the latest synchronization failed and current data is unknown. For stale_success or never_checked, do not claim current freshness or absence. " +
  "Never attribute missing values to Garmin, Intervals.icu, the watch, sleep, travel, or user action unless a typed fact proves it. Never turn an absent field into zero. Never promise to check again later unless an automation was actually created; you may say that you will check again when the user asks. If timezone is required and the user supplied an unambiguous current timezone or location, call set_current_timezone and retry get_current_recovery_context in the same turn."
);

const activeTrainingProgramResultContent = coachResultContent(
  "Use only an active result as a planned training artifact. An absent result means no active program; an error does not."
);

const trainingContextResultContent = coachResultContent(
  "Use an active program as planned authority. Keep detailed completed sessions separate from connected activity summaries. A connected summary confirms the activity and load shown but never supplies exercises or sets. When the program is absent, historical evidence is proposal input only and must never be presented as an existing plan."
);

const dailyAssessmentGuidance =
  "Treat this API-owned daily assessment as the sole decision authority: preserve and explain its exact status, reasons, missing data, limitations, confidence, movement context, and single recommended next action. Do not recalculate, replace, or embellish the policy decision. Do not add a duration, intensity, workout, medical rationale, trend, or substitute action that the result did not return. Completion is a separate exact-snapshot read and never changes this assessment. Call it only when the outcome can change the useful reply: an explicit progress question, a verified owning-domain fact relevant to the known current action, a reused current snapshot whose outcome matters, or the bounded previous recommendation candidate in a full today brief. Never perform background completion discovery for unrelated routine conversation. If timezone is required and the user has explicitly provided an unambiguous current timezone or location, call set_current_timezone and retry this read in the same turn. Otherwise ask one natural location clarification. Never construct a fallback recommendation.";

function dailyAssessmentCoachContent(context: DailyAssessmentCoachContext): string {
  if (context.previousRecommendation === null) {
    return coachResultContent(
      `${dailyAssessmentGuidance} NO PREVIOUS RECOMMENDATION CANDIDATE: Do not call completion for a previous recommendation and do not search older dates.`,
      dailyCoachReplyShape
    );
  }
  return coachResultContent(
    `${dailyAssessmentGuidance} PREVIOUS RECOMMENDATION CANDIDATE (internal exact server-owned reference; never expose identifiers or field names): ${JSON.stringify(context.previousRecommendation)} Use it only for a brief previous-day retrospective in this full today answer. Call get_daily_recommendation_completion with exactly this snapshotId; never combine its result with another date or action.`,
    dailyCoachReplyShape
  );
}

const dailyRecommendationFeedbackResultContent = coachResultContent(
  "The user's explicit typed response to the exact daily recommendation snapshot was recorded. A completed status is feedback evidence only: do not create or imply a WorkoutSession, Meal, RecoveryObservation, or other owning-domain fact, and do not claim that policy or future recommendations changed."
);

function dailyRecommendationCompletionResultContent(value: unknown): string {
  const result = value as DailyRecommendationCompletionAssessment;
  const base =
    "Use this immutable typed conclusion only for its exact recommendation snapshot. Pair it with the action and local date from the same server-owned recommendation context; never transfer it to another snapshot, date, or action. Never create, overwrite, or imply a new owning-domain fact from this Coaching conclusion. ";
  if (result.limitations.includes("self_report_conflicts_with_observation")) {
    return coachResultContent(
      base +
      "The active user report and automatic observation conflict. State both naturally and preserve honest uncertainty; do not choose one as hidden truth. Ask one clarification only if resolving the conflict changes the useful next step."
    );
  }
  switch (result.evidenceMode) {
    case "observed":
      return coachResultContent(
        base +
        "Reliable domain evidence confirms the recommendation outcome. Briefly acknowledge the confirmed result and do not ask whether the user completed it."
      );
    case "self_reported":
      return coachResultContent(
        base +
        "This conclusion comes from the active explicit user report after append-only corrections. Attribute it to the user rather than presenting it as an owning-domain observation, and do not repeat superseded reports."
      );
    case "partially_observed":
      return coachResultContent(
        base +
        "Explain which criterion is confirmed and which part remains partial, stale, unknown, unlinked, or dependent on self-report. Do not promote partial evidence to completion. Ask only if the missing information materially changes the useful answer."
      );
    case "unknown":
      return coachResultContent(
        base +
        "Evidence is insufficient. Unknown is neither completed nor not completed. Usually omit the outcome; explain the uncertainty or ask one question only when the answer materially changes the useful next step."
      );
  }
}

const timezoneWriteResultContent = coachResultContent(
  "The user's current IANA timezone was saved from their explicit context. Immediately retry the authoritative read that required it: get_daily_assessment for a Daily Coach request or get_current_recovery_context for a focused current Recovery request. Do not expose the timezone identifier unless the user asked for it, and do not claim a daily recommendation until get_daily_assessment succeeds."
);

const setCurrentTimezoneInputSchema = {
  $id: "SetCurrentTimezoneInput",
  type: "object",
  additionalProperties: false,
  required: ["timezone"],
  properties: {
    timezone: UpdatePersonPreferencesSchema.properties.timezone
  }
} as const;

const trainingProgramConfirmationPolicy =
  "TRAINING PROGRAM CONFIRMATION: A complete program supplied by the user together with an unambiguous request such as «используй эту программу» or «сохрани как активную» is sufficient authority to persist it immediately; do not ask for another confirmation. " +
  "For a complete program proposed by Coach, bind acceptance only to the latest complete version that Coach published and offered for activation. Short natural replies such as «да» or yes, «го» or go ahead, «подходит» or works for me, «делаем так» or let's do it, and a clear affirmative emoji directly answering the save question are examples of valid acceptance; they are not magic phrases. " +
  "Praise without acceptance, a question, doubt, an alternative, a partial edit such as «да, но замени...», a reply to an unrelated yes/no question, or a reply after another program version does not confirm the program. Publish a fully revised snapshot after an edit and never invent missing exercises, order, loads, or progression. " +
  "When Coach publishes a complete version without already having authority to save it, end that same message with exactly one short question equivalent to «Сохраняю эту программу как активную?» in the user's language. Use the same one-question form whenever the later reference is genuinely ambiguous. Until persistence and a matching active read-back succeed, label every such program only Proposed now and never call it agreed, active, current, or our plan. " +
  "After unambiguous acceptance, call save_confirmed_training_program and then get_training_context in the same turn, comparing the entire active snapshot with the accepted version before claiming success.";

function confirmedTrainingProgramWriteResultContent(result: unknown): string {
  if (isRecord(result) && result.outcome === "needs_clarification") {
    return coachFailureResultContent(
      "TRAINING PROGRAM NOT SAVED: Exact exercise resolution found more than one accessible candidate. Ask exactly one short natural question that distinguishes only the first unresolved exercise using its safe name, category, movement pattern, or equipment. Never show ids, tool names, fields, or catalog mechanics. Retain the complete accepted program in conversation context; after the answer, replace only that exercise with the selected internal version reference and retry the whole snapshot without asking the user to repeat the program or confirm every other exercise. Keep the program Proposed now until a later matching active read-back succeeds."
    );
  }
  return coachResultContent(
    "The accepted program snapshot and any missing Person-private exercises were persisted atomically. MUST immediately call get_training_context in this same turn and compare the complete active snapshot with the accepted version before claiming success. If verification fails or differs, say only that saving could not be verified and do not present it as agreed, current, active, or the user's plan."
  );
}

const dailyProjectionResultContent =
  "FACTUAL-ONLY DAILY PROJECTION: Use this exact-date projection only to summarize recorded owning-domain facts. " +
  "It cannot authorize a daily status, confidence, reasons, limitations, or next action. " +
  "If the user requested a daily decision and no matching API-owned daily assessment is included, state that the assessment is unavailable for this date and stop. " +
  "Do not provide a nutrition, training, recovery, medical, or other recommendation from the projection, other reads, or conversation context.";

const unavailableProjectionAssessmentContent =
  "API-OWNED DAILY ASSESSMENT UNAVAILABLE: Keep the returned projection factual-only. " +
  "If the user requested a daily decision, say that the current assessment could not be obtained and ask them only to retry the assessment later. " +
  "Do not derive a status or propose any nutrition, training, recovery, medical, or other next action from the projection, other reads, or conversation context.";

function dailyProjectionCompatibilityContent(
  result: DailyProjectionCompatibilityResult
): string {
  const { assessmentContext, query } = result;
  if (assessmentContext === null) {
    return unavailableProjectionAssessmentContent;
  }
  const { assessment } = assessmentContext;
  if (assessment.state === "available" && (
    assessment.localDate !== query.localDate || assessment.timezone !== query.timezone
  )) {
    return dailyProjectionResultContent;
  }
  return `API-OWNED DAILY ASSESSMENT RESULT (exact JSON; preserve every decision field): ${JSON.stringify(assessment)} ${dailyAssessmentCoachContent(assessmentContext)}`;
}

/** Durable operational policy published by the API-owned MCP server. */
export const MCP_OPERATIONAL_INSTRUCTIONS =
  "Shape of You PostgreSQL is authority. Full Daily Coach, day-status, and today's-next-action requests MUST call get_daily_assessment first; use it as the sole decision authority or fail closed. " +
  "Keep internal mechanics invisible in user-facing replies. " +
  MCP_COACH_REPLY_POLICY + " " + routineCoachReplyShape + " " + dailyCoachReplyShape + " " + MCP_COACH_FINAL_RESPONSE_REQUIREMENT + " " +
  "This MCP is the only interactive writer. Keep tool, schema, status, identifier, storage, API, and implementation details out of user-facing replies. " +
  "After a routine fact capture or correction, acknowledge the fact and never invent precision. " +
  "The Google Sheets Fitness Tracker is a non-authoritative read-only legacy reference: never use it as current truth, a write target, or a fallback. " +
  "Use only the authorized Person-scoped typed tools. A direct relevant user report authorizes one routine low-risk idempotent create or correction without a duplicate confirmation question. Always require a typed owning-domain result before claiming success and fail closed when MCP authorization or a required tool is unavailable or inconsistent. " +
  "A routine create does not require a pre-read. Before a Meal correction, call list_meals with localDate only, select the current Meal, preserve the complete canonical snapshot, and overlay the user's clarification before calling correct_meal. A successful correct_meal result already contains the committed canonical Meal and is sufficient typed verification; do not perform another list solely to prove success. After a Meal create, call list_meals with localDate only for read-back. Never pass timezone or write fields to list_meals. " +
  "Never ask whether the user wants you to record, correct, estimate, analyze, or provide an obvious next step when their direct unambiguous report already authorizes the routine low-risk action; perform it instead. " +
  "For Workout capture, a direct report of performed exercises or sets, or a clear signal that the workout is finished, authorizes immediate recording of the session from the current message and accumulated conversation context. Do not ask whether to record it and do not make the user restate the workout. Use the active TrainingProgram typed read when exact exercise version references are needed, preserve genuinely unknown optional set values, then call list_workout_sessions with localDate for read-back. Ask only when the performed exercise or set itself is genuinely ambiguous. " +
  "Outside a full Daily Coach assessment, before focused training or recovery advice, read the composed training context. Only its active program is planned authority. Use recent connected activities, including imported runs, without asking the user to send a screenshot or repeat an already imported fact. A connected activity summary does not contain exercises or sets: never invent those details or automatically record it as a WorkoutSession. If a connected activity and a detailed session may describe the same physical event, do not count both as separate training without sufficient identity evidence. If no active program exists, use recent completed sessions and connected activities only as evidence for a clearly proposed program and never activate or describe that reconstruction as planned. " +
  trainingProgramConfirmationPolicy + " " +
  "For a Recovery text or screenshot report, record every unambiguous sleep and metric fact as an independent observation with a deterministic dedupe key, then call list_recovery_observations with localDate only to verify the expected set. Continue with the other independent facts if one fact fails. A wearable sleep score uses metric sleep_score with unit score; never put a 0..100 device score into the subjective 1..5 sleepQuality field. When no real interval is known, use exact localDate and timezone without inventing timestamps. " +
  "For a focused question about today's sleep, HRV, resting heart rate, Body Battery, or steps, call get_current_recovery_context. Treat its typed observations as value authority and its delivery state only as availability evidence. Never infer that Garmin or another provider failed from an empty observation set, never infer zero from absence, and never promise a later autonomous recheck without a real automation. " +
  "For a full Daily Coach assessment, preserve the assessment status, reasons, missing data, limitations, confidence, and single recommended action. Never reconstruct or alter that decision from get_daily_projection, other typed reads, or conversation context. Do not add any nutrition, training, or recovery proposal beyond actions returned by the assessment. For a factual day record that does not ask for a status or next action, require an exact local date and IANA timezone and use get_daily_projection without turning it into a decision. " +
  "Use recommendation completion contextually, never on every response. Call get_daily_recommendation_completion only for an exact known snapshot when an explicit progress question, a newly verified relevant owner fact, a reused current recommendation, or the bounded previous-day candidate makes the outcome useful. Never call get_daily_assessment merely to discover completion during unrelated routine capture. If the daily result provides no previous candidate, do not call completion for a previous recommendation and do not search older dates. Keep each completion paired with the action and local date from the same snapshot. Reliable observed completion suppresses did-you-complete-it questions; partial evidence names what is confirmed and missing; unknown is not failure; active self-reported corrections are attributed to the user; conflicts preserve both claims and honest uncertainty. Ask manually only when the answer changes the useful next step. " +
  "When the user explicitly says the displayed daily recommendation was accepted, completed, skipped, too heavy, or unsuitable, immediately call record_daily_recommendation_feedback with that exact assessment snapshotId and one typed status. A free-text comment may only supplement the status. Never infer feedback from silence or unrelated behavior, never translate completed feedback into an owning-domain fact, and never claim that feedback automatically changed policy or future recommendations. " +
  "When get_daily_assessment requires timezone, use set_current_timezone only from an explicit unambiguous statement about the user's current timezone or location, then retry the assessment in the same turn. Ask one natural clarification if the location is ambiguous. Never guess silently or expose a technical setup task. " +
  "Outside a full Daily Coach assessment, present Planned, Proposed now, and Actually completed separately: only typed plan artifacts such as the active TrainingProgram are planned, conversation advice is proposed, and only owning-domain facts verified by typed reads are completed; an accepted recommendation is not executed. " +
  "Outside a full Daily Coach assessment, give one clear Next step plus at most one bounded nutrition, training, and recovery proposal grounded in available evidence, and state missing evidence instead of inventing a plan. " +
  "For get_active_training_program, only status absent proves that no active program exists; a tool error leaves the plan unknown and must not be treated as absent. " +
  "If a required typed read fails, is unavailable, or returns incomplete or inconsistent data, label the affected field unknown: never infer absence, zero, no plan, or another dependent fact, and omit or explicitly qualify dependent proposals. " +
  "Preserve genuinely unknown optional values as null or partial inside typed data instead of inventing measured precision. For Meal items, use amountKind unknown only when available evidence is genuinely insufficient for a reasonable estimate, described for the user's own non-numeric wording, quantified for an explicit number and unit, and estimated for a best-effort text or photo estimate with method and confidence; never invent 1 serving or another sentinel amount. A sufficiently legible meal photo or useful text description authorizes and requires an immediate best-effort estimate of each identifiable item's quantity plus calories, protein, fat, and carbohydrates. Exact grams are not a prerequisite: use bounded confidence, save the approximate nutrition now, and let later user detail correct it. Ask only when material foods or scale are genuinely ambiguous. Use a typed DailyContextNote only when a relevant observation cannot yet be represented safely in its owning domain. " +
  "After a routine Meal create or correction, say naturally what was recorded or corrected, state approximate calories or macros when estimated values were saved, and give one concrete useful evidence-grounded next step by default. Do not ask for duplicate confirmation before a reasonable estimate. Never expose tool names, arguments, identifiers, property or enum names, null, partial, typed, read-back, transport details, or implementation status. Do not force Planned, Proposed now, or Actually completed headings onto a routine fact capture; reserve that structure for a full daily-plan answer. Natural reply examples: " +
  MCP_ROUTINE_COACH_RESPONSE_EXAMPLES.map((example) => `\"${example}\"`).join(" ") +
  " " +
  "Format user-facing answers as plain Markdown and never emit HTML entities or encoded whitespace. Destructive, credential, administrative, and material goal or program changes still require explicit confirmation.";

const toolAuthorityInstruction =
  "PostgreSQL authority; no Google Sheets fallback. Fail closed if this tool or its authorization is unavailable. Do not ask an obvious permission question before an unambiguous routine low-risk action, and give proactive evidence-grounded coaching by default.";

const createWeightMeasurementToolInputSchema = connectorWeightSchema(
  "CreateWeightMeasurementToolInput",
  CreateWeightMeasurementSchema
);
const correctWeightMeasurementToolInputSchema = connectorWeightSchema(
  "CorrectWeightMeasurementToolInputBody",
  CorrectWeightMeasurementSchema
);
const createWorkoutSessionToolInputSchema = connectorWorkoutSchema(
  "CreateWorkoutSessionToolInput",
  CreateWorkoutSessionSchema
);
const correctWorkoutSessionToolInputSchema = connectorWorkoutSchema(
  "CorrectWorkoutSessionToolInputBody",
  CorrectWorkoutSessionSchema
);
const createMealToolInputSchema = connectorMealSchema(
  "CreateMealToolInput",
  CreateMealSchema
);
const correctMealToolInputSchema = connectorMealSchema(
  "CorrectMealToolInputBody",
  CorrectMealSchema
);
const createRecoveryObservationToolInputSchema = connectorRecoverySchema(
  "CreateRecoveryObservationToolInput",
  CreateRecoveryObservationSchema
);
const correctRecoveryObservationToolInputSchema = connectorRecoverySchema(
  "CorrectRecoveryObservationToolInputBody",
  CorrectRecoveryObservationSchema
);
const validateCreateWeightMeasurement = compile(CreateWeightMeasurementSchema);
const validateCorrectWeightMeasurement = compile(CorrectWeightMeasurementSchema);
const validateCreateMeal = compile(CreateMealSchema);
const validateCorrectMeal = compile(CorrectMealSchema);
const validateCreateRecoveryObservation = compile(CreateRecoveryObservationSchema);
const validateCorrectRecoveryObservation = compile(CorrectRecoveryObservationSchema);
const validateCreateWorkoutSession = compile(CreateWorkoutSessionSchema);
const validateCorrectWorkoutSession = compile(CorrectWorkoutSessionSchema);

const ActiveTrainingProgramResultSchema = {
  $id: "ActiveTrainingProgramResult",
  type: "object",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "program"],
      properties: {
        status: { const: "active" },
        program: TrainingProgramSchema
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["status", "program"],
      properties: {
        status: { const: "absent" },
        program: { type: "null" }
      }
    }
  ]
} as const;

/** Registers protected-resource metadata and the stateless Streamable HTTP endpoint. */
export function registerMcpRoutes(options: McpRouteOptions): void {
  const metadataUrl = protectedResourceMetadataUrl(options.resource);

  options.fastify.get("/.well-known/oauth-protected-resource", async () => ({
    resource: options.resource,
    authorization_servers: [options.issuer],
    scopes_supported: [
      MCP_READ_SCOPE,
      MCP_WEIGHT_WRITE_SCOPE,
      MCP_BODY_MEASUREMENT_WRITE_SCOPE,
      MCP_MEAL_WRITE_SCOPE,
      MCP_WORKOUT_WRITE_SCOPE,
      MCP_RECOVERY_WRITE_SCOPE,
      MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
      MCP_DAILY_RECOMMENDATION_FEEDBACK_WRITE_SCOPE,
      MCP_PERSON_TIMEZONE_WRITE_SCOPE
    ],
    bearer_methods_supported: ["header"]
  }));

  options.fastify.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: async (request, reply) => {
      const server = createServer(request, options, metadataUrl);
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      reply.hijack();
      try {
        await server.connect(transport as Transport);
        await transport.handleRequest(request.raw, reply.raw, request.body);
      } finally {
        await server.close();
      }
    }
  });
}

function createServer(
  request: FastifyRequest,
  options: McpRouteOptions,
  metadataUrl: string
): Server {
  const server = new Server(
    { name: "shape-of-you-api", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: MCP_OPERATIONAL_INSTRUCTIONS
    }
  );
  const tools = createTools(options.services);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((definition) => definition.tool)
  }));
  server.setRequestHandler(CallToolRequestSchema, async (call) => {
    const definition = tools.find(({ tool }) => tool.name === call.params.name);
    if (!definition) {
      return errorResult(coachFailureResultContent(
        "The requested action is unavailable. Say this naturally without naming internal components."
      ));
    }
    if (!definition.validate(call.params.arguments ?? {})) {
      return inputErrorResult(definition.tool.name);
    }

    try {
      const authorized = await options.authorizer.authorize(
        request.headers.authorization,
        definition.scope,
        definition.write
      );
      const result = await options.personContext.run(authorized.personId, () =>
        definition.execute((call.params.arguments ?? {}) as Record<string, unknown>)
      );
      return successResult(
        definition.structured?.(result) ?? result,
        definition.present?.(result)
      );
    } catch (error) {
      if (error instanceof McpAuthorizationError) {
        return authorizationErrorResult(
          error.message,
          error.oauthError,
          metadataUrl,
          definition.scope
        );
      }
      if (error instanceof ConnectorInputError) {
        return inputErrorResult(definition.tool.name);
      }
      if (
        definition.tool.name === "correct_meal" &&
        (error instanceof ConflictError || error instanceof NotFoundError)
      ) {
        return mealCorrectionErrorResult("stale_or_missing_target");
      }
      if (definition.tool.name === "correct_meal") {
        return mealCorrectionErrorResult("retryable_failure");
      }
      if (
        definition.tool.name === "save_confirmed_training_program" &&
        (error instanceof ConflictError || error instanceof NotFoundError)
      ) {
        return trainingProgramSaveErrorResult("stale_active_program");
      }
      if (definition.tool.name === "save_confirmed_training_program") {
        return trainingProgramSaveErrorResult("retryable_failure");
      }
      return errorResult(coachFailureResultContent(
        definition.write
          ? "The requested fact was not saved. Say this briefly and naturally without blaming the user."
          : "The requested current facts could not be retrieved. Say this briefly and naturally without blaming the user."
      ));
    }
  });
  return server;
}

function createTools(services: McpServices): readonly ToolDefinition[] {
  return [
    defineTool(
      "list_weight_measurements",
      "Read the authorized person's current weight measurements.",
      ListWeightMeasurementsQuerySchema,
      WeightMeasurementListSchema,
      false,
      MCP_READ_SCOPE,
      (input) => services.weights.list(input as ListWeightMeasurementsQuery)
    ),
    defineTool(
      "record_weight_measurement",
      "Record one idempotent weight measurement from a direct user report; follow with typed read-back.",
      createWeightMeasurementToolInputSchema,
      undefined,
      true,
      MCP_WEIGHT_WRITE_SCOPE,
      async (input) => (await services.weights.create(
        normalizeWeightInput(input, validateCreateWeightMeasurement) as CreateWeightMeasurement
      )).measurement
    ),
    defineTool(
      "correct_weight_measurement",
      "Append one idempotent correction to a uniquely identified current weight measurement; follow with typed read-back.",
      withIdSchema(
        "CorrectWeightMeasurementToolInput",
        correctWeightMeasurementToolInputSchema
      ),
      undefined,
      true,
      MCP_WEIGHT_WRITE_SCOPE,
      async (input) => (await services.weights.correct(
        input.id as string,
        normalizeWeightInput(
          input,
          validateCorrectWeightMeasurement
        ) as CorrectWeightMeasurement
      )).measurement
    ),
    defineTool(
      "list_body_measurements",
      "Read the authorized person's current body measurement sessions.",
      ListBodyMeasurementSessionsQuerySchema,
      BodyMeasurementSessionListSchema,
      false,
      MCP_READ_SCOPE,
      (input) =>
        services.bodyMeasurements.list(input as ListBodyMeasurementSessionsQuery)
    ),
    defineTool(
      "record_body_measurements",
      "Record one idempotent body measurement session from a direct user report; follow with typed read-back.",
      CreateBodyMeasurementSessionSchema,
      undefined,
      true,
      MCP_BODY_MEASUREMENT_WRITE_SCOPE,
      async (input) =>
        (await services.bodyMeasurements.create(input as CreateBodyMeasurementSession)).session
    ),
    defineTool(
      "correct_body_measurements",
      "Append one idempotent correction to a uniquely identified body measurement session; follow with typed read-back.",
      withIdSchema("CorrectBodyMeasurementsToolInput", CorrectBodyMeasurementSessionSchema),
      undefined,
      true,
      MCP_BODY_MEASUREMENT_WRITE_SCOPE,
      async (input) => (await services.bodyMeasurements.correct(input.id as string, input as unknown as CorrectBodyMeasurementSession)).session
    ),
    defineTool(
      "list_meals",
      "Read the authorized person's current meals. For one-day Meal read-back pass localDate only; timezone is not an accepted argument.",
      ListMealsQuerySchema,
      MealListSchema,
      false,
      MCP_READ_SCOPE,
      (input) => services.nutrition.listMeals(input as ListMealsQuery),
      () => mealReadResultContent
    ),
    defineTool(
      "record_meal",
      "Immediately record one idempotent Meal from a direct user report without a pre-read or duplicate confirmation. Every accepted Coach Meal item must include non-unknown amount evidence and numeric best-effort calories, protein, fat, and carbohydrates. For a sufficiently legible photo or useful text description, estimate realistic quantities using method and bounded confidence; exact grams are not required. If material food or scale is genuinely unidentifiable, clarify instead of saving an incomplete Meal, and never invent a sentinel serving. Then read back with list_meals using localDate only and reply in natural coach language with approximate nutrition and useful guidance without exposing contract fields or tool mechanics.",
      createMealToolInputSchema,
      undefined,
      true,
      MCP_MEAL_WRITE_SCOPE,
      async (input) => (await services.nutrition.createMeal(
        normalizeMealInput(input, validateCreateMeal) as CreateMeal
      )).meal,
      () => mealWriteResultContent
    ),
    defineTool(
      "correct_meal",
      "Immediately append one idempotent full-replacement correction to a uniquely identified current Meal without duplicate confirmation. Preserve or improve every item and provide non-unknown amount evidence plus numeric best-effort calories, protein, fat, and carbohydrates; do not replace a useful estimate with an incomplete Meal. The returned canonical Meal is sufficient typed verification; use a later date-scoped read only when the user also requested the updated day or totals, and never reapply an already successful correction. Reply in natural coach language without exposing contract fields or tool mechanics.",
      withIdSchema("CorrectMealToolInput", correctMealToolInputSchema),
      undefined,
      true,
      MCP_MEAL_WRITE_SCOPE,
      async (input) => (await services.nutrition.correctMeal(
        input.id as string,
        normalizeMealInput(input, validateCorrectMeal) as unknown as CorrectMeal
      )).meal,
      () => mealCorrectionWriteResultContent
    ),
    defineTool(
      "get_active_training_program",
      "Read the authorized person's active training program and exact exercise version references. A typed absent result proves that no active program exists; a tool error remains unknown.",
      emptyObjectSchema("GetActiveTrainingProgramInput"),
      ActiveTrainingProgramResultSchema,
      false,
      MCP_READ_SCOPE,
      async () => {
        try {
          return {
            status: "active",
            program: await services.training.findActiveProgram()
          };
        } catch (error) {
          if (error instanceof NotFoundError) {
            return { status: "absent", program: null };
          }
          throw error;
        }
      },
      () => activeTrainingProgramResultContent
    ),
    defineTool(
      "get_training_context",
      "Read the authorized person's active training authority together with separate bounded recent detailed sessions and connected activity summaries. Use imported activities without requesting a screenshot or manual repeat, never infer exercises or sets from a summary, and do not double-count a possible match. When the active program is absent, historical evidence remains proposal input and is never a plan.",
      TrainingContextQuerySchema,
      TrainingContextSchema,
      false,
      MCP_READ_SCOPE,
      (input) =>
        services.training.getTrainingContext(input as TrainingContextQuery),
      () => trainingContextResultContent
    ),
    defineTool(
      "save_confirmed_training_program",
      "Persist and activate one complete training-program snapshot. A complete user-supplied program plus an unambiguous request to use it is already authorized. For a Coach proposal, ordinary natural acceptance authorizes only the latest complete published version; never require a special phrase. Discussion, doubt, questions, alternatives, partial edits, and unrelated positive replies are not confirmation. For each exercise, send a known exact version id or an inline descriptor with the accepted exact name and only characteristics already known; use null for unknown characteristics and never invent them. The server exact-matches accessible exercises or creates a Person-private exercise, never substitutes a similar exercise and never publishes a new name to the shared catalog. Supply the active identity and lock from the preceding read, or both null only when absence was read. Repeated identical snapshots are safe. A typed ambiguity means nothing was saved: ask one short human question, retain the complete snapshot, and retry with the selected internal reference without exposing ids or requiring the program again. After success, call get_training_context in the same turn and compare the complete active snapshot before claiming it is saved, agreed, current, or active.",
      SaveConfirmedTrainingProgramSchema,
      SaveConfirmedTrainingProgramResultSchema,
      true,
      MCP_WORKOUT_WRITE_SCOPE,
      (input) =>
        services.training.saveConfirmedProgram(
          input as SaveConfirmedTrainingProgram
        ),
      confirmedTrainingProgramWriteResultContent
    ),
    defineTool(
      "list_workout_sessions",
      "Read the authorized person's current workout sessions. For one-day Workout read-back pass localDate.",
      ListWorkoutSessionsQuerySchema,
      WorkoutSessionListSchema,
      false,
      MCP_READ_SCOPE,
      (input) => services.training.listWorkoutSessions(input as ListWorkoutSessionsQuery),
      () => workoutReadResultContent
    ),
    defineTool(
      "record_workout_session",
      "Immediately record one idempotent workout session when the user directly reports performed exercises or sets, or clearly says the workout is finished. Assemble the session from the current message and accumulated conversation context; never ask whether to save it and never require the user to restate known work. Use get_active_training_program when exact exercise version references are needed, preserve genuinely unknown optional set values, then read back with list_workout_sessions using localDate and reply in natural coach language without exposing tool mechanics.",
      createWorkoutSessionToolInputSchema,
      undefined,
      true,
      MCP_WORKOUT_WRITE_SCOPE,
      async (input) =>
        (await services.training.createWorkoutSession(normalizeWorkoutInput(
          input,
          validateCreateWorkoutSession
        ) as CreateWorkoutSession)).session,
      () => workoutWriteResultContent
    ),
    defineTool(
      "correct_workout_session",
      "Immediately append one idempotent correction to a uniquely identified workout session when the user supplies a routine clarification. Do not ask for duplicate confirmation; follow with list_workout_sessions date-scoped read-back and reply in natural coach language without exposing tool mechanics.",
      withIdSchema(
        "CorrectWorkoutSessionToolInput",
        correctWorkoutSessionToolInputSchema
      ),
      undefined,
      true,
      MCP_WORKOUT_WRITE_SCOPE,
      async (input) => (await services.training.correctWorkoutSession(
        input.id as string,
        normalizeWorkoutInput(input, validateCorrectWorkoutSession) as unknown as CorrectWorkoutSession
      )).session,
      () => workoutWriteResultContent
    ),
    defineTool(
      "list_recovery_observations",
      "Read the authorized person's current raw recovery observations. For one-day set read-back pass localDate only.",
      ListRecoveryObservationsQuerySchema,
      RecoveryObservationListSchema,
      false,
      MCP_READ_SCOPE,
      (input) => services.recovery.listObservations(input as ListRecoveryObservationsQuery),
      () => recoveryReadResultContent
    ),
    defineTool(
      "get_current_recovery_context",
      "Read the authorized person's current Person-local Recovery observations together with provider-neutral connected-data freshness and target-date delivery state. Use this for focused questions about today's sleep, HRV, resting heart rate, Body Battery, or steps. Delivery state explains availability only and never changes a health decision.",
      emptyObjectSchema("GetCurrentRecoveryContextInput"),
      CurrentRecoveryContextResultSchema,
      false,
      MCP_READ_SCOPE,
      () => services.currentRecoveryContext.read(),
      () => currentRecoveryContextResultContent
    ),
    defineTool(
      "record_recovery_observation",
      "Immediately record one independent recovery fact from a direct text or screenshot report. The report is manual provenance even when the text or image displays Garmin or another wearable; never classify it as a direct device connection. Use sleep_score for a wearable 0..100 score, keep subjective sleepQuality at 1..5 only, continue other independent facts after an isolated failure, then read back the date-level set.",
      createRecoveryObservationToolInputSchema,
      undefined,
      true,
      MCP_RECOVERY_WRITE_SCOPE,
      async (input) =>
        (await services.recovery.createObservation(normalizeRecoveryInput(
          input,
          validateCreateRecoveryObservation
        ) as unknown as CreateRecoveryObservation)).observation,
      () => recoveryWriteResultContent
    ),
    defineTool(
      "correct_recovery_observation",
      "Append one idempotent correction to a uniquely identified recovery observation. Text and screenshot reports are manual provenance even when they display wearable data; then read back the date-level set without exposing internal mechanics.",
      withIdSchema("CorrectRecoveryObservationToolInput", correctRecoveryObservationToolInputSchema),
      undefined,
      true,
      MCP_RECOVERY_WRITE_SCOPE,
      async (input) => (await services.recovery.correctObservation(
        input.id as string,
        normalizeRecoveryInput(input, validateCorrectRecoveryObservation) as unknown as CorrectRecoveryObservation
      )).observation,
      () => recoveryWriteResultContent
    ),
    defineTool(
      "list_daily_context_notes",
      "Read current context notes for one authorized Person-local date.",
      ListDailyContextNotesQuerySchema,
      DailyContextNoteListSchema,
      false,
      MCP_READ_SCOPE,
      (input) => services.dailyContextNotes.list(input as ListDailyContextNotesQuery)
    ),
    defineTool(
      "record_daily_context_note",
      "Record one idempotent relevant context note when no more specific typed fact can represent the report safely; follow with typed read-back.",
      CreateDailyContextNoteSchema,
      undefined,
      true,
      MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
      async (input) => (await services.dailyContextNotes.create(input as CreateDailyContextNote)).note
    ),
    defineTool(
      "correct_daily_context_note",
      "Append one idempotent correction to a uniquely identified context note; follow with typed read-back.",
      withIdSchema("CorrectDailyContextNoteToolInput", CorrectDailyContextNoteSchema),
      undefined,
      true,
      MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
      async (input) => (await services.dailyContextNotes.correct(input.id as string, input as unknown as CorrectDailyContextNote)).note
    ),
    defineTool(
      "set_current_timezone",
      "Save only the authorized person's current IANA timezone after an explicit unambiguous statement about their current timezone or location, then retry the daily assessment in the same turn.",
      setCurrentTimezoneInputSchema,
      PersonPreferencesSchema,
      true,
      MCP_PERSON_TIMEZONE_WRITE_SCOPE,
      (input) => services.dailyAssessment?.updatePreferences(input as UpdatePersonPreferences) ??
        Promise.reject(new Error("Daily assessment service is unavailable")),
      () => timezoneWriteResultContent
    ),
    defineTool(
      "get_daily_assessment",
      "Read the deterministic API-owned assessment and explainable next action for the authorized Person's current local day. This is the mandatory and sole decision authority for a full Daily Coach answer; do not recreate or embellish the policy in prompts.",
      emptyObjectSchema("GetDailyAssessmentInput"),
      DailyAssessmentResultSchema,
      false,
      MCP_READ_SCOPE,
      () => services.dailyAssessment?.readCoachContext() ?? Promise.reject(new Error("Daily assessment service is unavailable")),
      (value) => dailyAssessmentCoachContent(value as DailyAssessmentCoachContext),
      (value) => (value as DailyAssessmentCoachContext).assessment
    ),
    defineTool(
      "record_daily_recommendation_feedback",
      "Record one explicit typed response to the exact daily recommendation snapshot. The required status is accepted, completed, skipped, too_heavy, or unsuitable; an optional comment only supplements it. Reuse the same idempotency key only for an exact retry. This evidence does not create owning-domain facts and does not change recommendation policy.",
      CreateDailyRecommendationFeedbackSchema,
      DailyRecommendationFeedbackSchema,
      true,
      MCP_DAILY_RECOMMENDATION_FEEDBACK_WRITE_SCOPE,
      async (input) => {
        const service = services.dailyAssessment;
        if (!service) throw new Error("Daily assessment service is unavailable");
        return (await service.recordFeedback(
          input as unknown as CreateDailyRecommendationFeedback
        )).feedback;
      },
      () => dailyRecommendationFeedbackResultContent
    ),
    defineTool(
      "get_daily_recommendation_completion",
      "Read an immutable explainable completion assessment for one exact daily-assessment-v4 snapshot from owning-domain facts and active manual correction evidence.",
      ReadDailyRecommendationCompletionSchema,
      DailyRecommendationCompletionAssessmentSchema,
      false,
      MCP_READ_SCOPE,
      async (input) => {
        const service = services.dailyAssessment;
        if (!service) throw new Error("Daily assessment service is unavailable");
        return service.readCompletion((input as unknown as ReadDailyRecommendationCompletion).snapshotId);
      },
      (value) => dailyRecommendationCompletionResultContent(value)
    ),
    defineTool(
      "get_daily_projection",
      "Read the current owning-domain facts for one Person-local date.",
      DailyProjectionQuerySchema,
      DailyProjectionSchema,
      false,
      MCP_READ_SCOPE,
      async (input) => {
        const query = input as DailyProjectionQuery;
        const projection = await services.dailyProjection.projection(query);
        let assessmentContext: DailyAssessmentCoachContext | null = null;
        try {
          assessmentContext = await services.dailyAssessment?.readCoachContext() ?? null;
        } catch {
          // A compatibility assessment must not hide an otherwise valid factual projection.
        }
        return { projection, query, assessmentContext } satisfies DailyProjectionCompatibilityResult;
      },
      (value) => dailyProjectionCompatibilityContent(
        value as DailyProjectionCompatibilityResult
      ),
      (value) => (value as DailyProjectionCompatibilityResult).projection
    )
  ];
}

function emptyObjectSchema(id: string): Readonly<Record<string, unknown>> {
  return { $id: id, type: "object", additionalProperties: false, properties: {} };
}

function connectorWeightSchema(
  id: string,
  schema: {
    readonly required: readonly string[];
    readonly properties: Readonly<Record<string, unknown>>;
  }
): Readonly<Record<string, unknown>> & {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
} {
  const weightKgSchema = schema.properties.weightKg as Readonly<
    Record<string, unknown>
  >;
  return {
    $id: id,
    type: "object",
    additionalProperties: false,
    required: schema.required,
    properties: {
      ...schema.properties,
      weightKg: Object.fromEntries(
        Object.entries(weightKgSchema).filter(([keyword]) => keyword !== "multipleOf")
      )
    }
  };
}

function connectorWorkoutSchema(
  id: string,
  schema: {
    readonly required: readonly string[];
    readonly properties: {
      readonly exercises: {
        readonly items: {
          readonly required: readonly string[];
          readonly properties: Readonly<Record<string, unknown>>;
        };
      };
    } & Readonly<Record<string, unknown>>;
  }
): Readonly<Record<string, unknown>> & {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
} {
  const exerciseSchema = schema.properties.exercises.items;
  const strictSetsSchema = exerciseSchema.properties.sets as {
    readonly items: {
      readonly anyOf: readonly {
        readonly properties: Readonly<Record<string, unknown>>;
      }[];
    };
  };
  const connectorPerformedSetInputSchema = {
    type: "object",
    additionalProperties: false,
    properties: strictSetsSchema.items.anyOf[0]!.properties
  } as const;
  return {
    $id: id,
    type: "object",
    additionalProperties: false,
    required: schema.required,
    properties: {
      ...schema.properties,
      exercises: {
        ...(schema.properties.exercises as Readonly<Record<string, unknown>>),
        items: {
          ...exerciseSchema,
          properties: {
            ...exerciseSchema.properties,
            sets: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: connectorPerformedSetInputSchema
            }
          }
        }
      }
    }
  };
}

function connectorMealSchema(
  id: string,
  schema: {
    readonly required: readonly string[];
    readonly properties: {
      readonly items: {
        readonly items: {
          readonly properties: Readonly<Record<string, unknown>>;
        };
      };
    } & Readonly<Record<string, unknown>>;
  }
): Readonly<Record<string, unknown>> & {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
} {
  const itemSchema = schema.properties.items.items;
  const nutrientSchema = itemSchema.properties.nutrients as {
    readonly properties: Readonly<Record<string, unknown>>;
  };
  const sourceReferenceSchema = schema.properties.sourceReference as {
    readonly properties: Readonly<Record<string, unknown>>;
  };
  return {
    $id: id,
    type: "object",
    additionalProperties: false,
    required: schema.required.filter((property) => property !== "sourceReference"),
    properties: {
      ...schema.properties,
      sourceReference: {
        type: "object",
        additionalProperties: false,
        properties: sourceReferenceSchema.properties
      },
      items: {
        ...(schema.properties.items as Readonly<Record<string, unknown>>),
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label"],
          properties: {
            ...itemSchema.properties,
            amountKind: {
              ...(itemSchema.properties.amountKind as Readonly<Record<string, unknown>>),
              description: "Optional compatibility hint. Use estimated for a reasonable photo/text estimate, described only for the user's own non-numeric amount wording, or quantified for an explicit number and unit. Omitted values are inferred from the supplied evidence; unknown cannot produce an accepted Coach Meal write."
            },
            quantity: {
              ...(itemSchema.properties.quantity as Readonly<Record<string, unknown>>),
              description: "Explicit or best-effort estimated amount. For legible meal photos, estimate a realistic quantity instead of requiring measured grams."
            },
            unit: {
              ...(itemSchema.properties.unit as Readonly<Record<string, unknown>>),
              description: "Unit for the explicit or estimated quantity."
            },
            estimateMethod: {
              ...(itemSchema.properties.estimateMethod as Readonly<Record<string, unknown>>),
              description: "Set to photo or text whenever quantity and nutrition are estimated from that evidence."
            },
            amountConfidence: {
              ...(itemSchema.properties.amountConfidence as Readonly<Record<string, unknown>>),
              description: "Bounded 0..1 confidence for the best-effort item estimate; uncertainty should lower confidence, not automatically erase useful estimates."
            },
            nutrients: {
              type: "object",
              additionalProperties: false,
              description: "Provide complete best-effort calories, protein, fat, and carbohydrates for every accepted Coach Meal item. Historical clients may omit or send unknown values, but the server rejects an incomplete Meal before any write.",
              properties: {
                caloriesKcal: {
                  ...(nutrientSchema.properties.caloriesKcal as Readonly<Record<string, unknown>>),
                  description: "Best-effort calories for this item's reported or estimated portion."
                },
                proteinG: {
                  ...(nutrientSchema.properties.proteinG as Readonly<Record<string, unknown>>),
                  description: "Best-effort protein grams for this item's reported or estimated portion."
                },
                fatG: {
                  ...(nutrientSchema.properties.fatG as Readonly<Record<string, unknown>>),
                  description: "Best-effort fat grams for this item's reported or estimated portion."
                },
                carbsG: {
                  ...(nutrientSchema.properties.carbsG as Readonly<Record<string, unknown>>),
                  description: "Best-effort carbohydrate grams for this item's reported or estimated portion."
                }
              }
            }
          }
        }
      }
    }
  };
}

function connectorRecoverySchema(
  id: string,
  schema: {
    readonly required: readonly string[];
    readonly properties: Readonly<Record<string, unknown>>;
  }
): Readonly<Record<string, unknown>> & {
  readonly required: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
} {
  const sourceReferenceSchema = schema.properties.sourceReference as {
    readonly properties: Readonly<Record<string, unknown>>;
  };
  const detailSchema = schema.properties.detail as {
    readonly oneOf: readonly {
      readonly required?: readonly string[];
      readonly properties: Readonly<Record<string, unknown>>;
    }[];
  };
  const connectorDetailSchema = {
    ...detailSchema,
    oneOf: detailSchema.oneOf.map((detail) => {
      const type = detail.properties.type as { readonly const?: string } | undefined;
      return type?.const === "sleep"
        ? {
            ...detail,
            required: detail.required?.filter((property) => property !== "sleepQuality")
          }
        : detail;
    })
  };
  const normalizedByAdapter = new Set([
    "observedFrom",
    "observedUntil",
    "quality",
    "connectionId",
    "consentId",
    "sourceReference"
  ]);
  return {
    $id: id,
    type: "object",
    additionalProperties: false,
    required: schema.required.filter((property) => !normalizedByAdapter.has(property)),
    properties: {
      ...schema.properties,
      detail: connectorDetailSchema,
      sourceReference: {
        type: "object",
        additionalProperties: false,
        properties: sourceReferenceSchema.properties
      }
    }
  };
}

function normalizeMealInput(
  input: Record<string, unknown>,
  validate: ValidateFunction
): Record<string, unknown> {
  const mealInput = { ...input };
  delete mealInput.id;
  const sourceReference = isRecord(mealInput.sourceReference)
    ? mealInput.sourceReference
    : {};
  const normalized = {
    ...mealInput,
    sourceReference: {
      channel: sourceReference.channel ?? "manual",
      externalSystem: sourceReference.externalSystem ?? null,
      externalRecordId: sourceReference.externalRecordId ?? null,
      occurredAt: sourceReference.occurredAt ?? mealInput.occurredAt ?? null
    },
    items: (mealInput.items as Array<Record<string, unknown>>).map((item) => {
      const amountKind = item.amountKind ?? inferAmountKind(item);
      const nutrients = isRecord(item.nutrients) ? item.nutrients : {};
      return {
        ...item,
        foodVersionId: item.foodVersionId ?? null,
        amountKind,
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        amountDescription: item.amountDescription ?? null,
        estimateMethod: item.estimateMethod ?? null,
        amountConfidence: item.amountConfidence ?? null,
        nutrients: {
          caloriesKcal: nutrients.caloriesKcal ?? null,
          proteinG: nutrients.proteinG ?? null,
          fatG: nutrients.fatG ?? null,
          carbsG: nutrients.carbsG ?? null
        }
      };
    })
  };
  assertCompleteCoachMeal(normalized);
  if (!validate(normalized)) {
    throw new ConnectorInputError("Normalized Meal input does not match the domain contract");
  }
  return normalized;
}

function normalizeWeightInput(
  input: Record<string, unknown>,
  validate: ValidateFunction
): Record<string, unknown> {
  const normalized = { ...input };
  delete normalized.id;
  if (!validate(normalized)) {
    throw new ConnectorInputError(
      "Normalized WeightMeasurement input does not match the domain contract"
    );
  }
  return normalized;
}

function assertCompleteCoachMeal(meal: Record<string, unknown>): void {
  const items = meal.items as Array<Record<string, unknown>>;
  for (const item of items) {
    const nutrients = item.nutrients as Record<string, unknown>;
    if (
      item.amountKind === "unknown" ||
      !["caloriesKcal", "proteinG", "fatG", "carbsG"].every(
        (key) => typeof nutrients[key] === "number" && Number.isFinite(nutrients[key])
      )
    ) {
      throw new ConnectorInputError(
        "Coach Meal writes require amount evidence and complete estimated nutrition"
      );
    }
  }
}

function normalizeRecoveryInput(
  input: Record<string, unknown>,
  validate: ValidateFunction
): Record<string, unknown> {
  const recoveryInput = { ...input };
  delete recoveryInput.id;
  const claimedSourceReference = isRecord(recoveryInput.sourceReference)
    ? recoveryInput.sourceReference
    : {};
  const wasMisclassifiedAsDevice = claimedSourceReference.channel === "device";
  const detail = isRecord(recoveryInput.detail) ? recoveryInput.detail : {};
  const temporalPrecision = recoveryInput.temporalPrecision ??
    (typeof recoveryInput.localDate === "string" ? "local_date" : "instant");
  const normalized = {
    ...recoveryInput,
    observedFrom: recoveryInput.observedFrom ?? null,
    observedUntil: recoveryInput.observedUntil ?? null,
    temporalPrecision,
    localDate: recoveryInput.localDate ?? null,
    quality: recoveryInput.quality ?? "reliable",
    connectionId: null,
    consentId: null,
    sourceReference: {
      channel: "manual",
      externalSystem: null,
      externalRecordId: null,
      occurredAt: recoveryInput.observedUntil ?? null
    },
    detail: detail.type === "sleep" ? {
      ...detail,
      deepSleepMinutes: detail.deepSleepMinutes ?? null,
      remSleepMinutes: detail.remSleepMinutes ?? null,
      lightSleepMinutes: detail.lightSleepMinutes ?? null,
      sleepQuality: wasMisclassifiedAsDevice ? null : detail.sleepQuality ?? null
    } : detail
  };
  if (!validate(normalized)) {
    throw new ConnectorInputError(
      "Normalized RecoveryObservation input does not match the domain contract"
    );
  }
  return normalized;
}

function inferAmountKind(item: Record<string, unknown>): string {
  if (item.estimateMethod != null || item.amountConfidence != null) {
    return "estimated";
  }
  if (item.quantity != null || item.unit != null) {
    return "quantified";
  }
  if (item.amountDescription != null) {
    return "described";
  }
  return "unknown";
}

function normalizeWorkoutInput(
  input: Record<string, unknown>,
  validate: ValidateFunction
): Record<string, unknown> {
  const workoutInput = { ...input };
  delete workoutInput.id;
  const normalized = {
    ...workoutInput,
    exercises: (workoutInput.exercises as Array<Record<string, unknown>>).map(
      (exercise) => ({
        ...exercise,
        sets: (exercise.sets as Array<Record<string, unknown>>).map((set) => ({
          weightKg: set.weightKg ?? null,
          reps: set.reps ?? null,
          durationSeconds: set.durationSeconds ?? null,
          distanceMeters: set.distanceMeters ?? null,
          rir: set.rir ?? null
        }))
      })
    )
  };
  if (!validate(normalized)) {
    throw new Error("Normalized WorkoutSession input does not match the domain contract");
  }
  return normalized;
}

function withIdSchema(
  id: string,
  schema: { readonly required: readonly string[]; readonly properties: Readonly<Record<string, unknown>> }
): Readonly<Record<string, unknown>> {
  return {
    $id: id,
    type: "object",
    additionalProperties: false,
    required: ["id", ...schema.required],
    properties: {
      id: { type: "string", format: "uuid" },
      ...schema.properties
    }
  };
}

function defineTool(
  name: string,
  description: string,
  inputSchema: Readonly<Record<string, unknown>>,
  outputSchema: Readonly<Record<string, unknown>> | undefined,
  write: boolean,
  scope: string,
  execute: (input: Record<string, unknown>) => Promise<unknown>,
  present?: (value: unknown) => string,
  structured?: (value: unknown) => unknown
): ToolDefinition {
  return {
    tool: {
      name,
      description: `${toolAuthorityInstruction} ${description}`,
      inputSchema: inputSchema as Tool["inputSchema"],
      ...(outputSchema
        ? { outputSchema: outputSchema as Tool["outputSchema"] }
        : {}),
      annotations: {
        readOnlyHint: !write,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      securitySchemes: [{ type: "oauth2", scopes: [scope] }],
      _meta: {
        securitySchemes: [{ type: "oauth2", scopes: [scope] }]
      }
    },
    validate: compile(inputSchema),
    scope,
    write,
    execute,
    present: present ?? (() => write ? routineWriteResultContent : routineReadResultContent),
    ...(structured ? { structured } : {})
  };
}

function compile(schema: Readonly<Record<string, unknown>>): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, multipleOfPrecision: 6, strict: false });
  const installFormats = addFormats as unknown as (instance: Ajv) => Ajv;
  installFormats(ajv);
  return ajv.compile(schema);
}

function successResult(value: unknown, content?: string): CallToolResult {
  const structured = isRecord(value) ? value : { result: value };
  return {
    content: [{ type: "text", text: content ?? JSON.stringify(value) }],
    structuredContent: structured
  };
}

function errorResult(
  message: string,
  structuredContent?: Readonly<Record<string, unknown>>
): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    ...(structuredContent ? { structuredContent } : {})
  };
}

function inputErrorResult(toolName: string): CallToolResult {
  if (toolName === "correct_meal") {
    return mealCorrectionErrorResult("invalid_replacement");
  }
  if (toolName === "save_confirmed_training_program") {
    return trainingProgramSaveErrorResult("invalid_snapshot");
  }
  if (toolName === "record_meal") {
    return errorResult(coachFailureResultContent(
      "Retry the Meal once silently from the photo and text already present in the conversation. Every identifiable item must have non-unknown amount evidence and numeric best-effort calories, protein, fat, and carbohydrates; estimate realistic portions with text/photo method and bounded confidence because exact measured grams are not required. Do not ask the user for values that can be reasonably estimated, do not save an incomplete Meal, and do not mention internal completeness, tools, staging, APIs, contracts, fields, or this retry. If material food or scale is genuinely unidentifiable, ask one natural clarification instead of claiming it was saved."
    ));
  }
  if (toolName === "record_recovery_observation" || toolName === "correct_recovery_observation") {
    return errorResult(coachFailureResultContent(
      "Retry this recovery fact once using the exact local date and timezone plus only the reported value. " +
      "A wearable 0..100 sleep score is metric sleep_score with unit score, never sleepQuality. " +
      "Continue saving the other independent facts from the same report. Do not mention tools, staging, APIs, " +
      "contracts, fields, or this retry to the user. If this fact still cannot be saved, describe that one missing " +
      "fact naturally without technical details and never claim it was recorded."
    ));
  }
  if (toolName === "record_workout_session" || toolName === "correct_workout_session") {
    return errorResult(coachFailureResultContent(
      "Retry this Workout once using the performed exercises and sets already present in the conversation plus exact " +
      "exercise version references from the active TrainingProgram when needed. Preserve genuinely unknown optional set " +
      "values and do not ask the user whether to save known work again. Do not mention tools, staging, APIs, contracts, " +
      "fields, or this retry to the user. If the retry still fails, say naturally that saving is temporarily unavailable."
    ));
  }
  return errorResult(coachFailureResultContent(
    "Retry once silently using the unambiguous facts already present. If essential meaning is genuinely ambiguous, ask one natural clarification; otherwise say briefly that this item could not be completed."
  ));
}

type TrainingProgramSaveFailureReason =
  | "invalid_snapshot"
  | "stale_active_program"
  | "retryable_failure";

function trainingProgramSaveErrorResult(
  reason: TrainingProgramSaveFailureReason
): CallToolResult {
  const recovery = reason === "invalid_snapshot"
    ? "read_context_rebuild_exact_snapshot_retry_once"
    : reason === "stale_active_program"
      ? "read_context_compare_then_confirm_replacement"
      : "read_context_verify_or_retry_once";
  const instruction = reason === "invalid_snapshot"
    ? "TRAINING PROGRAM NOT SAVED: Call get_training_context, rebuild the exact already accepted complete snapshot from the conversation, and retry once. If the accepted snapshot itself lacks an essential detail, ask only one short question for that detail; never ask the user to repeat the whole program."
    : reason === "stale_active_program"
      ? "TRAINING PROGRAM NOT SAVED: Call get_training_context immediately. If the complete active snapshot already equals the accepted version, the read-back verifies success. If it differs, do not overwrite or retry automatically; retain the already accepted snapshot and ask one short natural question whether to replace the current active program with that version, without asking the user to repeat it."
      : "TRAINING PROGRAM SAVE NOT VERIFIED: Call get_training_context immediately. If the complete active snapshot equals the accepted version, the read-back verifies success. If the previous authority is unchanged, retry the exact accepted snapshot once. If a different active version exists, do not overwrite it automatically; ask one short natural replacement question without requiring the program again.";
  return errorResult(
    coachFailureResultContent(
      `${instruction} Until a matching active read-back succeeds, keep the program Proposed now and never call it saved, agreed, current, active, or the user's plan. Keep all tool names, ids, fields, error categories, and recovery mechanics out of the user-facing reply.`
    ),
    {
      state: "not_saved",
      reason,
      recovery
    }
  );
}

type MealCorrectionFailureReason =
  | "invalid_replacement"
  | "stale_or_missing_target"
  | "retryable_failure";

function mealCorrectionErrorResult(
  reason: MealCorrectionFailureReason
): CallToolResult {
  const recovery = reason === "retryable_failure"
    ? "retry_same_correction_once"
    : "read_current_meal_rebuild_and_retry";
  const instruction = reason === "retryable_failure"
    ? "MEAL CORRECTION NOT SAVED: Retry the exact same correction once with the same idempotency key. If it still fails, say naturally that saving is temporarily unavailable."
    : "MEAL CORRECTION NOT SAVED: Call list_meals for the local date already present in the correction, select the current matching Meal, preserve every canonical field and item, overlay only the user's clarification, and retry correct_meal once with the current id and a correction-specific idempotency key.";
  return errorResult(
    coachFailureResultContent(
      `${instruction} Keep the user's unambiguous clarification as pending correction intent and do not ask them to repeat or reconfirm it. Until a typed success is returned, never claim it was saved or promise to use the unpersisted value in later totals, assessments, or recommendations. Keep this recovery flow and all tool names, ids, fields, and error categories out of the user-facing reply.`
    ),
    {
      state: "not_saved",
      reason,
      recovery
    }
  );
}

function authorizationErrorResult(
  message: string,
  oauthError: McpOAuthErrorCode,
  metadataUrl: string,
  scope: string
): CallToolResult {
  const description = message.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const challenge = `Bearer resource_metadata="${metadataUrl}", scope="${scope}", error="${oauthError}", error_description="${description}"`;
  return {
    ...errorResult(coachFailureResultContent(
      "Current access is unavailable. Use the client's native access flow when offered; otherwise say naturally that current data cannot be reached yet."
    )),
    _meta: { "mcp/www_authenticate": [challenge] }
  };
}

function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const parent = url.pathname.replace(/\/mcp\/?$/u, "");
  url.pathname = `${parent}/.well-known/oauth-protected-resource`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
