import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  BodyMeasurementSessionListSchema,
  CreateBodyMeasurementSessionSchema,
  CreateMealSchema,
  CreateWeightMeasurementSchema,
  CreateWorkoutSessionSchema,
  ListBodyMeasurementSessionsQuerySchema,
  ListMealsQuerySchema,
  ListWeightMeasurementsQuerySchema,
  ListWorkoutSessionsQuerySchema,
  MealListSchema,
  WeightMeasurementListSchema,
  WorkoutSessionListSchema,
  type CreateBodyMeasurementSession,
  type CreateMeal,
  type CreateWeightMeasurement,
  type CreateWorkoutSession,
  type ListBodyMeasurementSessionsQuery,
  type ListMealsQuery,
  type ListWeightMeasurementsQuery,
  type ListWorkoutSessionsQuery
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
import type { TrainingService } from "../training/training.service.js";
import type { WeightMeasurementService } from "../weight-measurements/weight-measurement.service.js";
import {
  MCP_BODY_MEASUREMENT_WRITE_SCOPE,
  MCP_MEAL_WRITE_SCOPE,
  MCP_READ_SCOPE,
  MCP_WEIGHT_WRITE_SCOPE,
  MCP_WORKOUT_WRITE_SCOPE,
  McpAuthorizationError,
  type McpAuthorizationBoundary,
  type McpOAuthErrorCode
} from "./oauth.js";

interface McpServices {
  readonly weights: Pick<WeightMeasurementService, "list" | "create">;
  readonly bodyMeasurements: Pick<BodyMeasurementSessionService, "list" | "create">;
  readonly nutrition: Pick<NutritionService, "listMeals" | "createMeal">;
  readonly training: Pick<TrainingService, "listWorkoutSessions" | "createWorkoutSession">;
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
      MCP_WORKOUT_WRITE_SCOPE
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
    { capabilities: { tools: {} } }
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
      "Record one idempotent weight measurement after user confirmation.",
      CreateWeightMeasurementSchema,
      undefined,
      true,
      MCP_WEIGHT_WRITE_SCOPE,
      async (input) => (await services.weights.create(input as CreateWeightMeasurement)).measurement
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
      "Record one idempotent body measurement session after user confirmation.",
      CreateBodyMeasurementSessionSchema,
      undefined,
      true,
      MCP_BODY_MEASUREMENT_WRITE_SCOPE,
      async (input) =>
        (await services.bodyMeasurements.create(input as CreateBodyMeasurementSession)).session
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
      "Record one idempotent meal after user confirmation.",
      CreateMealSchema,
      undefined,
      true,
      MCP_MEAL_WRITE_SCOPE,
      async (input) => (await services.nutrition.createMeal(input as CreateMeal)).meal
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
      "Record one idempotent workout session after user confirmation.",
      CreateWorkoutSessionSchema,
      undefined,
      true,
      MCP_WORKOUT_WRITE_SCOPE,
      async (input) =>
        (await services.training.createWorkoutSession(input as CreateWorkoutSession)).session
    )
  ];
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
      description,
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
