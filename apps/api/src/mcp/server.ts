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
  CreateMealSchema,
  CreateRecoveryObservationSchema,
  CreateWeightMeasurementSchema,
  CreateWorkoutSessionSchema,
  DailyContextNoteListSchema,
  DailyProjectionQuerySchema,
  DailyProjectionSchema,
  ListDailyContextNotesQuerySchema,
  ListBodyMeasurementSessionsQuerySchema,
  ListMealsQuerySchema,
  ListRecoveryObservationsQuerySchema,
  ListWeightMeasurementsQuerySchema,
  ListWorkoutSessionsQuerySchema,
  MealListSchema,
  RecoveryObservationListSchema,
  TrainingProgramSchema,
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
  type CreateMeal,
  type CreateRecoveryObservation,
  type CreateWeightMeasurement,
  type CreateWorkoutSession,
  type DailyProjectionQuery,
  type ListDailyContextNotesQuery,
  type ListBodyMeasurementSessionsQuery,
  type ListMealsQuery,
  type ListRecoveryObservationsQuery,
  type ListWeightMeasurementsQuery,
  type ListWorkoutSessionsQuery,
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
import { NotFoundError } from "../domain/errors.js";
import {
  MCP_BODY_MEASUREMENT_WRITE_SCOPE,
  MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
  MCP_MEAL_WRITE_SCOPE,
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
  readonly training: Pick<TrainingService, "listWorkoutSessions" | "createWorkoutSession" | "correctWorkoutSession" | "findActiveProgram">;
  readonly recovery: Pick<RecoveryService, "listObservations" | "createObservation" | "correctObservation">;
  readonly dailyContextNotes: Pick<DailyContextNoteService, "list" | "create" | "correct">;
  readonly dailyProjection: Pick<DailyProjectionService, "projection">;
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
  "Исправил обед. Если захочешь точнее оценить порции, позже пришли фото или просто опиши их размер.",
  "Записал ужин: лосось, кукурузу, овощи, ягоды и бокал вина. Хороший набор белка и овощей; после вина сегодня лучше перейти на воду и оставить вечер спокойным.",
  "Записал сон 7 ч 54 мин, оценку 86, HRV 48 мс, ночной пульс 59, дыхание 13,8, SpO₂ 95% и температуру без отклонения. Восстановление выглядит неплохо; сегодня можно держать обычный темп и свериться с самочувствием перед тренировкой."
] as const;

const mealWriteResultContent =
  "The reported meal has been saved. Continue the required workflow silently before replying. " +
  "In the final reply, use the user's language and sound like a real coach in one or two natural sentences: " +
  "acknowledge what was eaten, then add one useful evidence-grounded observation or next step when the facts support it. " +
  "Do not invent calories, nutrients, or portions, and never discuss internal mechanics.";

const mealReadResultContent =
  "Use these meal facts silently. If this completes a routine meal capture or correction, reply in the user's language " +
  "and sound like a real coach in one or two natural sentences: acknowledge what was eaten, then add one useful " +
  "evidence-grounded observation or next step when the facts support it. Do not invent calories, nutrients, or portions, " +
  "and never discuss internal mechanics.";

const recoveryWriteResultContent =
  "The reported recovery fact has been saved. Continue capturing every other independent fact from the same report " +
  "before replying, even if one separate fact could not be saved. Then complete the required day-level check silently. " +
  "In the final reply, use the user's language and sound like a real coach: briefly acknowledge the useful recovery picture " +
  "and add one evidence-grounded observation or next step. Do not invent values or discuss internal mechanics.";

const recoveryReadResultContent =
  "Use these recovery facts silently. If this completes a routine recovery capture, reply in the user's language and sound " +
  "like a real coach: summarize the useful recovery picture and add one evidence-grounded observation or next step. " +
  "Do not list internal states, missing bookkeeping, or implementation mechanics.";

/** Durable operational policy published by the API-owned MCP server. */
export const MCP_OPERATIONAL_INSTRUCTIONS =
  "Shape of You PostgreSQL is the operational authority and this MCP is its only interactive writer. " +
  "Keep internal mechanics invisible in user-facing replies, including tool, schema, status, identifier, storage, API, and implementation details. " +
  "Match the user's language. After a routine fact capture or correction, answer like a real coach in one or two natural sentences: acknowledge the fact and add one useful evidence-grounded observation or next step when supported; never invent precision. " +
  "The Google Sheets Fitness Tracker is a non-authoritative read-only legacy reference: never use it as current truth, a write target, or a fallback. " +
  "Use only the authorized Person-scoped typed tools. A direct relevant user report authorizes one routine low-risk idempotent create or correction without a duplicate confirmation question. Always read back successful writes and fail closed when MCP authorization, a required tool, or read-back is unavailable or inconsistent. " +
  "A routine create does not require a pre-read. After a Meal write, call list_meals with localDate only for read-back; do not pass timezone or write fields to list_meals. " +
  "For a Recovery text or screenshot report, record every unambiguous sleep and metric fact as an independent observation with a deterministic dedupe key, then call list_recovery_observations with localDate only to verify the expected set. Continue with the other independent facts if one fact fails. A wearable sleep score uses metric sleep_score with unit score; never put a 0..100 device score into the subjective 1..5 sleepQuality field. When no real interval is known, use exact localDate and timezone without inventing timestamps. " +
  "For Daily Coach, require an exact local date and IANA timezone and call get_daily_projection first, followed only by the typed reads needed for the answer. " +
  "Present Planned, Proposed now, and Actually completed separately: only typed plan artifacts such as the active TrainingProgram are planned, conversation advice is proposed, and only owning-domain facts verified by typed reads are completed; an accepted recommendation is not executed. " +
  "Give one clear Next step plus at most one bounded nutrition, training, and recovery proposal grounded in available evidence, and state missing evidence instead of inventing a plan. " +
  "For get_active_training_program, only status absent proves that no active program exists; a tool error leaves the plan unknown and must not be treated as absent. " +
  "If a required typed read fails, is unavailable, or returns incomplete or inconsistent data, label the affected field unknown: never infer absence, zero, no plan, or another dependent fact, and omit or explicitly qualify dependent proposals. " +
  "Preserve unknown optional values as null or partial inside typed data instead of inventing precision. For Meal items, use amountKind unknown when no amount was reported, described for the user's own non-numeric wording, quantified only for an explicit number and unit, and estimated only after a real text or photo estimate with method and confidence; never invent 1 serving or another sentinel amount. Use a typed DailyContextNote only when a relevant observation cannot yet be represented safely in its owning domain. Ask only for irreducible ambiguity between materially different targets, dates, or domain meanings. " +
  "After a routine Meal create or correction, say naturally what was recorded or corrected and add one useful evidence-grounded observation or next step when supported. An optional later photo or everyday-language amount description may be useful, but do not turn it into a prerequisite or a repeated question. Never expose tool names, arguments, identifiers, property or enum names, null, partial, typed, read-back, transport details, or implementation status. Do not force Planned, Proposed now, or Actually completed headings onto a routine fact capture; reserve that structure for a full daily-plan answer. Natural reply examples: " +
  MCP_ROUTINE_COACH_RESPONSE_EXAMPLES.map((example) => `\"${example}\"`).join(" ") +
  " " +
  "Format user-facing answers as plain Markdown and never emit HTML entities or encoded whitespace. Destructive, credential, administrative, and material goal or program changes still require explicit confirmation.";

const toolAuthorityInstruction =
  "PostgreSQL authority; no Google Sheets fallback. Fail closed if this tool or its authorization is unavailable.";

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
      MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE
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
      return errorResult("Unknown Shape of You tool");
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
      return successResult(result, definition.present?.(result));
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
      return errorResult("The Shape of You operation failed");
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
      CreateWeightMeasurementSchema,
      undefined,
      true,
      MCP_WEIGHT_WRITE_SCOPE,
      async (input) => (await services.weights.create(input as CreateWeightMeasurement)).measurement
    ),
    defineTool(
      "correct_weight_measurement",
      "Append one idempotent correction to a uniquely identified current weight measurement; follow with typed read-back.",
      withIdSchema("CorrectWeightMeasurementToolInput", CorrectWeightMeasurementSchema),
      undefined,
      true,
      MCP_WEIGHT_WRITE_SCOPE,
      async (input) => (await services.weights.correct(input.id as string, input as unknown as CorrectWeightMeasurement)).measurement
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
      "Immediately record one idempotent Meal from a direct user report without a pre-read or duplicate confirmation. Supply only amount evidence the user actually provided or that was genuinely estimated from text/photo; omit irrelevant amount and nutrient fields instead of sending null bookkeeping or a sentinel serving. Then read back with list_meals using localDate only and reply in natural coach language without exposing contract fields or tool mechanics.",
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
      "Append one idempotent correction to a uniquely identified current Meal; follow with typed read-back, then reply in natural coach language without exposing contract fields or tool mechanics.",
      withIdSchema("CorrectMealToolInput", correctMealToolInputSchema),
      undefined,
      true,
      MCP_MEAL_WRITE_SCOPE,
      async (input) => (await services.nutrition.correctMeal(
        input.id as string,
        normalizeMealInput(input, validateCorrectMeal) as unknown as CorrectMeal
      )).meal,
      () => mealWriteResultContent
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
      }
    ),
    defineTool(
      "list_workout_sessions",
      "Read the authorized person's current workout sessions.",
      ListWorkoutSessionsQuerySchema,
      WorkoutSessionListSchema,
      false,
      MCP_READ_SCOPE,
      (input) => services.training.listWorkoutSessions(input as ListWorkoutSessionsQuery)
    ),
    defineTool(
      "record_workout_session",
      "Record one idempotent workout session from a direct user report; follow with typed read-back.",
      createWorkoutSessionToolInputSchema,
      undefined,
      true,
      MCP_WORKOUT_WRITE_SCOPE,
      async (input) =>
        (await services.training.createWorkoutSession(normalizeWorkoutInput(
          input,
          validateCreateWorkoutSession
        ) as CreateWorkoutSession)).session
    ),
    defineTool(
      "correct_workout_session",
      "Append one idempotent correction to a uniquely identified workout session; follow with typed read-back.",
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
      )).session
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
      "record_recovery_observation",
      "Immediately record one independent recovery fact from a direct text or screenshot report. Use sleep_score for a wearable 0..100 score, keep subjective sleepQuality at 1..5 only, continue other independent facts after an isolated failure, then read back the date-level set.",
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
      "Append one idempotent correction to a uniquely identified recovery observation, then read back the date-level set without exposing internal mechanics.",
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
      "get_daily_projection",
      "Read the current owning-domain facts for one Person-local date.",
      DailyProjectionQuerySchema,
      DailyProjectionSchema,
      false,
      MCP_READ_SCOPE,
      (input) => services.dailyProjection.projection(input as DailyProjectionQuery)
    )
  ];
}

function emptyObjectSchema(id: string): Readonly<Record<string, unknown>> {
  return { $id: id, type: "object", additionalProperties: false, properties: {} };
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
            nutrients: {
              type: "object",
              additionalProperties: false,
              properties: nutrientSchema.properties
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
  if (!validate(normalized)) {
    throw new ConnectorInputError("Normalized Meal input does not match the domain contract");
  }
  return normalized;
}

function normalizeRecoveryInput(
  input: Record<string, unknown>,
  validate: ValidateFunction
): Record<string, unknown> {
  const recoveryInput = { ...input };
  delete recoveryInput.id;
  const sourceReference = isRecord(recoveryInput.sourceReference)
    ? recoveryInput.sourceReference
    : {};
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
    connectionId: recoveryInput.connectionId ?? null,
    consentId: recoveryInput.consentId ?? null,
    sourceReference: {
      channel: sourceReference.channel ?? "manual",
      externalSystem: sourceReference.externalSystem ?? null,
      externalRecordId: sourceReference.externalRecordId ?? null,
      occurredAt: sourceReference.occurredAt ?? recoveryInput.observedUntil ?? null
    },
    detail: detail.type === "sleep" ? {
      ...detail,
      deepSleepMinutes: detail.deepSleepMinutes ?? null,
      remSleepMinutes: detail.remSleepMinutes ?? null,
      lightSleepMinutes: detail.lightSleepMinutes ?? null,
      sleepQuality: detail.sleepQuality ?? null
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
  present?: (value: unknown) => string
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
    ...(present ? { present } : {})
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

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function inputErrorResult(toolName: string): CallToolResult {
  if (toolName === "record_meal" || toolName === "correct_meal") {
    return errorResult(
      "Retry the Meal once using only facts the user supplied: omit unknown optional fields and never invent amounts or nutrients. Do not mention tools, staging, APIs, contracts, fields, or this retry to the user. If the retry still fails, say naturally that saving is temporarily unavailable."
    );
  }
  if (toolName === "record_recovery_observation" || toolName === "correct_recovery_observation") {
    return errorResult(
      "Retry this recovery fact once using the exact local date and timezone plus only the reported value. " +
      "A wearable 0..100 sleep score is metric sleep_score with unit score, never sleepQuality. " +
      "Continue saving the other independent facts from the same report. Do not mention tools, staging, APIs, " +
      "contracts, fields, or this retry to the user. If this fact still cannot be saved, describe that one missing " +
      "fact naturally without technical details and never claim it was recorded."
    );
  }
  return errorResult("Tool arguments do not match the API contract");
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
    ...errorResult(message),
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
