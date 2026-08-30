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
}

interface OAuthSecurityScheme {
  readonly type: "oauth2";
  readonly scopes: readonly string[];
}

type OAuthProtectedTool = Tool & {
  readonly securitySchemes: readonly OAuthSecurityScheme[];
};

/** Durable operational policy published by the API-owned MCP server. */
export const MCP_OPERATIONAL_INSTRUCTIONS =
  "Shape of You PostgreSQL is the operational authority and this MCP is its only interactive writer. " +
  "The Google Sheets Fitness Tracker is a non-authoritative read-only legacy reference: never use it as current truth, a write target, or a fallback. " +
  "Use only the authorized Person-scoped typed tools. A direct relevant user report authorizes one routine low-risk idempotent create or correction without a duplicate confirmation question. Always read back successful writes and fail closed when MCP authorization, a required tool, or read-back is unavailable or inconsistent. " +
  "For Daily Coach, require an exact local date and IANA timezone and call get_daily_projection first, followed only by the typed reads needed for the answer. " +
  "Present Planned, Proposed now, and Actually completed separately: only typed plan artifacts such as the active TrainingProgram are planned, conversation advice is proposed, and only owning-domain facts verified by typed reads are completed; an accepted recommendation is not executed. " +
  "Give one clear Next step plus at most one bounded nutrition, training, and recovery proposal grounded in available evidence, and state missing evidence instead of inventing a plan. " +
  "For get_active_training_program, only status absent proves that no active program exists; a tool error leaves the plan unknown and must not be treated as absent. " +
  "If a required typed read fails, is unavailable, or returns incomplete or inconsistent data, label the affected field unknown: never infer absence, zero, no plan, or another dependent fact, and omit or explicitly qualify dependent proposals. " +
  "Preserve unknown optional values as null or partial instead of inventing precision. Use a typed DailyContextNote only when a relevant observation cannot yet be represented safely in its owning domain. Ask only for irreducible ambiguity between materially different targets, dates, or domain meanings. " +
  "Format user-facing Daily Coach answers as plain Markdown and never emit HTML entities or encoded whitespace. Destructive, credential, administrative, and material goal or program changes still require explicit confirmation.";

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
      return errorResult("Tool arguments do not match the API contract");
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
      return successResult(result);
    } catch (error) {
      if (error instanceof McpAuthorizationError) {
        return authorizationErrorResult(
          error.message,
          error.oauthError,
          metadataUrl,
          definition.scope
        );
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
      "Read the authorized person's current meals.",
      ListMealsQuerySchema,
      MealListSchema,
      false,
      MCP_READ_SCOPE,
      (input) => services.nutrition.listMeals(input as ListMealsQuery)
    ),
    defineTool(
      "record_meal",
      "Record one idempotent Meal from a direct user report. Unknown nutrients stay null; follow with typed read-back.",
      CreateMealSchema,
      undefined,
      true,
      MCP_MEAL_WRITE_SCOPE,
      async (input) => (await services.nutrition.createMeal(input as CreateMeal)).meal
    ),
    defineTool(
      "correct_meal",
      "Append one idempotent correction to a uniquely identified current Meal; follow with typed read-back.",
      withIdSchema("CorrectMealToolInput", CorrectMealSchema),
      undefined,
      true,
      MCP_MEAL_WRITE_SCOPE,
      async (input) => (await services.nutrition.correctMeal(input.id as string, input as unknown as CorrectMeal)).meal
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
      "Read the authorized person's current raw recovery observations.",
      ListRecoveryObservationsQuerySchema,
      RecoveryObservationListSchema,
      false,
      MCP_READ_SCOPE,
      (input) => services.recovery.listObservations(input as ListRecoveryObservationsQuery)
    ),
    defineTool(
      "record_recovery_observation",
      "Record one idempotent typed recovery observation from a direct user report; follow with typed read-back.",
      CreateRecoveryObservationSchema,
      undefined,
      true,
      MCP_RECOVERY_WRITE_SCOPE,
      async (input) =>
        (await services.recovery.createObservation(input as unknown as CreateRecoveryObservation)).observation
    ),
    defineTool(
      "correct_recovery_observation",
      "Append one idempotent correction to a uniquely identified recovery observation; follow with typed read-back.",
      withIdSchema("CorrectRecoveryObservationToolInput", CorrectRecoveryObservationSchema),
      undefined,
      true,
      MCP_RECOVERY_WRITE_SCOPE,
      async (input) => (await services.recovery.correctObservation(input.id as string, input as unknown as CorrectRecoveryObservation)).observation
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
  execute: (input: Record<string, unknown>) => Promise<unknown>
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
    execute
  };
}

function compile(schema: Readonly<Record<string, unknown>>): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, multipleOfPrecision: 6, strict: false });
  const installFormats = addFormats as unknown as (instance: Ajv) => Ajv;
  installFormats(ajv);
  return ajv.compile(schema);
}

function successResult(value: unknown): CallToolResult {
  const structured = isRecord(value) ? value : { result: value };
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: structured
  };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
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
