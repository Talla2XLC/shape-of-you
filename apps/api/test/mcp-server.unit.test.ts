import Fastify from "fastify";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT
} from "jose";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  CreateRecoveryObservation,
  DailyAssessmentResult,
  ListRecoveryObservationsQuery,
  RecoveryObservation
} from "@shape-of-you/contracts";

import { RequestPersonContext } from "../src/application/person-context.js";
import { ConflictError, NotFoundError } from "../src/domain/errors.js";
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
  McpAuthorizer,
  McpAuthorizationError,
  type McpAuthorizationBoundary
} from "../src/mcp/oauth.js";
import {
  MCP_COACH_FINAL_RESPONSE_REQUIREMENT,
  MCP_COACH_REPLY_POLICY,
  MCP_OPERATIONAL_INSTRUCTIONS,
  MCP_ROUTINE_COACH_RESPONSE_EXAMPLES,
  registerMcpRoutes
} from "../src/mcp/server.js";

const legacyMealToolCompatibilityContracts = {
  record_meal: {
    required: ["occurredAt", "timezone", "kind", "items", "dedupeKey"],
    properties: [
      "occurredAt", "timezone", "kind", "description", "note", "photoMediaId",
      "items", "sourceReference", "dedupeKey", "confidence"
    ]
  },
  correct_meal: {
    required: ["id", "occurredAt", "timezone", "kind", "items", "dedupeKey", "reason"],
    properties: [
      "id", "occurredAt", "timezone", "kind", "description", "note", "photoMediaId",
      "items", "sourceReference", "dedupeKey", "confidence", "reason"
    ]
  }
} as const;

const confirmedAbsentRecoveryMetrics = [
  "sleep",
  "sleep_score",
  "resting_heart_rate",
  "night_heart_rate",
  "hrv_rmssd",
  "oxygen_saturation",
  "respiration_rate",
  "body_battery_min",
  "body_battery_max",
  "steps"
].map((metric) => ({ metric, state: "confirmed_absent", periodState: null, asOf: null }));

const safeCurrentRecoveryObservation = {
  kind: "metric",
  observedFrom: null,
  observedUntil: null,
  temporalPrecision: "local_date",
  localDate: "2026-09-18",
  timezone: "Europe/Belgrade",
  quality: "reliable",
  detail: { type: "metric", metric: "steps", value: 2_834, unit: "count" }
} as const;

const forbiddenCurrentRecoveryIdentityKeys = [
  "id",
  "personId",
  "connectionId",
  "consentId",
  "dedupeKey",
  "sourceReference",
  "supersedesId",
  "correctionReason",
  "createdAt"
] as const;

function expectNoCurrentRecoveryIdentity(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) expectNoCurrentRecoveryIdentity(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    expect(forbiddenCurrentRecoveryIdentityKeys).not.toContain(key);
    expectNoCurrentRecoveryIdentity(child);
  }
}

const legacyMealItemCompatibilityContract = {
  required: ["label"],
  properties: [
    "foodVersionId",
    "label",
    "amountKind",
    "quantity",
    "unit",
    "amountDescription",
    "estimateMethod",
    "amountConfidence",
    "nutrients"
  ],
  enums: {
    kind: ["breakfast", "lunch", "dinner", "snack", "other"],
    amountKind: ["unknown", "described", "quantified", "estimated"],
    unit: ["g", "ml", "serving", "piece"]
  },
  nutrientProperties: ["caloriesKcal", "proteinG", "fatG", "carbsG"]
} as const;

interface CompatibilitySchema {
  required?: string[];
  properties?: Record<string, CompatibilitySchema>;
  enum?: string[];
  anyOf?: CompatibilitySchema[];
  items?: CompatibilitySchema;
}

function expectLegacyMealToolCompatibility(
  toolName: keyof typeof legacyMealToolCompatibilityContracts,
  schema: CompatibilitySchema
): void {
  const toolContract = legacyMealToolCompatibilityContracts[toolName];
  for (const requiredProperty of schema.required ?? []) {
    expect(toolContract.required).toContain(requiredProperty);
  }
  for (const property of toolContract.properties) {
    expect(schema.properties).toHaveProperty(property);
  }
  expect(schema.properties?.kind?.enum).toEqual(expect.arrayContaining(
    [...legacyMealItemCompatibilityContract.enums.kind]
  ));

  const itemSchema = schema.properties?.items?.items;
  expect(itemSchema).toBeDefined();
  for (const requiredProperty of itemSchema?.required ?? []) {
    expect(legacyMealItemCompatibilityContract.required).toContain(requiredProperty);
  }
  for (const property of legacyMealItemCompatibilityContract.properties) {
    expect(itemSchema?.properties).toHaveProperty(property);
  }
  expect(itemSchema?.properties?.amountKind?.enum).toEqual(expect.arrayContaining(
    [...legacyMealItemCompatibilityContract.enums.amountKind]
  ));
  const unitEnum = itemSchema?.properties?.unit?.anyOf
    ?.find((candidate) => candidate.enum)?.enum;
  expect(unitEnum).toEqual(expect.arrayContaining(
    [...legacyMealItemCompatibilityContract.enums.unit]
  ));
  const nutrientSchema = itemSchema?.properties?.nutrients;
  expect(nutrientSchema?.required).toBeUndefined();
  for (const property of legacyMealItemCompatibilityContract.nutrientProperties) {
    expect(nutrientSchema?.properties).toHaveProperty(property);
  }
}

const fastify = Fastify();
const unreachable = async (): Promise<never> => {
  throw new Error("Domain service must not be called without authorization");
};
const denied: McpAuthorizationBoundary = {
  authorize: async () => {
    throw new McpAuthorizationError(
      "A bearer access token is required",
      "invalid_token"
    );
  }
};
const unavailableServices = {
  weights: { list: unreachable, create: unreachable, correct: unreachable },
  bodyMeasurements: { list: unreachable, create: unreachable, correct: unreachable },
  nutrition: { listMeals: unreachable, createMeal: unreachable, correctMeal: unreachable },
  training: {
    listWorkoutSessions: unreachable,
    createWorkoutSession: unreachable,
    correctWorkoutSession: unreachable,
    findActiveProgram: unreachable,
    saveConfirmedProgram: unreachable,
    getTrainingContext: unreachable
  },
  recovery: {
    listObservations: unreachable,
    createObservation: unreachable,
    correctObservation: unreachable
  },
  currentRecoveryContext: { read: unreachable },
  dailyContextNotes: { list: unreachable, create: unreachable, correct: unreachable },
  dailyProjection: { projection: unreachable }
};

registerMcpRoutes({
  fastify,
  issuer: "https://identity.example.test",
  resource: "https://api.example.test/api/mcp",
  authorizer: denied,
  personContext: new RequestPersonContext(),
  services: unavailableServices
});

afterAll(async () => {
  await fastify.close();
});

describe("MCP HTTP adapter", () => {
  it("publishes durable PostgreSQL authority and fail-closed instructions", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/mcp",
      headers: { accept: "application/json, text/event-stream" },
      payload: {
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "authority-policy-test", version: "1.0.0" }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result.instructions).toBe(MCP_OPERATIONAL_INSTRUCTIONS);
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "MUST call get_daily_assessment first"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Never reconstruct or alter that decision from get_daily_projection"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).not.toContain(
      "call get_daily_projection first"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Outside a full Daily Coach assessment, present Planned, Proposed now, and Actually completed separately"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "an accepted recommendation is not executed"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "call get_current_recovery_context"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "never promise a later autonomous recheck"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Outside a full Daily Coach assessment, give one clear Next step"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Do not add any nutrition, training, or recovery proposal beyond actions returned by the assessment"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).not.toContain(
      "Give one clear Next step plus"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "state missing evidence instead of inventing a plan"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "a clear signal that the workout is finished, authorizes immediate recording"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Do not ask whether to record it"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "only status absent proves that no active program exists"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Outside a full Daily Coach assessment, before focused training or recovery advice"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "without asking the user to send a screenshot"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "never invent those details or automatically record it as a WorkoutSession"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "do not count both as separate training"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "obtain explicit user confirmation"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "compare the complete snapshot before claiming success"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "label the affected field unknown"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "never infer absence, zero, no plan, or another dependent fact"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "plain Markdown and never emit HTML entities or encoded whitespace"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "direct relevant user report authorizes one routine low-risk"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Always require a typed owning-domain result before claiming success"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "A routine create does not require a pre-read"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Before a Meal correction, call list_meals with localDate only"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "sufficient typed verification; do not perform another list solely to prove success"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "list_meals with localDate only"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "never invent 1 serving or another sentinel amount"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "authorizes and requires an immediate best-effort estimate"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Exact grams are not a prerequisite"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "calories, protein, fat, and carbohydrates"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "sound like a real coach"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "For a routine capture, correction, or short factual answer, reply in one to three natural sentences"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "For a full Daily Coach answer, use the requested brief structure without a sentence limit"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Never expose tool names, arguments, identifiers, property or enum names"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Do not force Planned, Proposed now, or Actually completed headings onto a routine fact capture"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Always use the user's language"
    );
    const priorityInstructions = MCP_OPERATIONAL_INSTRUCTIONS.slice(0, 512);
    expect(priorityInstructions).toContain("call get_daily_assessment");
    expect(priorityInstructions).toContain("sole decision authority");
    expect(priorityInstructions).toContain(
      "Keep internal mechanics invisible in user-facing replies"
    );
    expect(priorityInstructions).toContain(
      "sound like a real coach"
    );
    expect(priorityInstructions).toContain(
      "one useful evidence-grounded observation"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      MCP_COACH_FINAL_RESPONSE_REQUIREMENT
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Never ask whether the user wants you to record, correct, estimate, analyze"
    );
    expect(MCP_COACH_FINAL_RESPONSE_REQUIREMENT).toContain(
      "MUST end with one direct, concrete recommendation or next step"
    );
    expect(MCP_COACH_FINAL_RESPONSE_REQUIREMENT).toContain(
      "only confirms, records, calculates, or summarizes facts is incomplete"
    );
    expect(MCP_COACH_FINAL_RESPONSE_REQUIREMENT).toContain(
      "never silently omit the next step"
    );
    expect(MCP_COACH_REPLY_POLICY).toContain(
      "perform the action instead"
    );
    const forbiddenRoutineReplyTerms = [
      "amountKind",
      "list_meals",
      "null",
      "partial",
      "read-back",
      "typed"
    ];
    for (const example of MCP_ROUTINE_COACH_RESPONSE_EXAMPLES) {
      const sentenceCount = example.split(/[.!?]+/u).filter(Boolean).length;
      expect(sentenceCount).toBeGreaterThanOrEqual(1);
      expect(sentenceCount).toBeLessThanOrEqual(2);
      for (const forbidden of forbiddenRoutineReplyTerms) {
        expect(example.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
      expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(example);
    }
    expect(MCP_ROUTINE_COACH_RESPONSE_EXAMPLES).toContain(
      "Записал ужин: лосось, кукурузу, овощи, ягоды и бокал вина. Хороший набор белка и овощей; после вина сегодня лучше перейти на воду и оставить вечер спокойным."
    );
    expect(MCP_ROUTINE_COACH_RESPONSE_EXAMPLES).toContain(
      "По фото оценил ужин примерно в 670 ккал: около 44 г белка, 29 г жиров и 59 г углеводов. Мясо даёт хороший белок, а большую часть углеводов здесь набирает пюре."
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).not.toContain(
      "Confirm writes"
    );
  });

  it("publishes OAuth protected-resource metadata", async () => {
    const response = await fastify.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      resource: "https://api.example.test/api/mcp",
      authorization_servers: ["https://identity.example.test"]
    });
  });

  it("advertises the scoped tools without exposing domain data", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/mcp",
      headers: { accept: "application/json, text/event-stream" },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {}
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result.tools).toHaveLength(26);
    expect(body.result.tools).toSatisfy((tools: Array<{ description?: string }>) =>
      tools.every((tool) =>
        tool.description?.startsWith(
          "PostgreSQL authority; no Google Sheets fallback. Fail closed"
        )
      )
    );
    expect(body.result.tools[0]._meta.securitySchemes).toEqual([
      { type: "oauth2", scopes: [MCP_READ_SCOPE] }
    ]);
    expect(body.result.tools[0].securitySchemes).toEqual([
      { type: "oauth2", scopes: [MCP_READ_SCOPE] }
    ]);
    expect(Object.fromEntries(body.result.tools.map((tool: {
      name: string;
      securitySchemes: Array<{ scopes: string[] }>;
    }) => [tool.name, tool.securitySchemes[0]?.scopes[0]]))).toEqual({
      list_weight_measurements: MCP_READ_SCOPE,
      record_weight_measurement: MCP_WEIGHT_WRITE_SCOPE,
      correct_weight_measurement: MCP_WEIGHT_WRITE_SCOPE,
      list_body_measurements: MCP_READ_SCOPE,
      record_body_measurements: MCP_BODY_MEASUREMENT_WRITE_SCOPE,
      correct_body_measurements: MCP_BODY_MEASUREMENT_WRITE_SCOPE,
      list_meals: MCP_READ_SCOPE,
      record_meal: MCP_MEAL_WRITE_SCOPE,
      correct_meal: MCP_MEAL_WRITE_SCOPE,
      get_active_training_program: MCP_READ_SCOPE,
      get_training_context: MCP_READ_SCOPE,
      save_confirmed_training_program: MCP_WORKOUT_WRITE_SCOPE,
      list_workout_sessions: MCP_READ_SCOPE,
      record_workout_session: MCP_WORKOUT_WRITE_SCOPE,
      correct_workout_session: MCP_WORKOUT_WRITE_SCOPE,
      list_recovery_observations: MCP_READ_SCOPE,
      get_current_recovery_context: MCP_READ_SCOPE,
      record_recovery_observation: MCP_RECOVERY_WRITE_SCOPE,
      correct_recovery_observation: MCP_RECOVERY_WRITE_SCOPE,
      list_daily_context_notes: MCP_READ_SCOPE,
      record_daily_context_note: MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
      correct_daily_context_note: MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
      set_current_timezone: MCP_PERSON_TIMEZONE_WRITE_SCOPE,
      get_daily_assessment: MCP_READ_SCOPE,
      record_daily_recommendation_feedback: MCP_DAILY_RECOMMENDATION_FEEDBACK_WRITE_SCOPE,
      get_daily_projection: MCP_READ_SCOPE
    });
    expect(body.result.tools.find((tool: { name: string }) =>
      tool.name === "record_daily_context_note"
    )?.description).toContain("follow with typed read-back");
    const dailyAssessmentTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "get_daily_assessment"
    );
    expect(dailyAssessmentTool).toMatchObject({
      inputSchema: { $id: "GetDailyAssessmentInput", additionalProperties: false },
      outputSchema: { $id: "DailyAssessmentResult", oneOf: expect.any(Array) },
      annotations: { readOnlyHint: true, destructiveHint: false },
      securitySchemes: [{ scopes: [MCP_READ_SCOPE] }]
    });
    expect(dailyAssessmentTool.description).toContain("mandatory and sole decision authority");
    expect(dailyAssessmentTool.description).toContain("do not recreate or embellish the policy in prompts");
    const currentRecoveryContextTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "get_current_recovery_context"
    );
    expect(currentRecoveryContextTool).toMatchObject({
      inputSchema: { $id: "GetCurrentRecoveryContextInput", additionalProperties: false },
      outputSchema: { $id: "CurrentRecoveryContextResult", oneOf: expect.any(Array) },
      annotations: { readOnlyHint: true, destructiveHint: false },
      securitySchemes: [{ scopes: [MCP_READ_SCOPE] }]
    });
    const rawRecoveryTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "list_recovery_observations"
    );
    expect(rawRecoveryTool.outputSchema.properties.items.items.properties).toHaveProperty("id");
    expect(rawRecoveryTool.outputSchema.properties.items.items.properties).toHaveProperty("dedupeKey");
    const dailyAssessmentAjv = new Ajv({ strict: false });
    const installFormats = addFormats as unknown as (instance: Ajv) => Ajv;
    installFormats(dailyAssessmentAjv);
    const validateDailyAssessment = dailyAssessmentAjv.compile(dailyAssessmentTool.outputSchema);
    expect(validateDailyAssessment({ state: "timezone_required", timezone: null })).toBe(true);
    expect(validateDailyAssessment({ state: "timezone_required", timezone: "UTC" })).toBe(false);
    const validateCurrentRecoveryContext = dailyAssessmentAjv.compile(
      currentRecoveryContextTool.outputSchema
    );
    expect(validateCurrentRecoveryContext({
      state: "available",
      policyVersion: "connected-recovery-freshness-v2",
      calculatedAt: "2026-09-18T08:30:00.000Z",
      localDate: "2026-09-18",
      timezone: "Europe/Belgrade",
      syncState: "fresh_success",
      targetDateDelivery: "record_without_supported_facts",
      checkedAt: "2026-09-18T08:29:00.000Z",
      metricDelivery: confirmedAbsentRecoveryMetrics,
      observations: { items: [] }
    })).toBe(true);
    expect(validateCurrentRecoveryContext({
      state: "available",
      policyVersion: "connected-recovery-freshness-v1",
      calculatedAt: "2026-09-18T08:30:00.000Z",
      localDate: "2026-09-18",
      timezone: "Europe/Belgrade",
      syncState: "never_checked",
      targetDateDelivery: "unknown",
      checkedAt: null,
      observations: { items: [] }
    })).toBe(false);
    const safeCurrentContext = {
      state: "available",
      policyVersion: "connected-recovery-freshness-v2",
      calculatedAt: "2026-09-18T08:30:00.000Z",
      localDate: "2026-09-18",
      timezone: "Europe/Belgrade",
      syncState: "fresh_success",
      targetDateDelivery: "supported_facts_present",
      checkedAt: "2026-09-18T08:29:00.000Z",
      metricDelivery: confirmedAbsentRecoveryMetrics,
      observations: { items: [safeCurrentRecoveryObservation] }
    };
    expect(validateCurrentRecoveryContext(safeCurrentContext)).toBe(true);
    for (const forbiddenKey of forbiddenCurrentRecoveryIdentityKeys) {
      expect(validateCurrentRecoveryContext({
        ...safeCurrentContext,
        observations: {
          items: [{ ...safeCurrentRecoveryObservation, [forbiddenKey]: "internal" }]
        }
      }), forbiddenKey).toBe(false);
    }
    expect(validateCurrentRecoveryContext({
      state: "available",
      policyVersion: "connected-recovery-freshness-v2",
      calculatedAt: "2026-09-18T08:30:00.000Z",
      localDate: "2026-09-18",
      timezone: "Europe/Belgrade",
      syncState: "fresh_success",
      targetDateDelivery: "record_without_supported_facts",
      checkedAt: "2026-09-18T08:29:00.000Z",
      metricDelivery: confirmedAbsentRecoveryMetrics,
      observations: { items: [] },
      provider: "garmin"
    })).toBe(false);
    expect(validateCurrentRecoveryContext({
      state: "available",
      policyVersion: "connected-recovery-freshness-v2",
      calculatedAt: "2026-09-18T08:30:00.000Z",
      localDate: "2026-09-18",
      timezone: "Europe/Belgrade",
      syncState: "fresh_success",
      targetDateDelivery: "record_without_supported_facts",
      checkedAt: "2026-09-18T08:29:00.000Z",
      metricDelivery: Array.from({ length: 10 }, () => ({
        metric: "sleep",
        state: "confirmed_absent",
        periodState: null,
        asOf: null
      })),
      observations: { items: [] }
    })).toBe(false);
    expect(validateCurrentRecoveryContext({
      state: "available",
      policyVersion: "connected-recovery-freshness-v2",
      calculatedAt: "2026-09-18T08:30:00.000Z",
      localDate: "2026-09-18",
      timezone: "Europe/Belgrade",
      syncState: "fresh_success",
      targetDateDelivery: "record_without_supported_facts",
      checkedAt: "2026-09-18T08:29:00.000Z",
      metricDelivery: confirmedAbsentRecoveryMetrics.map((item) => item.metric === "sleep"
        ? { ...item, periodState: "partial_day", asOf: "2026-09-18T08:00:00.000Z" }
        : item),
      observations: { items: [] }
    })).toBe(false);
    const timezoneTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "set_current_timezone"
    );
    expect(timezoneTool).toMatchObject({
      inputSchema: { $id: "SetCurrentTimezoneInput", additionalProperties: false },
      outputSchema: { $id: "PersonPreferences" },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      securitySchemes: [{ scopes: [MCP_PERSON_TIMEZONE_WRITE_SCOPE] }]
    });
    expect(timezoneTool.inputSchema.properties).toEqual({
      timezone: expect.objectContaining({ type: "string" })
    });
    const feedbackTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "record_daily_recommendation_feedback"
    );
    expect(feedbackTool).toMatchObject({
      inputSchema: {
        $id: "CreateDailyRecommendationFeedback",
        additionalProperties: false,
        required: ["snapshotId", "status", "idempotencyKey"],
        properties: {
          status: {
            enum: ["accepted", "completed", "skipped", "too_heavy", "unsuitable"]
          }
        }
      },
      outputSchema: { $id: "DailyRecommendationFeedback" },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      securitySchemes: [{ scopes: [MCP_DAILY_RECOMMENDATION_FEEDBACK_WRITE_SCOPE] }]
    });
    for (const toolName of [
      "record_weight_measurement",
      "correct_weight_measurement"
    ]) {
      const weightSchema = body.result.tools.find(
        (tool: { name: string }) => tool.name === toolName
      )?.inputSchema.properties.weightKg;
      expect(weightSchema).toEqual({
        type: "number",
        minimum: 0.5,
        maximum: 700
      });
      const validateWeight = new Ajv({ strict: false }).compile(weightSchema);
      expect(validateWeight(77.1), toolName).toBe(true);
      expect(validateWeight("77.1"), toolName).toBe(false);
      expect(validateWeight(0.499), toolName).toBe(false);
      expect(validateWeight(700.001), toolName).toBe(false);
    }
    const recordMealTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "record_meal"
    );
    expect(recordMealTool?.description).toContain(
      "reply in natural coach language"
    );
    expect(recordMealTool?.description).toContain(
      "Every accepted Coach Meal item must include"
    );
    expect(recordMealTool?.inputSchema.properties.items.items).toMatchObject({
      required: ["label"],
      properties: {
        amountKind: {
          enum: ["unknown", "described", "quantified", "estimated"]
        },
        nutrients: {
          type: "object",
          additionalProperties: false,
          properties: expect.any(Object)
        }
      }
    });
    expect(recordMealTool?.inputSchema.properties.items.items.properties.amountKind.description)
      .toContain("Omitted values are inferred");
    expect(recordMealTool?.inputSchema.properties.items.items.properties.nutrients.description)
      .toContain("server rejects an incomplete Meal before any write");
    for (const nutrient of ["caloriesKcal", "proteinG", "fatG", "carbsG"]) {
      expect(recordMealTool?.inputSchema.properties.items.items.properties.nutrients
        .properties[nutrient].type).toEqual(["number", "null"]);
    }
    const correctMealTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "correct_meal"
    );
    expect(correctMealTool?.description).toContain(
      "returned canonical Meal is sufficient typed verification"
    );
    expect(correctMealTool?.description).toContain(
      "never reapply an already successful correction"
    );
    expect(correctMealTool?.description).not.toContain(
      "Follow with date-scoped read-back"
    );
    expectLegacyMealToolCompatibility("record_meal", recordMealTool?.inputSchema);
    expectLegacyMealToolCompatibility("correct_meal", correctMealTool?.inputSchema);
    expect(recordMealTool?.inputSchema.required).not.toContain("sourceReference");
    expect(recordMealTool?.inputSchema.properties.sourceReference.required).toBeUndefined();
    const recordRecoveryTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "record_recovery_observation"
    );
    expect(recordRecoveryTool?.inputSchema.required).toEqual([
      "kind",
      "timezone",
      "dedupeKey",
      "detail"
    ]);
    const recoveryDetailSchemas = recordRecoveryTool?.inputSchema.properties.detail.oneOf;
    const sleepDetailSchema = recoveryDetailSchemas.find((detail: {
      properties: { type: { const: string } };
    }) => detail.properties.type.const === "sleep");
    expect(sleepDetailSchema.required).toEqual(["type", "totalSleepMinutes"]);
    const metricDetailSchema = recoveryDetailSchemas.find((detail: {
      properties: { type: { const: string } };
    }) => detail.properties.type.const === "metric");
    expect(metricDetailSchema.properties.metric.enum).toContain("sleep_score");
    expect(metricDetailSchema.allOf).toContainEqual(expect.objectContaining({
      if: { properties: { metric: { enum: ["body_battery", "body_battery_min", "body_battery_max", "sleep_score"] } } },
      then: {
        properties: {
          value: { minimum: 0, maximum: 100 },
          unit: { const: "score" }
        }
      }
    }));
    const workoutSetSchema = body.result.tools.find((tool: { name: string }) =>
      tool.name === "record_workout_session"
    )?.inputSchema.properties.exercises.items.properties.sets.items;
    expect(workoutSetSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        weightKg: expect.any(Object),
        reps: expect.any(Object),
        durationSeconds: expect.any(Object),
        distanceMeters: expect.any(Object),
        rir: expect.any(Object)
      }
    });
    expect(workoutSetSchema.required).toBeUndefined();
    const recordWorkoutTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "record_workout_session"
    );
    expect(recordWorkoutTool?.description).toContain(
      "Immediately record one idempotent workout session"
    );
    expect(recordWorkoutTool?.description).toContain(
      "never ask whether to save it"
    );
    expect(body.result.tools.find((tool: { name: string }) =>
      tool.name === "correct_workout_session"
    )?.description).toContain("Do not ask for duplicate confirmation");
    expect(body.result.tools.find((tool: { name: string }) =>
      tool.name === "list_workout_sessions"
    )?.description).toContain("For one-day Workout read-back pass localDate");
    const activeTrainingProgramTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "get_active_training_program"
    );
    expect(activeTrainingProgramTool).toMatchObject({
      outputSchema: {
        $id: "ActiveTrainingProgramResult",
        type: "object",
        oneOf: [
          {
            required: ["status", "program"],
            properties: {
              status: { const: "active" },
              program: expect.any(Object)
            }
          },
          {
            required: ["status", "program"],
            properties: {
              status: { const: "absent" },
              program: { type: "null" }
            }
          }
        ]
      },
      annotations: { readOnlyHint: true },
      securitySchemes: [{ scopes: [MCP_READ_SCOPE] }]
    });
    expect(ToolSchema.safeParse(activeTrainingProgramTool).success).toBe(true);
    const trainingContextTool = body.result.tools.find(
      (tool: { name: string }) => tool.name === "get_training_context"
    );
    expect(trainingContextTool).toMatchObject({
      inputSchema: {
        $id: "TrainingContextQuery",
        properties: { historyLimit: { minimum: 1, maximum: 50 } }
      },
      outputSchema: { $id: "TrainingContext", oneOf: expect.any(Array) },
      annotations: { readOnlyHint: true },
      securitySchemes: [{ scopes: [MCP_READ_SCOPE] }]
    });
    for (const branch of trainingContextTool.outputSchema.oneOf) {
      expect(branch.required).toContain("recentExternalActivities");
      expect(branch.properties.recentExternalActivities).toMatchObject({
        type: "array",
        items: {
          $id: "ExternalActivitySummary",
          additionalProperties: false,
          required: expect.arrayContaining([
            "id",
            "occurredAt",
            "localDate",
            "name",
            "durationSeconds",
            "garminAttributed"
          ])
        }
      });
      expect(Object.keys(
        branch.properties.recentExternalActivities.items.properties
      ).sort()).toEqual([
        "averageHeartRate",
        "deviceName",
        "distanceMeters",
        "durationSeconds",
        "garminAttributed",
        "id",
        "localDate",
        "maximumHeartRate",
        "name",
        "occurredAt",
        "timezone",
        "trainingLoad"
      ]);
    }
    expect(trainingContextTool.description).toContain(
      "without requesting a screenshot or manual repeat"
    );
    expect(trainingContextTool.description).toContain(
      "never infer exercises or sets"
    );
    const saveProgramTool = body.result.tools.find(
      (tool: { name: string }) =>
        tool.name === "save_confirmed_training_program"
    );
    expect(saveProgramTool).toMatchObject({
      inputSchema: {
        $id: "SaveConfirmedTrainingProgram",
        oneOf: expect.any(Array)
      },
      outputSchema: {
        $id: "SaveConfirmedTrainingProgramResult",
        required: ["outcome", "program"]
      },
      annotations: { readOnlyHint: false },
      securitySchemes: [{ scopes: [MCP_WORKOUT_WRITE_SCOPE] }]
    });
    expect(saveProgramTool.description).toContain(
      "only after the user explicitly confirmed"
    );
    expect(saveProgramTool.description).toContain(
      "read the active program again"
    );
    expect(ToolSchema.safeParse(trainingContextTool).success).toBe(true);
    expect(ToolSchema.safeParse(saveProgramTool).success).toBe(true);
  });

  it("returns the OAuth challenge from a protected tool call", async () => {
    const response = await fastify.inject({
      method: "POST",
      url: "/mcp",
      headers: { accept: "application/json, text/event-stream" },
      payload: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "list_weight_measurements", arguments: {} }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().result).toMatchObject({
      isError: true,
      content: [{ text: expect.stringContaining("Do not claim that an unverified read or failed change succeeded") }],
      _meta: {
        "mcp/www_authenticate": [
          'Bearer resource_metadata="https://api.example.test/api/.well-known/oauth-protected-resource", scope="person:read", error="invalid_token", error_description="A bearer access token is required"'
        ]
      }
    });
  });

  it("dispatches composed training context and confirmed program persistence", async () => {
    const authorizedFastify = Fastify();
    const pair = await generateKeyPair("ES256");
    const jwk = await exportJWK(pair.publicKey);
    const token = await new SignJWT({
      client_id: "chatgpt-runtime",
      scope: [MCP_READ_SCOPE, MCP_WORKOUT_WRITE_SCOPE].join(" ")
    })
      .setProtectedHeader({ alg: "ES256", kid: "training-program-v1" })
      .setIssuer("https://identity.example.test")
      .setSubject("identity-account-1")
      .setAudience("https://api.example.test/api/mcp")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(pair.privateKey);
    const programId = "00000000-0000-4000-8000-000000000401";
    const exerciseVersionId = "00000000-0000-4000-8000-000000000402";
    const getTrainingContext = vi
      .fn()
      .mockResolvedValueOnce({
        status: "absent",
        program: null,
        recentSessions: { items: [{ id: "historical-session" }] },
        recentExternalActivities: [{
          id: "00000000-0000-4000-8000-000000000403",
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
      })
      .mockResolvedValueOnce({
        status: "active",
        program: { id: programId, lockVersion: 1 },
        recentSessions: { items: [] },
        recentExternalActivities: []
      })
      .mockResolvedValueOnce({
        status: "absent",
        program: null,
        recentSessions: { items: [] },
        recentExternalActivities: []
      })
      .mockRejectedValueOnce(new Error("Training repository unavailable"));
    const saveConfirmedProgram = vi.fn().mockResolvedValue({
      outcome: "created",
      program: { id: programId, lockVersion: 1 }
    });
    registerMcpRoutes({
      fastify: authorizedFastify,
      issuer: "https://identity.example.test",
      resource: "https://api.example.test/api/mcp",
      authorizer: new McpAuthorizer(
        "https://identity.example.test",
        "https://unused.test/jwks",
        "https://api.example.test/api/mcp",
        {
          resolveAuthorizedPersons: async () => [
            {
              personId: "00000000-0000-4000-8000-000000000001",
              roles: ["owner"]
            }
          ]
        },
        createLocalJWKSet({
          keys: [{ ...jwk, kid: "training-program-v1", use: "sig" }]
        })
      ),
      personContext: new RequestPersonContext(),
      services: {
        ...unavailableServices,
        training: {
          ...unavailableServices.training,
          getTrainingContext,
          saveConfirmedProgram
        }
      }
    });
    const call = (id: number, name: string, args: Record<string, unknown>) =>
      authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args }
        }
      });
    const confirmedProgram = {
      expectedActiveProgramId: null,
      expectedLockVersion: null,
      name: "Confirmed A/B",
      note: null,
      workouts: [
        {
          name: "A",
          prescriptions: [
            {
              exerciseVersionId,
              loadBasis: "external_weight",
              targetWeightKg: 20,
              targetSets: 3,
              targetRepsMin: 8,
              targetRepsMax: 10,
              targetRir: 2,
              progressionIncrementKg: 2,
              note: null
            }
          ]
        }
      ]
    };

    try {
      const absent = (
        await call(200, "get_training_context", { historyLimit: 10 })
      ).json().result;
      expect(absent).toMatchObject({
        structuredContent: {
          status: "absent",
          program: null,
          recentSessions: { items: [{ id: "historical-session" }] },
          recentExternalActivities: [{ name: "Morning run" }]
        }
      });
      expect(absent.content[0].text).toContain(
        "historical evidence is proposal input only"
      );
      expect(absent.content[0].text).toContain(
        "never supplies exercises or sets"
      );

      const invalid = (
        await call(201, "save_confirmed_training_program", {
          ...confirmedProgram,
          expectedActiveProgramId: programId
        })
      ).json().result;
      expect(invalid).toMatchObject({ isError: true });
      expect(saveConfirmedProgram).not.toHaveBeenCalled();

      const saved = (
        await call(202, "save_confirmed_training_program", confirmedProgram)
      ).json().result;
      expect(saved).toMatchObject({
        structuredContent: {
          outcome: "created",
          program: { id: programId, lockVersion: 1 }
        }
      });
      expect(saved.content[0].text).toContain(
        "compare the complete snapshot before claiming success"
      );
      expect(saveConfirmedProgram).toHaveBeenCalledWith(confirmedProgram);

      const active = (
        await call(203, "get_training_context", {})
      ).json().result;
      expect(active).toMatchObject({
        structuredContent: {
          status: "active",
          program: { id: programId, lockVersion: 1 }
        }
      });
      expect(getTrainingContext).toHaveBeenNthCalledWith(1, {
        historyLimit: 10
      });
      expect(getTrainingContext).toHaveBeenNthCalledWith(2, {});

      const absentWithoutHistory = (
        await call(204, "get_training_context", {})
      ).json().result;
      expect(absentWithoutHistory).toMatchObject({
        structuredContent: {
          status: "absent",
          program: null,
          recentSessions: { items: [] },
          recentExternalActivities: []
        }
      });
      const unavailable = (
        await call(205, "get_training_context", {})
      ).json().result;
      expect(unavailable).toMatchObject({
        isError: true,
        content: [
          {
            text: expect.stringContaining(
              "Do not claim that an unverified read or failed change succeeded"
            )
          }
        ]
      });
      expect(unavailable.structuredContent).toBeUndefined();
    } finally {
      await authorizedFastify.close();
    }
  });

  it("normalizes connector-compatible Workout sets before domain dispatch", async () => {
    const authorizedFastify = Fastify();
    const pair = await generateKeyPair("ES256");
    const jwk = await exportJWK(pair.publicKey);
    const token = await new SignJWT({
      client_id: "chatgpt-runtime",
      scope: MCP_WORKOUT_WRITE_SCOPE
    })
      .setProtectedHeader({ alg: "ES256", kid: "workout-v1" })
      .setIssuer("https://identity.example.test")
      .setSubject("identity-account-1")
      .setAudience("https://api.example.test/api/mcp")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(pair.privateKey);
    const createWorkoutSession = vi.fn().mockResolvedValue({
      created: true,
      session: { id: "00000000-0000-4000-8000-000000000301" }
    });
    const correctWorkoutSession = vi.fn().mockResolvedValue({
      created: true,
      session: { id: "00000000-0000-4000-8000-000000000303" }
    });
    registerMcpRoutes({
      fastify: authorizedFastify,
      issuer: "https://identity.example.test",
      resource: "https://api.example.test/api/mcp",
      authorizer: new McpAuthorizer(
        "https://identity.example.test",
        "https://unused.test/jwks",
        "https://api.example.test/api/mcp",
        {
          resolveAuthorizedPersons: async () => [{
            personId: "00000000-0000-4000-8000-000000000001",
            roles: ["owner"]
          }]
        },
        createLocalJWKSet({
          keys: [{ ...jwk, kid: "workout-v1", use: "sig" }]
        })
      ),
      personContext: new RequestPersonContext(),
      services: {
        ...unavailableServices,
        training: {
          ...unavailableServices.training,
          createWorkoutSession,
          correctWorkoutSession
        }
      }
    });
    const workout = {
      occurredAt: "2000-01-01T07:00:00.000Z",
      timezone: "Europe/Moscow",
      programVersionId: null,
      workoutName: "Synthetic connector canary",
      feeling: null,
      note: null,
      exercises: [{
        exerciseVersionId: "00000000-0000-4000-8000-000000000302",
        loadBasis: "external_weight",
        feeling: null,
        note: null,
        sets: [{ reps: 1 }]
      }],
      sourceReference: {
        channel: "manual",
        externalSystem: "connector-canary",
        externalRecordId: "workout-record-1",
        occurredAt: "2000-01-01T07:00:00.000Z"
      },
      dedupeKey: "workout-record-1",
      confidence: 1
    };

    try {
      const response = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "record_workout_session", arguments: workout }
        }
      });

      expect(response.json().result).toMatchObject({
        content: [{ text: expect.stringContaining("sound like a real coach") }],
        structuredContent: { id: "00000000-0000-4000-8000-000000000301" }
      });
      expect(createWorkoutSession).toHaveBeenCalledWith({
        ...workout,
        exercises: [{
          ...workout.exercises[0],
          sets: [{
            weightKg: null,
            reps: 1,
            durationSeconds: null,
            distanceMeters: null,
            rir: null
          }]
        }]
      });
      const invalidSchemaResponse = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: 51,
          method: "tools/call",
          params: {
            name: "record_workout_session",
            arguments: { ...workout, workoutName: undefined }
          }
        }
      });
      expect(invalidSchemaResponse.json().result).toMatchObject({
        isError: true,
        content: [{
          text: expect.stringContaining("do not ask the user whether to save known work again")
        }]
      });
      expect(createWorkoutSession).toHaveBeenCalledOnce();
      const invalidResponse = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: {
            name: "record_workout_session",
            arguments: {
              ...workout,
              dedupeKey: "workout-record-invalid",
              exercises: [{ ...workout.exercises[0], sets: [{}] }]
            }
          }
        }
      });
      expect(invalidResponse.json().result).toMatchObject({
        isError: true,
        content: [{ text: expect.stringContaining("The requested fact was not saved") }]
      });
      expect(createWorkoutSession).toHaveBeenCalledOnce();
      const correction = {
        id: "00000000-0000-4000-8000-000000000301",
        ...workout,
        dedupeKey: "workout-correction-1",
        correctionReason: "Synthetic correction",
        exercises: [{ ...workout.exercises[0], sets: [{ reps: 2 }] }]
      };
      const correctionResponse = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: {
            name: "correct_workout_session",
            arguments: correction
          }
        }
      });
      expect(correctionResponse.json().result).toMatchObject({
        content: [{ text: expect.stringContaining("sound like a real coach") }],
        structuredContent: { id: "00000000-0000-4000-8000-000000000303" }
      });
      expect(correctWorkoutSession).toHaveBeenCalledWith(
        correction.id,
        {
          ...workout,
          dedupeKey: "workout-correction-1",
          correctionReason: "Synthetic correction",
          exercises: [{
            ...workout.exercises[0],
            sets: [{
              weightKg: null,
              reps: 2,
              durationSeconds: null,
              distanceMeters: null,
              rir: null
            }]
          }]
        }
      );
      const invalidCorrectionResponse = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: {
            name: "correct_workout_session",
            arguments: {
              ...correction,
              dedupeKey: "workout-correction-invalid",
              exercises: [{ ...workout.exercises[0], sets: [{}] }]
            }
          }
        }
      });
      expect(invalidCorrectionResponse.json().result).toMatchObject({
        isError: true,
        content: [{ text: expect.stringContaining("The requested fact was not saved") }]
      });
      expect(correctWorkoutSession).toHaveBeenCalledOnce();
    } finally {
      await authorizedFastify.close();
    }
  });

  it("completes a weight read with the post-expiry refreshed-token contract", async () => {
    const authorizedFastify = Fastify();
    const pair = await generateKeyPair("ES256");
    const jwk = await exportJWK(pair.publicKey);
    const expiredToken = await new SignJWT({
      client_id: "chatgpt-runtime",
      scope: MCP_READ_SCOPE
    })
      .setProtectedHeader({ alg: "ES256", kid: "refreshed-v1" })
      .setIssuer("https://identity.example.test")
      .setSubject("identity-account-1")
      .setAudience("https://api.example.test/api/mcp")
      .setIssuedAt(Math.floor(Date.now() / 1_000) - 601)
      .setExpirationTime(Math.floor(Date.now() / 1_000) - 1)
      .sign(pair.privateKey);
    const refreshedToken = await new SignJWT({
      client_id: "chatgpt-runtime",
      scope: MCP_READ_SCOPE
    })
      .setProtectedHeader({ alg: "ES256", kid: "refreshed-v1" })
      .setIssuer("https://identity.example.test")
      .setSubject("identity-account-1")
      .setAudience("https://api.example.test/api/mcp")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(pair.privateKey);
    const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    registerMcpRoutes({
      fastify: authorizedFastify,
      issuer: "https://identity.example.test",
      resource: "https://api.example.test/api/mcp",
      authorizer: new McpAuthorizer(
        "https://identity.example.test",
        "https://unused.test/jwks",
        "https://api.example.test/api/mcp",
        {
          resolveAuthorizedPersons: async () => [{
            personId: "00000000-0000-4000-8000-000000000001",
            roles: ["owner"]
          }]
        },
        createLocalJWKSet({
          keys: [{ ...jwk, kid: "refreshed-v1", use: "sig" }]
        })
      ),
      personContext: new RequestPersonContext(),
      services: {
        ...unavailableServices,
        weights: { ...unavailableServices.weights, list }
      }
    });

    try {
      const expiredResponse = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${expiredToken}`
        },
        payload: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "list_weight_measurements", arguments: {} }
        }
      });
      expect(expiredResponse.statusCode).toBe(200);
      expect(expiredResponse.json().result).toMatchObject({
        isError: true,
        _meta: {
          "mcp/www_authenticate": [expect.stringContaining('error="invalid_token"')]
        }
      });
      expect(list).not.toHaveBeenCalled();

      const response = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${refreshedToken}`
        },
        payload: {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "list_weight_measurements", arguments: {} }
        }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().result).toMatchObject({
        content: [{ text: expect.stringContaining("MUST end with one direct, concrete recommendation or next step") }],
        structuredContent: { items: [], nextCursor: null }
      });
      expect(list).toHaveBeenCalledOnce();

      const invalidInputResponse = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${refreshedToken}`
        },
        payload: {
          jsonrpc: "2.0",
          id: 41,
          method: "tools/call",
          params: { name: "list_weight_measurements", arguments: { limit: 0 } }
        }
      });
      expect(invalidInputResponse.json().result).toMatchObject({
        isError: true,
        content: [{
          text: expect.stringContaining("Retry once silently using the unambiguous facts already present")
        }]
      });
    } finally {
      await authorizedFastify.close();
    }
  });

  it("delivers the current Coach policy with every successful tool result", async () => {
    const authorizedFastify = Fastify();
    const pair = await generateKeyPair("ES256");
    const jwk = await exportJWK(pair.publicKey);
    const token = await new SignJWT({
      client_id: "chatgpt-runtime",
      scope: [
        MCP_READ_SCOPE,
        MCP_WEIGHT_WRITE_SCOPE,
        MCP_BODY_MEASUREMENT_WRITE_SCOPE,
        MCP_MEAL_WRITE_SCOPE,
        MCP_WORKOUT_WRITE_SCOPE,
        MCP_RECOVERY_WRITE_SCOPE,
        MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
        MCP_DAILY_RECOMMENDATION_FEEDBACK_WRITE_SCOPE,
        MCP_PERSON_TIMEZONE_WRITE_SCOPE
      ].join(" ")
    })
      .setProtectedHeader({ alg: "ES256", kid: "coach-policy-v1" })
      .setIssuer("https://identity.example.test")
      .setSubject("identity-account-1")
      .setAudience("https://api.example.test/api/mcp")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(pair.privateKey);
    const result = (marker: string) => ({ marker });
    const created = (key: string, marker: string) => ({
      created: true,
      [key]: result(marker)
    });
    const createWeight = vi.fn().mockResolvedValue(
      created("measurement", "record_weight_measurement")
    );
    const correctMeal = vi.fn().mockResolvedValue(
      created("meal", "correct_meal")
    );
    const readDailyAssessment = vi.fn<() => Promise<DailyAssessmentResult>>().mockResolvedValue({
      state: "timezone_required" as const,
      timezone: null
    });
    const updatePreferences = vi.fn().mockResolvedValue({
      timezone: "Europe/Belgrade",
      updatedAt: "2026-09-18T00:00:00.000Z"
    });
    const recordFeedback = vi.fn().mockResolvedValue({
      created: true,
      feedback: {
        id: "00000000-0000-4000-8000-000000000601",
        snapshotId: "00000000-0000-4000-8000-000000000501",
        personId: "00000000-0000-4000-8000-000000000001",
        actorPersonId: "00000000-0000-4000-8000-000000000001",
        status: "completed",
        comment: "Сделано без проблем",
        idempotencyKey: "coach-feedback-completed",
        reportedAt: "2026-09-02T10:00:00.000Z"
      }
    });
    const availableDailyAssessment: DailyAssessmentResult = {
      state: "available",
      snapshotId: "00000000-0000-4000-8000-000000000501",
      localDate: "2026-09-02",
      timezone: "Europe/Moscow",
      status: "caution",
      usedFacts: {
        recoveryObservationIds: [],
        recoveryAssessmentIds: [],
        workoutSessionIds: [],
        externalActivityIds: [],
        mealIds: [],
        weightMeasurementIds: [],
        activeTrainingProgramVersionId: null,
        dailyContextNoteIds: [],
        coveragePolicyVersion: "profile-data-coverage-v1",
        coverageReadiness: {
          sleep: "partial",
          hrv: "partial",
          restingHeartRate: "partial",
          bodyBattery: "partial",
          training: "good",
          weight: "partial",
          nutrition: "partial"
        },
        summary: {
          recoveryRiskLevel: "moderate",
          recoveryHardStop: false,
          sleepMinutes: 453,
          hrvMs: 55,
          hrvBaselineMs: 52,
          restingHeartRateBpm: 48,
          restingHeartRateBaselineBpm: 52,
          bodyBattery: 91,
          bodyBatteryMin: null,
          bodyBatteryMax: 91,
          recentWorkoutCount: 1,
          recentExternalActivityCount: 0,
          recentTrainingLoad: null,
          nutritionCompleteness: "partial",
          mealCount: 1,
          caloriesKcal: 375,
          proteinG: 21,
          latestWeightKg: 77.1
        }
      },
      missingImportantData: ["training_program"],
      reasons: ["recent_training_load", "partial_nutrition"],
      recommendedAction: {
        type: "complete_nutrition_record",
        text: "Record the next meal after eating.",
        trainingProgramVersionId: null
      },
      alternatives: [],
      limitations: ["not_medical_advice", "nutrition_records_may_be_incomplete"],
      confidence: 0.72,
      policyVersion: "daily-assessment-v3",
      personalBaseline: {
        policyKey: "balanced",
        policyVersion: "personal-baseline-v2",
        status: "partial",
        summary: "HRV is below the recent personal range.",
        comparisons: [
          { metric: "sleep_minutes", availability: "insufficient_history", position: null, severity: null, eligibleDayCount: 0, method: null },
          { metric: "hrv_rmssd", availability: "available", position: "below_usual", severity: "notable", eligibleDayCount: 14, method: "median_mad" },
          { metric: "resting_heart_rate", availability: "available", position: "within_usual", severity: "usual", eligibleDayCount: 14, method: "median_mad" },
          { metric: "body_battery", availability: "insufficient_history", position: null, severity: null, eligibleDayCount: 0, method: null },
          { metric: "body_battery_min", availability: "insufficient_history", position: null, severity: null, eligibleDayCount: 0, method: null },
          { metric: "body_battery_max", availability: "insufficient_history", position: null, severity: null, eligibleDayCount: 0, method: null },
          { metric: "training_load", availability: "incompatible", position: null, severity: null, eligibleDayCount: 0, method: null },
          { metric: "steps", availability: "available", position: "above_usual", severity: "notable", eligibleDayCount: 18, method: "median_mad" }
        ]
      },
      movement: {
        status: "available",
        summary: "Ты уже прошёл больше своего обычного полного дня.",
        current: {
          role: "partial_day",
          steps: 12_345,
          asOf: "2026-09-02T09:15:00.000Z",
          position: "above_full_day_usual",
          severity: "notable"
        }
      },
      evidenceChecksum: "a".repeat(64),
      createdAt: "2026-09-02T09:00:00.000Z"
    };
    registerMcpRoutes({
      fastify: authorizedFastify,
      issuer: "https://identity.example.test",
      resource: "https://api.example.test/api/mcp",
      authorizer: new McpAuthorizer(
        "https://identity.example.test",
        "https://unused.test/jwks",
        "https://api.example.test/api/mcp",
        {
          resolveAuthorizedPersons: async () => [{
            personId: "00000000-0000-4000-8000-000000000001",
            roles: ["owner"]
          }]
        },
        createLocalJWKSet({
          keys: [{ ...jwk, kid: "coach-policy-v1", use: "sig" }]
        })
      ),
      personContext: new RequestPersonContext(),
      services: {
        weights: {
          list: async () => result("list_weight_measurements"),
          create: createWeight,
          correct: async () => created("measurement", "correct_weight_measurement")
        },
        bodyMeasurements: {
          list: async () => result("list_body_measurements"),
          create: async () => created("session", "record_body_measurements"),
          correct: async () => created("session", "correct_body_measurements")
        },
        nutrition: {
          listMeals: async () => result("list_meals"),
          createMeal: async () => created("meal", "record_meal"),
          correctMeal
        },
        training: {
          findActiveProgram: async () => result("get_active_training_program"),
          listWorkoutSessions: async () => result("list_workout_sessions"),
          createWorkoutSession: async () => created("session", "record_workout_session"),
          correctWorkoutSession: async () => created("session", "correct_workout_session")
        },
        recovery: {
          listObservations: async () => result("list_recovery_observations"),
          createObservation: async () => created("observation", "record_recovery_observation"),
          correctObservation: async () => created("observation", "correct_recovery_observation")
        },
        currentRecoveryContext: {
          read: async () => ({
            state: "available",
            policyVersion: "connected-recovery-freshness-v2",
            calculatedAt: "2026-09-02T09:00:00.000Z",
            localDate: "2026-09-02",
            timezone: "Europe/Moscow",
            syncState: "fresh_success",
            targetDateDelivery: "record_without_supported_facts",
            checkedAt: "2026-09-02T08:59:00.000Z",
            metricDelivery: confirmedAbsentRecoveryMetrics,
            observations: { items: [safeCurrentRecoveryObservation] }
          })
        },
        dailyContextNotes: {
          list: async () => result("list_daily_context_notes"),
          create: async () => created("note", "record_daily_context_note"),
          correct: async () => created("note", "correct_daily_context_note")
        },
        dailyProjection: {
          projection: async () => result("get_daily_projection")
        },
        dailyAssessment: {
          read: readDailyAssessment,
          updatePreferences,
          recordFeedback
        }
      } as unknown as Parameters<typeof registerMcpRoutes>[0]["services"]
    });
    const sourceReference = {
      channel: "manual",
      externalSystem: null,
      externalRecordId: null,
      occurredAt: null
    };
    const weight = {
      measuredAt: "2026-09-02T06:00:00.000Z",
      timezone: "Europe/Moscow",
      weightKg: 77.1,
      sourceReference,
      dedupeKey: "coach-policy-weight"
    };
    const body = {
      measuredAt: "2026-09-02T06:01:00.000Z",
      timezone: "Europe/Moscow",
      values: [{ metric: "waist", value: 82, unit: "cm" }],
      sourceReference,
      dedupeKey: "coach-policy-body"
    };
    const meal = {
      occurredAt: "2026-09-02T07:00:00.000Z",
      timezone: "Europe/Moscow",
      kind: "breakfast",
      items: [{
        label: "Яйца",
        amountKind: "quantified",
        quantity: 2,
        unit: "piece",
        nutrients: { caloriesKcal: 156, proteinG: 12.6, fatG: 10.6, carbsG: 1.2 }
      }],
      sourceReference,
      dedupeKey: "coach-policy-meal"
    };
    const workout = {
      occurredAt: "2026-09-02T09:00:00.000Z",
      timezone: "Europe/Moscow",
      programVersionId: null,
      workoutName: "Workout A",
      feeling: null,
      note: null,
      exercises: [{
        exerciseVersionId: "00000000-0000-4000-8000-000000000301",
        loadBasis: "external_weight",
        feeling: null,
        note: null,
        sets: [{ reps: 10 }]
      }],
      sourceReference,
      dedupeKey: "coach-policy-workout",
      confidence: 1
    };
    const recovery = {
      kind: "metric",
      localDate: "2026-09-02",
      timezone: "Europe/Moscow",
      dedupeKey: "coach-policy-recovery",
      detail: { type: "metric", metric: "hrv_rmssd", value: 48, unit: "ms" }
    };
    const note = {
      localDate: "2026-09-02",
      timezone: "Europe/Moscow",
      text: "Busy work day",
      sourceReference,
      dedupeKey: "coach-policy-note"
    };
    const id = "00000000-0000-4000-8000-000000000401";
    const mealCorrection = {
      id,
      ...meal,
      dedupeKey: "coach-policy-meal-correction",
      reason: "Correction"
    };
    const cases = [
      ["list_weight_measurements", {}, "list_weight_measurements"],
      ["record_weight_measurement", weight, "record_weight_measurement"],
      ["correct_weight_measurement", { id, ...weight, dedupeKey: "coach-policy-weight-correction", reason: "Correction" }, "correct_weight_measurement"],
      ["list_body_measurements", {}, "list_body_measurements"],
      ["record_body_measurements", body, "record_body_measurements"],
      ["correct_body_measurements", { id, ...body, dedupeKey: "coach-policy-body-correction", reason: "Correction" }, "correct_body_measurements"],
      ["list_meals", { localDate: "2026-09-02" }, "list_meals"],
      ["record_meal", meal, "record_meal"],
      ["correct_meal", mealCorrection, "correct_meal"],
      ["get_active_training_program", {}, "get_active_training_program"],
      ["list_workout_sessions", { localDate: "2026-09-02" }, "list_workout_sessions"],
      ["record_workout_session", workout, "record_workout_session"],
      ["correct_workout_session", { id, ...workout, dedupeKey: "coach-policy-workout-correction", correctionReason: "Correction" }, "correct_workout_session"],
      ["list_recovery_observations", { localDate: "2026-09-02" }, "list_recovery_observations"],
      ["get_current_recovery_context", {}, "record_without_supported_facts"],
      ["record_recovery_observation", recovery, "record_recovery_observation"],
      ["correct_recovery_observation", { id, ...recovery, dedupeKey: "coach-policy-recovery-correction", reason: "Correction" }, "correct_recovery_observation"],
      ["list_daily_context_notes", { localDate: "2026-09-02" }, "list_daily_context_notes"],
      ["record_daily_context_note", note, "record_daily_context_note"],
      ["correct_daily_context_note", { id, ...note, dedupeKey: "coach-policy-note-correction", reason: "Correction" }, "correct_daily_context_note"],
      ["set_current_timezone", { timezone: "Europe/Belgrade" }, "Europe/Belgrade"],
      ["get_daily_assessment", {}, "timezone_required"],
      ["record_daily_recommendation_feedback", {
        snapshotId: "00000000-0000-4000-8000-000000000501",
        status: "completed",
        comment: "Сделано без проблем",
        idempotencyKey: "coach-feedback-completed"
      }, "completed"],
      ["get_daily_projection", { localDate: "2026-09-02", timezone: "Europe/Moscow" }, "get_daily_projection"]
    ] as const;

    const successfulContent = new Map<string, string>();

    try {
      for (const [index, [name, args, marker]] of cases.entries()) {
        const response = await authorizedFastify.inject({
          method: "POST",
          url: "/mcp",
          headers: {
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${token}`
          },
          payload: {
            jsonrpc: "2.0",
            id: 200 + index,
            method: "tools/call",
            params: { name, arguments: args }
          }
        });
        const toolResult = response.json().result;
        successfulContent.set(name, toolResult.content[0].text);
        expect(toolResult.isError, name).not.toBe(true);
        expect(toolResult.content[0].text, name).toContain(MCP_COACH_REPLY_POLICY);
        expect(toolResult.content[0].text, name).toContain(
          MCP_COACH_FINAL_RESPONSE_REQUIREMENT
        );
        expect(toolResult.content[0].text, name).toMatch(
          /MANDATORY FINAL REPLY:[\s\S]*never silently omit the next step\.$/u
        );
        if (name === "set_current_timezone") {
          expect(toolResult.structuredContent, name).toMatchObject({ timezone: marker });
          expect(toolResult.content[0].text, name).toContain(
            "Immediately retry the authoritative read"
          );
        } else if (name === "get_current_recovery_context") {
          expect(toolResult.structuredContent, name).toMatchObject({
            syncState: "fresh_success",
            targetDateDelivery: marker
          });
          expect(toolResult.content[0].text, name).toContain(
            "Never promise to check again later unless an automation was actually created"
          );
          expect(toolResult.content[0].text, name).toContain(
            "previously saved local value whose freshness has not yet been confirmed"
          );
          expect(toolResult.content[0].text, name).toContain(
            "do not infer whether reconnect, migration, or another delivery transition caused"
          );
          expect(toolResult.content[0].text, name).toContain(
            "Never call it a final, complete, or end-of-day total"
          );
          expectNoCurrentRecoveryIdentity(toolResult.structuredContent);
        } else if (name === "get_daily_assessment") {
          expect(toolResult.structuredContent, name).toEqual({
            state: "timezone_required",
            timezone: null
          });
          expect(toolResult.content[0].text, name).toContain(
            "Do not recalculate, replace, or embellish the policy decision"
          );
          expect(toolResult.content[0].text, name).toContain(
            "Do not add a duration, intensity, workout, medical rationale, trend, or substitute action"
          );
        } else if (name === "record_daily_recommendation_feedback") {
          expect(toolResult.structuredContent, name).toMatchObject({ status: marker });
          expect(toolResult.content[0].text, name).toContain(
            "feedback evidence only"
          );
        } else if (name === "get_daily_projection") {
          expect(toolResult.structuredContent, name).toMatchObject({ marker });
          expect(toolResult.content[0].text, name).toContain(
            'API-OWNED DAILY ASSESSMENT RESULT (exact JSON; preserve every decision field): {"state":"timezone_required","timezone":null}'
          );
        } else if (name === "get_active_training_program") {
          expect(toolResult.structuredContent, name).toMatchObject({
            status: "active",
            program: { marker }
          });
        } else {
          expect(toolResult.structuredContent, name).toMatchObject({ marker });
        }
      }

      for (const name of [
        "record_weight_measurement",
        "record_meal",
        "record_recovery_observation",
        "list_recovery_observations"
      ]) {
        expect(successfulContent.get(name), `morning flow: ${name}`).toMatch(
          /MANDATORY FINAL REPLY:[\s\S]*MUST end with one direct, concrete recommendation or next step[\s\S]*never silently omit the next step\.$/u
        );
      }
      expect(createWeight).toHaveBeenCalledWith(weight);
      expect(updatePreferences).toHaveBeenCalledWith({ timezone: "Europe/Belgrade" });
      expect(recordFeedback).toHaveBeenCalledWith({
        snapshotId: "00000000-0000-4000-8000-000000000501",
        status: "completed",
        comment: "Сделано без проблем",
        idempotencyKey: "coach-feedback-completed"
      });
      const readOnlyToken = await new SignJWT({
        client_id: "chatgpt-runtime",
        scope: MCP_READ_SCOPE
      })
        .setProtectedHeader({ alg: "ES256", kid: "coach-policy-v1" })
        .setIssuer("https://identity.example.test")
        .setSubject("identity-account-1")
        .setAudience("https://api.example.test/api/mcp")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(pair.privateKey);
      const deniedTimezoneWrite = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${readOnlyToken}`
        },
        payload: {
          jsonrpc: "2.0",
          id: "timezone-read-only-denied",
          method: "tools/call",
          params: {
            name: "set_current_timezone",
            arguments: { timezone: "Europe/Belgrade" }
          }
        }
      });
      expect(deniedTimezoneWrite.json().result).toMatchObject({
        isError: true,
        _meta: {
          "mcp/www_authenticate": [expect.stringContaining(
            'scope="person-timezone:write", error="insufficient_scope"'
          )]
        }
      });
      expect(updatePreferences).toHaveBeenCalledTimes(1);
      const deniedFeedbackWrite = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${readOnlyToken}`
        },
        payload: {
          jsonrpc: "2.0",
          id: "feedback-read-only-denied",
          method: "tools/call",
          params: {
            name: "record_daily_recommendation_feedback",
            arguments: {
              snapshotId: "00000000-0000-4000-8000-000000000501",
              status: "completed",
              idempotencyKey: "feedback-read-only-denied"
            }
          }
        }
      });
      expect(deniedFeedbackWrite.json().result).toMatchObject({
        isError: true,
        _meta: {
          "mcp/www_authenticate": [expect.stringContaining(
            'scope="daily-recommendation-feedback:write", error="insufficient_scope"'
          )]
        }
      });
      expect(recordFeedback).toHaveBeenCalledTimes(1);
      expect(readDailyAssessment).toHaveBeenCalledTimes(2);
      expect(successfulContent.get("record_weight_measurement")).toContain(
        "owning-domain read-back"
      );
      expect(successfulContent.get("list_meals")).toContain(
        "select the current matching Meal from this result"
      );
      expect(successfulContent.get("list_meals")).toContain(
        "no successful correction result has been returned for it"
      );
      expect(successfulContent.get("list_meals")).toContain(
        "must not reapply that correction"
      );
      expect(successfulContent.get("correct_meal")).toContain(
        "returned structured Meal is the canonical transaction result and sufficient typed verification"
      );
      expect(successfulContent.get("correct_meal")).toContain(
        "Do not call list_meals solely to prove that this correction succeeded"
      );

      const callMealCorrection = async (
        rpcId: string,
        arguments_: Record<string, unknown>
      ) => (await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: rpcId,
          method: "tools/call",
          params: { name: "correct_meal", arguments: arguments_ }
        }
      })).json().result;

      const invalidCorrection = await callMealCorrection(
        "invalid-meal-correction",
        {
          ...mealCorrection,
          dedupeKey: "coach-policy-meal-correction-invalid",
          items: [{
            label: "Meal",
            nutrients: {
              caloriesKcal: 100,
              proteinG: null,
              fatG: null,
              carbsG: null
            }
          }]
        }
      );
      expect(invalidCorrection).toMatchObject({
        isError: true,
        structuredContent: {
          state: "not_saved",
          reason: "invalid_replacement",
          recovery: "read_current_meal_rebuild_and_retry"
        }
      });
      expect(invalidCorrection.content[0].text).toContain(
        "select the current matching Meal"
      );
      expect(invalidCorrection.content[0].text).toContain(
        "never claim it was saved or promise to use the unpersisted value"
      );

      for (const [reason, error] of [
        ["conflict", new ConflictError("Meal was already superseded")],
        ["not-found", new NotFoundError("Meal was not found")]
      ] as const) {
        correctMeal.mockRejectedValueOnce(error);
        const staleCorrection = await callMealCorrection(
          `stale-meal-correction-${reason}`,
          {
            ...mealCorrection,
            dedupeKey: `coach-policy-meal-correction-${reason}`
          }
        );
        expect(staleCorrection).toMatchObject({
          isError: true,
          structuredContent: {
            state: "not_saved",
            reason: "stale_or_missing_target",
            recovery: "read_current_meal_rebuild_and_retry"
          }
        });
        expect(staleCorrection.content[0].text).toContain(
          "retry correct_meal once with the current id"
        );
      }

      correctMeal.mockRejectedValueOnce(new Error("temporary database failure"));
      const retryableCorrection = await callMealCorrection(
        "retryable-meal-correction",
        {
          ...mealCorrection,
          dedupeKey: "coach-policy-meal-correction-retryable"
        }
      );
      expect(retryableCorrection).toMatchObject({
        isError: true,
        structuredContent: {
          state: "not_saved",
          reason: "retryable_failure",
          recovery: "retry_same_correction_once"
        }
      });
      expect(retryableCorrection.content[0].text).toContain(
        "Retry the exact same correction once with the same idempotency key"
      );
      expect(retryableCorrection.content[0].text).toContain(
        "never claim it was saved or promise to use the unpersisted value"
      );

      readDailyAssessment.mockResolvedValueOnce(availableDailyAssessment);
      const directDailyAssessment = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: "direct-daily-assessment-v3",
          method: "tools/call",
          params: { name: "get_daily_assessment", arguments: {} }
        }
      });
      expect(directDailyAssessment.json().result.structuredContent).toEqual(
        availableDailyAssessment
      );
      expect(directDailyAssessment.json().result.structuredContent.movement.current)
        .toMatchObject({ role: "partial_day", steps: 12_345 });
      expect(directDailyAssessment.json().result.content[0].text).toContain(
        "Do not recalculate, replace, or embellish the policy decision"
      );

      readDailyAssessment.mockResolvedValueOnce(availableDailyAssessment);
      const compatibleDailyProjection = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: "compatible-daily-projection",
          method: "tools/call",
          params: {
            name: "get_daily_projection",
            arguments: { localDate: "2026-09-02", timezone: "Europe/Moscow" }
          }
        }
      });
      expect(compatibleDailyProjection.json().result).toMatchObject({
        structuredContent: { marker: "get_daily_projection" },
        content: [{ text: expect.stringContaining(JSON.stringify(availableDailyAssessment)) }]
      });
      expect(compatibleDailyProjection.json().result.content[0].text).toContain(
        "Do not recalculate, replace, or embellish the policy decision"
      );

      readDailyAssessment.mockResolvedValueOnce(availableDailyAssessment);
      const historicalDailyProjection = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: "historical-daily-projection",
          method: "tools/call",
          params: {
            name: "get_daily_projection",
            arguments: { localDate: "2026-09-01", timezone: "Europe/Moscow" }
          }
        }
      });
      expect(historicalDailyProjection.json().result.structuredContent).toEqual({
        marker: "get_daily_projection"
      });
      expect(historicalDailyProjection.json().result.content[0].text).not.toContain(
        availableDailyAssessment.snapshotId
      );
      expect(historicalDailyProjection.json().result.content[0].text).toContain(
        "FACTUAL-ONLY DAILY PROJECTION"
      );
      expect(historicalDailyProjection.json().result.content[0].text).not.toContain(
        MCP_COACH_FINAL_RESPONSE_REQUIREMENT
      );
      expect(historicalDailyProjection.json().result.content[0].text).not.toContain(
        "safest useful next action"
      );

      readDailyAssessment.mockRejectedValueOnce(new Error("assessment unavailable"));
      const projectionWithoutAssessment = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: "projection-without-assessment",
          method: "tools/call",
          params: {
            name: "get_daily_projection",
            arguments: { localDate: "2026-09-02", timezone: "Europe/Moscow" }
          }
        }
      });
      expect(projectionWithoutAssessment.json().result).toMatchObject({
        structuredContent: { marker: "get_daily_projection" },
        content: [{ text: expect.stringContaining("API-OWNED DAILY ASSESSMENT UNAVAILABLE") }]
      });
      expect(projectionWithoutAssessment.json().result.isError).not.toBe(true);
      expect(projectionWithoutAssessment.json().result.content[0].text).toContain(
        "ask them only to retry the assessment later"
      );
      expect(projectionWithoutAssessment.json().result.content[0].text).not.toContain(
        MCP_COACH_FINAL_RESPONSE_REQUIREMENT
      );
      expect(projectionWithoutAssessment.json().result.content[0].text).not.toContain(
        "safest useful next action"
      );

      readDailyAssessment.mockRejectedValueOnce(new Error("assessment unavailable"));
      const failedDailyAssessment = await authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id: "daily-assessment-failure",
          method: "tools/call",
          params: { name: "get_daily_assessment", arguments: {} }
        }
      });
      expect(failedDailyAssessment.json().result).toMatchObject({
        isError: true,
        content: [{ text: expect.stringContaining("could not be retrieved") }]
      });
      expect(failedDailyAssessment.json().result.structuredContent).toBeUndefined();
      for (const weightKg of ["77.1", 77.1234, 0.499, 700.001]) {
        const invalidResponse = await authorizedFastify.inject({
          method: "POST",
          url: "/mcp",
          headers: {
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${token}`
          },
          payload: {
            jsonrpc: "2.0",
            id: `invalid-weight-${weightKg}`,
            method: "tools/call",
            params: {
              name: "record_weight_measurement",
              arguments: { ...weight, weightKg }
            }
          }
        });
        expect(invalidResponse.json().result.isError, String(weightKg)).toBe(true);
      }
      expect(createWeight).toHaveBeenCalledOnce();
    } finally {
      await authorizedFastify.close();
    }
  }, 15_000);

  it("dispatches the new typed writer lifecycle through the authorized MCP adapter", async () => {
    const authorizedFastify = Fastify();
    const pair = await generateKeyPair("ES256");
    const jwk = await exportJWK(pair.publicKey);
    const token = await new SignJWT({
      client_id: "chatgpt-runtime",
      scope: [
        MCP_READ_SCOPE,
        MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
        MCP_MEAL_WRITE_SCOPE,
        MCP_RECOVERY_WRITE_SCOPE
      ].join(" ")
    })
      .setProtectedHeader({ alg: "ES256", kid: "writer-v1" })
      .setIssuer("https://identity.example.test")
      .setSubject("identity-account-1")
      .setAudience("https://api.example.test/api/mcp")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(pair.privateKey);
    const findActiveProgram = vi.fn()
      .mockResolvedValueOnce({ id: "active-program" })
      .mockRejectedValueOnce(new NotFoundError("Active TrainingProgram was not found"))
      .mockRejectedValueOnce(new Error("Training repository unavailable"));
    const create = vi.fn().mockResolvedValue({
      created: true,
      note: { id: "00000000-0000-4000-8000-000000000201" }
    });
    const correct = vi.fn().mockResolvedValue({
      created: true,
      note: { id: "00000000-0000-4000-8000-000000000202" }
    });
    const listNotes = vi.fn().mockResolvedValue({ items: [] });
    const projection = vi.fn().mockResolvedValue({
      localDate: "2026-09-02",
      timezone: "Europe/Moscow",
      asOf: "2026-09-02T12:00:00.000Z",
      snapshot: {}
    });
    const originalMeal = {
      id: "00000000-0000-4000-8000-000000000203",
      description: "Ужин",
      items: [
        {
          label: "Стейк лосося",
          amountKind: "estimated",
          quantity: 220,
          unit: "g",
          amountDescription: "оценка по фото",
          estimateMethod: "photo",
          amountConfidence: 0.75,
          nutrients: { caloriesKcal: 455, proteinG: 48, fatG: 28, carbsG: 0 }
        },
        {
          label: "Красное вино",
          amountKind: "quantified",
          quantity: 150,
          unit: "ml",
          amountDescription: null,
          estimateMethod: null,
          amountConfidence: null,
          nutrients: { caloriesKcal: 125, proteinG: 0, fatG: 0, carbsG: 4 }
        }
      ]
    };
    const correctedMeal = {
      ...originalMeal,
      id: "00000000-0000-4000-8000-000000000204",
      supersedesId: originalMeal.id,
      items: [{
        ...originalMeal.items[0],
        amountKind: "quantified",
        quantity: 200,
        unit: "g",
        amountDescription: null,
        estimateMethod: null,
        amountConfidence: null,
        nutrients: { caloriesKcal: 414, proteinG: 44, fatG: 25.5, carbsG: 0 }
      }]
    };
    const photoMeal = {
      id: "00000000-0000-4000-8000-000000000205",
      description: "Ужин по фото",
      items: [
        { label: "Картофельное пюре", quantity: 220, unit: "g", caloriesKcal: 240, proteinG: 4, fatG: 8, carbsG: 38, confidence: 0.7 },
        { label: "Мясо", quantity: 170, unit: "g", caloriesKcal: 330, proteinG: 34, fatG: 20, carbsG: 3, confidence: 0.55 },
        { label: "Зелёный горошек", quantity: 90, unit: "g", caloriesKcal: 72, proteinG: 4.5, fatG: 0.4, carbsG: 12.5, confidence: 0.75 },
        { label: "Огурцы", quantity: 80, unit: "g", caloriesKcal: 12, proteinG: 0.5, fatG: 0.1, carbsG: 2.4, confidence: 0.75 },
        { label: "Помидоры", quantity: 80, unit: "g", caloriesKcal: 14, proteinG: 0.7, fatG: 0.2, carbsG: 3, confidence: 0.75 }
      ].map((item) => ({
        label: item.label,
        amountKind: "estimated",
        quantity: item.quantity,
        unit: item.unit,
        amountDescription: "оценка по фото",
        estimateMethod: "photo",
        amountConfidence: item.confidence,
        nutrients: {
          caloriesKcal: item.caloriesKcal,
          proteinG: item.proteinG,
          fatG: item.fatG,
          carbsG: item.carbsG
        }
      }))
    };
    const createMeal = vi.fn()
      .mockResolvedValueOnce({ created: true, meal: originalMeal })
      .mockResolvedValueOnce({ created: true, meal: photoMeal })
      .mockResolvedValueOnce({ created: true, meal: originalMeal });
    const correctMeal = vi.fn().mockResolvedValue({ created: true, meal: correctedMeal });
    const listMeals = vi.fn()
      .mockResolvedValueOnce({ items: [originalMeal], nextCursor: null })
      .mockResolvedValueOnce({ items: [correctedMeal], nextCursor: null })
      .mockResolvedValueOnce({ items: [photoMeal], nextCursor: null });
    const recoveryObservations: RecoveryObservation[] = [];
    const createObservation = vi.fn(async (input: CreateRecoveryObservation) => {
      const observation = {
        id: `00000000-0000-4000-8000-${String(300 + recoveryObservations.length).padStart(12, "0")}`,
        personId: "00000000-0000-4000-8000-000000000001",
        localDate: input.localDate ?? "2026-08-31",
        temporalPrecision: input.temporalPrecision ?? "local_date",
        supersedesId: null,
        correctionReason: null,
        createdAt: "2026-08-31T09:00:00.000Z",
        ...input
      } as RecoveryObservation;
      recoveryObservations.push(observation);
      return { created: true, observation };
    });
    const listObservations = vi.fn(async (query: ListRecoveryObservationsQuery) => ({
      items: recoveryObservations.filter((observation) =>
        query.localDate === undefined || observation.localDate === query.localDate
      ),
      nextCursor: null
    }));
    registerMcpRoutes({
      fastify: authorizedFastify,
      issuer: "https://identity.example.test",
      resource: "https://api.example.test/api/mcp",
      authorizer: new McpAuthorizer(
        "https://identity.example.test",
        "https://unused.test/jwks",
        "https://api.example.test/api/mcp",
        {
          resolveAuthorizedPersons: async () => [{
            personId: "00000000-0000-4000-8000-000000000001",
            roles: ["owner"]
          }]
        },
        createLocalJWKSet({
          keys: [{ ...jwk, kid: "writer-v1", use: "sig" }]
        })
      ),
      personContext: new RequestPersonContext(),
      services: {
        ...unavailableServices,
        training: { ...unavailableServices.training, findActiveProgram },
        dailyContextNotes: {
          ...unavailableServices.dailyContextNotes,
          list: listNotes,
          create,
          correct
        },
        dailyProjection: { projection },
        nutrition: { listMeals, createMeal, correctMeal },
        recovery: {
          ...unavailableServices.recovery,
          listObservations,
          createObservation
        }
      }
    });

    const call = async (id: number, name: string, args: Record<string, unknown>) =>
      authorizedFastify.inject({
        method: "POST",
        url: "/mcp",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`
        },
        payload: {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args }
        }
      });
    const note = {
      localDate: "2026-08-26",
      timezone: "Europe/Moscow",
      text: "Early bedtime.",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: null
      },
      dedupeKey: "chatgpt:daily-note:2026-08-26"
    };
    const dinner = {
      occurredAt: "2026-08-30T16:05:00.000Z",
      timezone: "Europe/Moscow",
      kind: "dinner",
      description: "Стейк лосося и 150 мл красного вина",
      items: originalMeal.items,
      dedupeKey: "chatgpt:meal:dinner:2026-08-30:1905"
    };
    const normalizedDinner = {
      ...dinner,
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-08-30T16:05:00.000Z"
      },
      items: originalMeal.items.map((item) => ({
        foodVersionId: null,
        ...item
      }))
    };
    const photoDinner = {
      occurredAt: "2026-08-31T16:47:00.000Z",
      timezone: "Europe/Moscow",
      kind: "dinner",
      description: "Картофельное пюре, мясо, зелёный горошек, огурцы и помидоры",
      items: photoMeal.items.map((item) => ({
        label: item.label,
        amountKind: item.amountKind,
        quantity: item.quantity,
        unit: item.unit,
        amountDescription: item.amountDescription,
        estimateMethod: item.estimateMethod,
        amountConfidence: item.amountConfidence,
        nutrients: item.nutrients
      })),
      dedupeKey: "chatgpt:meal:dinner:2026-08-31:1947:photo"
    };
    const normalizedPhotoDinner = {
      ...photoDinner,
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-08-31T16:47:00.000Z"
      },
      items: photoMeal.items.map((item) => ({
        foodVersionId: null,
        ...item
      }))
    };
    const legacyDinner = {
      ...dinner,
      items: originalMeal.items.map((item) => ({
        label: item.label,
        quantity: item.quantity,
        unit: item.unit,
        nutrients: item.nutrients
      })),
      dedupeKey: "chatgpt:meal:dinner:2026-08-30:1905:legacy-client"
    };
    const normalizedLegacyDinner = {
      ...legacyDinner,
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-08-30T16:05:00.000Z"
      },
      items: legacyDinner.items.map((item) => ({
        foodVersionId: null,
        ...item,
        amountKind: "quantified",
        amountDescription: null,
        estimateMethod: null,
        amountConfidence: null
      }))
    };

    try {
      const activeProgramResult = (await call(
        5,
        "get_active_training_program",
        {}
      )).json().result;
      expect(activeProgramResult).toMatchObject({
          structuredContent: {
            status: "active",
            program: { id: "active-program" }
          }
        });
      expect(activeProgramResult.content[0].text).toContain(MCP_COACH_REPLY_POLICY);
      expect((await call(6, "get_active_training_program", {})).json().result)
        .toMatchObject({
          structuredContent: { status: "absent", program: null }
        });
      expect((await call(7, "get_active_training_program", {})).json().result)
        .toMatchObject({
          isError: true,
          content: [{ text: expect.stringContaining("The requested current facts could not be retrieved") }]
        });
      const noteWriteResult = (await call(
        8,
        "record_daily_context_note",
        note
      )).json().result;
      expect(noteWriteResult).toMatchObject({
          structuredContent: { id: "00000000-0000-4000-8000-000000000201" }
        });
      expect(noteWriteResult.content[0].text).toContain(MCP_COACH_REPLY_POLICY);
      expect((await call(9, "correct_daily_context_note", {
        id: "00000000-0000-4000-8000-000000000201",
        ...note,
        text: "Went to bed early.",
        dedupeKey: "chatgpt:daily-note:2026-08-26:correction:1",
        reason: "Clarified wording"
      })).json().result).toMatchObject({
        structuredContent: { id: "00000000-0000-4000-8000-000000000202" }
      });
      const noteReadResult = (await call(90, "list_daily_context_notes", {
        localDate: "2026-08-26"
      })).json().result;
      expect(noteReadResult.content[0].text).toContain(MCP_COACH_REPLY_POLICY);
      const dailyProjectionResult = (await call(91, "get_daily_projection", {
        localDate: "2026-09-02",
        timezone: "Europe/Moscow"
      })).json().result;
      expect(dailyProjectionResult).toMatchObject({
        structuredContent: {
          localDate: "2026-09-02",
          timezone: "Europe/Moscow"
        }
      });
      expect(dailyProjectionResult.content[0].text).toContain(
        "API-OWNED DAILY ASSESSMENT UNAVAILABLE"
      );
      expect(dailyProjectionResult.content[0].text).toContain(
        "Do not derive a status or propose any nutrition, training, recovery, medical, or other next action"
      );
      expect(dailyProjectionResult.content[0].text).not.toContain(
        "give one clear Next step plus bounded nutrition, training, and recovery guidance"
      );
      expect(dailyProjectionResult.content[0].text).not.toContain(MCP_COACH_REPLY_POLICY);
      expect(dailyProjectionResult.content[0].text).not.toContain(
        MCP_COACH_FINAL_RESPONSE_REQUIREMENT
      );
      expect((await call(10, "record_meal", {
        ...dinner,
        items: [{
          label: "Овощи",
          amountKind: "unknown",
          quantity: 1,
          unit: "serving"
        }],
        dedupeKey: "chatgpt:meal:dinner:2026-08-30:invalid"
      })).json().result).toMatchObject({
        isError: true,
        content: [{ text: expect.stringContaining("do not save an incomplete Meal") }]
      });
      expect(createMeal).not.toHaveBeenCalled();
      const incompleteTeriyakiLunchResult = (await call(101, "record_meal", {
        occurredAt: "2026-09-02T09:35:00.000Z",
        timezone: "Europe/Moscow",
        kind: "lunch",
        description: "Курица терияки с рисом, свежие огурцы и помидоры",
        items: [
          {
            label: "Курица терияки с рисом",
            amountKind: "estimated",
            quantity: 350,
            unit: "g",
            amountDescription: "оценка по фото",
            estimateMethod: "photo",
            amountConfidence: 0.7
          },
          {
            label: "Свежие огурцы и помидоры",
            amountKind: "estimated",
            quantity: 160,
            unit: "g",
            amountDescription: "оценка по фото",
            estimateMethod: "photo",
            amountConfidence: 0.75
          }
        ],
        dedupeKey: "chatgpt:meal:lunch:2026-09-02:1235:photo"
      })).json().result;
      expect(incompleteTeriyakiLunchResult).toMatchObject({
        isError: true,
        content: [{ text: expect.stringContaining("photo and text already present") }]
      });
      expect(incompleteTeriyakiLunchResult.content[0].text).toContain(
        "numeric best-effort calories, protein, fat, and carbohydrates"
      );
      expect(incompleteTeriyakiLunchResult.content[0].text).toContain(
        "Do not ask the user for values that can be reasonably estimated"
      );
      expect(incompleteTeriyakiLunchResult.content[0].text.toLowerCase())
        .not.toContain("partial");
      expect(createMeal).not.toHaveBeenCalled();
      const recordMealResult = (await call(11, "record_meal", dinner)).json().result;
      expect(recordMealResult).toMatchObject({ structuredContent: originalMeal });
      expect(recordMealResult.content).toEqual([{
        type: "text",
        text: expect.stringContaining("sound like a real coach")
      }]);
      expect(recordMealResult.content[0].text.trim().startsWith("{")).toBe(false);
      const firstMealReadResult = (await call(12, "list_meals", {
        localDate: "2026-08-30"
      })).json().result;
      expect(firstMealReadResult)
        .toMatchObject({ structuredContent: { items: [originalMeal] } });
      expect(firstMealReadResult.content).toEqual([{
        type: "text",
        text: expect.stringContaining("MUST end with one direct, concrete recommendation or next step")
      }]);
      const forbiddenMealPresentationTerms = [
        "partial",
        "null",
        "list_meals",
        "typed",
        "read-back",
        "staging",
        "api",
        "contract",
        "tool",
        "schema"
      ];
      for (const presentation of [
        recordMealResult.content[0].text,
        firstMealReadResult.content[0].text
      ]) {
        expect(presentation.trim().startsWith("{")).toBe(false);
        for (const forbidden of forbiddenMealPresentationTerms) {
          expect(presentation.toLowerCase()).not.toContain(forbidden);
        }
      }
      const correction = {
        ...dinner,
        id: originalMeal.id,
        items: [{
          label: "Стейк лосося",
          amountKind: "quantified",
          quantity: 200,
          unit: "g",
          nutrients: { caloriesKcal: 414, proteinG: 44, fatG: 25.5, carbsG: 0 }
        }],
        dedupeKey: "chatgpt:meal:dinner:2026-08-30:1905:correction:1",
        reason: "Пользователь уточнил объём и калорийность"
      };
      const incompleteCorrectionResult = (await call(102, "correct_meal", {
        ...correction,
        items: [{
          label: "Стейк лосося",
          amountKind: "quantified",
          quantity: 200,
          unit: "g",
          nutrients: { caloriesKcal: 414, proteinG: null, fatG: null, carbsG: null }
        }],
        dedupeKey: "chatgpt:meal:dinner:2026-08-30:1905:correction:invalid"
      })).json().result;
      expect(incompleteCorrectionResult).toMatchObject({ isError: true });
      expect(incompleteCorrectionResult.content[0].text.toLowerCase())
        .not.toContain("partial");
      expect(correctMeal).not.toHaveBeenCalled();
      const correctMealResult = (await call(13, "correct_meal", correction)).json().result;
      expect(correctMealResult).toMatchObject({ structuredContent: correctedMeal });
      expect(correctMealResult.content[0].text).toContain("sound like a real coach");
      const correctedMealReadResult = (await call(14, "list_meals", {
        localDate: "2026-08-30"
      })).json().result;
      expect(correctedMealReadResult)
        .toMatchObject({ structuredContent: { items: [correctedMeal] } });
      expect(correctedMealReadResult.content[0].text)
        .toContain("MUST end with one direct, concrete recommendation or next step");
      const photoMealResult = (await call(140, "record_meal", photoDinner)).json().result;
      expect(photoMealResult).toMatchObject({ structuredContent: photoMeal });
      expect(photoMealResult.content[0].text).toContain(
        "Do not say calories are unavailable merely because exact grams were not measured"
      );
      expect(createMeal).toHaveBeenNthCalledWith(2, normalizedPhotoDinner);
      for (const item of normalizedPhotoDinner.items) {
        expect(item).toMatchObject({
          amountKind: "estimated",
          estimateMethod: "photo",
          amountConfidence: expect.any(Number),
          nutrients: {
            caloriesKcal: expect.any(Number),
            proteinG: expect.any(Number),
            fatG: expect.any(Number),
            carbsG: expect.any(Number)
          }
        });
      }
      const photoMealReadResult = (await call(141, "list_meals", {
        localDate: "2026-08-31"
      })).json().result;
      expect(photoMealReadResult).toMatchObject({
        structuredContent: { items: [photoMeal] }
      });
      expect(photoMealReadResult.content[0].text).toContain(
        "Use stored estimates as approximate values"
      );
      const legacyMealResult = (await call(142, "record_meal", legacyDinner)).json().result;
      expect(legacyMealResult).toMatchObject({ structuredContent: originalMeal });
      expect(createMeal).toHaveBeenNthCalledWith(3, normalizedLegacyDinner);
      const legacyCorrection = {
        ...legacyDinner,
        id: originalMeal.id,
        dedupeKey: "chatgpt:meal:dinner:2026-08-30:1905:legacy-client:correction:1",
        reason: "Legacy client correction"
      };
      const legacyCorrectionResult = (await call(
        143,
        "correct_meal",
        legacyCorrection
      )).json().result;
      expect(legacyCorrectionResult).toMatchObject({ structuredContent: correctedMeal });
      expect(correctMeal).toHaveBeenNthCalledWith(2, originalMeal.id, {
        ...normalizedLegacyDinner,
        dedupeKey: legacyCorrection.dedupeKey,
        reason: legacyCorrection.reason
      });
      const invalidSleepScoreResult = (await call(15, "record_recovery_observation", {
        kind: "metric",
        localDate: "2026-08-31",
        timezone: "Europe/Moscow",
        dedupeKey: "chatgpt:recovery:sleep-score:2026-08-31:invalid",
        detail: { type: "metric", metric: "sleep_score", value: 101, unit: "score" }
      })).json().result;
      expect(invalidSleepScoreResult).toMatchObject({
        isError: true,
        content: [{ text: expect.stringContaining("Continue saving the other independent facts") }]
      });
      expect(createObservation).not.toHaveBeenCalled();
      const recoveryFacts = [
        {
          kind: "sleep",
          dedupeKey: "chatgpt:recovery:sleep:2026-08-31",
          detail: { type: "sleep", totalSleepMinutes: 474, sleepQuality: 4 },
          connectionId: "00000000-0000-4000-8000-000000000301",
          consentId: "00000000-0000-4000-8000-000000000302",
          sourceReference: {
            channel: "device",
            externalSystem: "garmin-screenshot",
            externalRecordId: "2026-08-31-sleep",
            occurredAt: null
          }
        },
        {
          kind: "metric",
          dedupeKey: "chatgpt:recovery:sleep-score:2026-08-31",
          detail: { type: "metric", metric: "sleep_score", value: 86, unit: "score" }
        },
        {
          kind: "metric",
          dedupeKey: "chatgpt:recovery:hrv:2026-08-31",
          detail: { type: "metric", metric: "hrv_rmssd", value: 48, unit: "ms" },
          sourceReference: {
            channel: "device",
            externalSystem: "garmin-screenshot",
            externalRecordId: "2026-08-31-hrv",
            occurredAt: null
          }
        },
        {
          kind: "metric",
          dedupeKey: "chatgpt:recovery:night-heart-rate:2026-08-31",
          detail: { type: "metric", metric: "night_heart_rate", value: 59, unit: "bpm" }
        },
        {
          kind: "metric",
          dedupeKey: "chatgpt:recovery:respiration-rate:2026-08-31",
          detail: { type: "metric", metric: "respiration_rate", value: 13.8, unit: "breaths_per_minute" }
        },
        {
          kind: "metric",
          dedupeKey: "chatgpt:recovery:oxygen-saturation:2026-08-31",
          detail: { type: "metric", metric: "oxygen_saturation", value: 95, unit: "percent" }
        },
        {
          kind: "metric",
          dedupeKey: "chatgpt:recovery:temperature-deviation:2026-08-31",
          detail: { type: "metric", metric: "temperature_deviation", value: 0, unit: "celsius" }
        }
      ];
      for (const [index, fact] of recoveryFacts.entries()) {
        const result = (await call(16 + index, "record_recovery_observation", {
          ...fact,
          localDate: "2026-08-31",
          timezone: "Europe/Moscow"
        })).json().result;
        expect(result.isError, JSON.stringify({ index, fact, result })).not.toBe(true);
        expect(result.content[0].text).toContain("sound like a real coach");
        expect(result.content[0].text.toLowerCase()).not.toContain("api");
      }
      const recoveryReadResult = (await call(23, "list_recovery_observations", {
        localDate: "2026-08-31"
      })).json().result;
      expect(recoveryReadResult.structuredContent.items).toHaveLength(7);
      expect(recoveryReadResult.content[0].text)
        .toContain("MUST end with one direct, concrete recommendation or next step");
      expect(recoveryReadResult.content[0].text.toLowerCase()).not.toContain("schema");
      expect(createObservation).toHaveBeenNthCalledWith(1, expect.objectContaining({
        observedFrom: null,
        observedUntil: null,
        temporalPrecision: "local_date",
        localDate: "2026-08-31",
        quality: "reliable",
        connectionId: null,
        consentId: null,
        sourceReference: {
          channel: "manual",
          externalSystem: null,
          externalRecordId: null,
          occurredAt: null
        },
        detail: {
          type: "sleep",
          totalSleepMinutes: 474,
          deepSleepMinutes: null,
          remSleepMinutes: null,
          lightSleepMinutes: null,
          sleepQuality: null
        }
      }));
      expect(createObservation).toHaveBeenNthCalledWith(3, expect.objectContaining({
        connectionId: null,
        consentId: null,
        sourceReference: {
          channel: "manual",
          externalSystem: null,
          externalRecordId: null,
          occurredAt: null
        },
        detail: {
          type: "metric",
          metric: "hrv_rmssd",
          value: 48,
          unit: "ms"
        }
      }));
      expect(createObservation).toHaveBeenNthCalledWith(2, expect.objectContaining({
        detail: { type: "metric", metric: "sleep_score", value: 86, unit: "score" }
      }));
      expect(listObservations).toHaveBeenCalledWith({ localDate: "2026-08-31" });
      expect(findActiveProgram).toHaveBeenCalledTimes(3);
      expect(create).toHaveBeenCalledWith(note);
      expect(correct).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000201",
        expect.objectContaining({ reason: "Clarified wording" })
      );
      expect(listNotes).toHaveBeenCalledWith({ localDate: "2026-08-26" });
      expect(projection).toHaveBeenCalledWith({
        localDate: "2026-09-02",
        timezone: "Europe/Moscow"
      });
      expect(createMeal).toHaveBeenCalledTimes(3);
      expect(createMeal).toHaveBeenNthCalledWith(1, normalizedDinner);
      expect(listMeals).toHaveBeenCalledTimes(3);
      expect(correctMeal).toHaveBeenCalledWith(
        originalMeal.id,
        expect.objectContaining({
          reason: "Пользователь уточнил объём и калорийность",
          items: [{
            foodVersionId: null,
            label: "Стейк лосося",
            amountKind: "quantified",
            quantity: 200,
            unit: "g",
            amountDescription: null,
            estimateMethod: null,
            amountConfidence: null,
            nutrients: { caloriesKcal: 414, proteinG: 44, fatG: 25.5, carbsG: 0 }
          }]
        })
      );
    } finally {
      await authorizedFastify.close();
    }
  }, 15_000);
});
