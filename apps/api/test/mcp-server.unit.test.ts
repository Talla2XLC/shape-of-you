import Fastify from "fastify";
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
  ListRecoveryObservationsQuery,
  RecoveryObservation
} from "@shape-of-you/contracts";

import { RequestPersonContext } from "../src/application/person-context.js";
import { NotFoundError } from "../src/domain/errors.js";
import {
  MCP_BODY_MEASUREMENT_WRITE_SCOPE,
  MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
  MCP_MEAL_WRITE_SCOPE,
  MCP_READ_SCOPE,
  MCP_RECOVERY_WRITE_SCOPE,
  MCP_WEIGHT_WRITE_SCOPE,
  MCP_WORKOUT_WRITE_SCOPE,
  McpAuthorizer,
  McpAuthorizationError,
  type McpAuthorizationBoundary
} from "../src/mcp/oauth.js";
import {
  MCP_OPERATIONAL_INSTRUCTIONS,
  MCP_ROUTINE_COACH_RESPONSE_EXAMPLES,
  registerMcpRoutes
} from "../src/mcp/server.js";

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
    findActiveProgram: unreachable
  },
  recovery: {
    listObservations: unreachable,
    createObservation: unreachable,
    correctObservation: unreachable
  },
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
      "call get_daily_projection first"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Planned, Proposed now, and Actually completed separately"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "an accepted recommendation is not executed"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "one clear Next step"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "state missing evidence instead of inventing a plan"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "only status absent proves that no active program exists"
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
      "Always read back successful writes"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "A routine create does not require a pre-read"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "list_meals with localDate only"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "never invent 1 serving or another sentinel amount"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "answer like a real coach in one or two natural sentences"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Never expose tool names, arguments, identifiers, property or enum names"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Do not force Planned, Proposed now, or Actually completed headings onto a routine fact capture"
    );
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain(
      "Match the user's language"
    );
    const priorityInstructions = MCP_OPERATIONAL_INSTRUCTIONS.slice(0, 512);
    expect(priorityInstructions).toContain(
      "Keep internal mechanics invisible in user-facing replies"
    );
    expect(priorityInstructions).toContain(
      "answer like a real coach in one or two natural sentences"
    );
    expect(priorityInstructions).toContain(
      "one useful evidence-grounded observation or next step"
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
    expect(body.result.tools).toHaveLength(20);
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
      list_workout_sessions: MCP_READ_SCOPE,
      record_workout_session: MCP_WORKOUT_WRITE_SCOPE,
      correct_workout_session: MCP_WORKOUT_WRITE_SCOPE,
      list_recovery_observations: MCP_READ_SCOPE,
      record_recovery_observation: MCP_RECOVERY_WRITE_SCOPE,
      correct_recovery_observation: MCP_RECOVERY_WRITE_SCOPE,
      list_daily_context_notes: MCP_READ_SCOPE,
      record_daily_context_note: MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
      correct_daily_context_note: MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
      get_daily_projection: MCP_READ_SCOPE
    });
    expect(body.result.tools.find((tool: { name: string }) =>
      tool.name === "record_daily_context_note"
    )?.description).toContain("follow with typed read-back");
    const recordMealTool = body.result.tools.find((tool: { name: string }) =>
      tool.name === "record_meal"
    );
    expect(recordMealTool?.description).toContain(
      "reply in natural coach language"
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
    expect(recordMealTool?.inputSchema.properties.items.items.properties.nutrients.required)
      .toBeUndefined();
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
      if: { properties: { metric: { enum: ["body_battery", "sleep_score"] } } },
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
      _meta: {
        "mcp/www_authenticate": [
          'Bearer resource_metadata="https://api.example.test/api/.well-known/oauth-protected-resource", scope="person:read", error="invalid_token", error_description="A bearer access token is required"'
        ]
      }
    });
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
        content: [{ text: "The Shape of You operation failed" }]
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
        content: [{ text: "The Shape of You operation failed" }]
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
        structuredContent: { items: [], nextCursor: null }
      });
      expect(list).toHaveBeenCalledOnce();
    } finally {
      await authorizedFastify.close();
    }
  });

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
    const originalMeal = {
      id: "00000000-0000-4000-8000-000000000203",
      description: "Ужин",
      items: [
        {
          label: "Стейк лосося",
          amountKind: "unknown",
          quantity: null,
          unit: null,
          amountDescription: null,
          estimateMethod: null,
          amountConfidence: null,
          nutrients: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
        },
        {
          label: "Красное вино",
          amountKind: "quantified",
          quantity: 150,
          unit: "ml",
          amountDescription: null,
          estimateMethod: null,
          amountConfidence: null,
          nutrients: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
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
        quantity: 220,
        unit: "g",
        nutrients: { caloriesKcal: 455, proteinG: null, fatG: null, carbsG: null }
      }]
    };
    const createMeal = vi.fn().mockResolvedValue({ created: true, meal: originalMeal });
    const correctMeal = vi.fn().mockResolvedValue({ created: true, meal: correctedMeal });
    const listMeals = vi.fn()
      .mockResolvedValueOnce({ items: [originalMeal], nextCursor: null })
      .mockResolvedValueOnce({ items: [correctedMeal], nextCursor: null });
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
          create,
          correct
        },
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
      description: "Стейк лосося, початок кукурузы, овощи, ягоды и вино",
      items: [
        { label: "Стейк лосося" },
        { label: "Варёная кукуруза", amountDescription: "1 початок" },
        { label: "Красное вино", quantity: 150, unit: "ml" },
        { label: "Овощи" },
        { label: "Ягоды" }
      ],
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
      items: [
        {
          foodVersionId: null,
          label: "Стейк лосося",
          amountKind: "unknown",
          quantity: null,
          unit: null,
          amountDescription: null,
          estimateMethod: null,
          amountConfidence: null,
          nutrients: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
        },
        {
          foodVersionId: null,
          label: "Варёная кукуруза",
          amountKind: "described",
          quantity: null,
          unit: null,
          amountDescription: "1 початок",
          estimateMethod: null,
          amountConfidence: null,
          nutrients: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
        },
        {
          foodVersionId: null,
          label: "Красное вино",
          amountKind: "quantified",
          quantity: 150,
          unit: "ml",
          amountDescription: null,
          estimateMethod: null,
          amountConfidence: null,
          nutrients: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
        },
        ...["Овощи", "Ягоды"].map((label) => ({
          foodVersionId: null,
          label,
          amountKind: "unknown",
          quantity: null,
          unit: null,
          amountDescription: null,
          estimateMethod: null,
          amountConfidence: null,
          nutrients: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
        }))
      ]
    };

    try {
      expect((await call(5, "get_active_training_program", {})).json().result)
        .toMatchObject({
          structuredContent: {
            status: "active",
            program: { id: "active-program" }
          }
        });
      expect((await call(6, "get_active_training_program", {})).json().result)
        .toMatchObject({
          structuredContent: { status: "absent", program: null }
        });
      expect((await call(7, "get_active_training_program", {})).json().result)
        .toMatchObject({
          isError: true,
          content: [{ text: "The Shape of You operation failed" }]
        });
      expect((await call(8, "record_daily_context_note", note)).json().result)
        .toMatchObject({
          structuredContent: { id: "00000000-0000-4000-8000-000000000201" }
        });
      expect((await call(9, "correct_daily_context_note", {
        id: "00000000-0000-4000-8000-000000000201",
        ...note,
        text: "Went to bed early.",
        dedupeKey: "chatgpt:daily-note:2026-08-26:correction:1",
        reason: "Clarified wording"
      })).json().result).toMatchObject({
        structuredContent: { id: "00000000-0000-4000-8000-000000000202" }
      });
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
        content: [{ text: expect.stringContaining("Do not mention tools, staging, APIs, contracts") }]
      });
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
        text: expect.stringContaining("one useful evidence-grounded observation or next step")
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
          quantity: 220,
          unit: "g",
          nutrients: { caloriesKcal: 455 }
        }],
        dedupeKey: "chatgpt:meal:dinner:2026-08-30:1905:correction:1",
        reason: "Пользователь уточнил объём и калорийность"
      };
      const correctMealResult = (await call(13, "correct_meal", correction)).json().result;
      expect(correctMealResult).toMatchObject({ structuredContent: correctedMeal });
      expect(correctMealResult.content[0].text).toContain("sound like a real coach");
      const correctedMealReadResult = (await call(14, "list_meals", {
        localDate: "2026-08-30"
      })).json().result;
      expect(correctedMealReadResult)
        .toMatchObject({ structuredContent: { items: [correctedMeal] } });
      expect(correctedMealReadResult.content[0].text)
        .toContain("one useful evidence-grounded observation or next step");
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
          detail: { type: "sleep", totalSleepMinutes: 474 }
        },
        {
          kind: "metric",
          dedupeKey: "chatgpt:recovery:sleep-score:2026-08-31",
          detail: { type: "metric", metric: "sleep_score", value: 86, unit: "score" }
        },
        {
          kind: "metric",
          dedupeKey: "chatgpt:recovery:hrv:2026-08-31",
          detail: { type: "metric", metric: "hrv_rmssd", value: 48, unit: "ms" }
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
        .toContain("one evidence-grounded observation or next step");
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
      expect(createMeal).toHaveBeenCalledWith(normalizedDinner);
      expect(listMeals).toHaveBeenCalledTimes(2);
      expect(correctMeal).toHaveBeenCalledWith(
        originalMeal.id,
        expect.objectContaining({
          reason: "Пользователь уточнил объём и калорийность",
          items: [{
            foodVersionId: null,
            label: "Стейк лосося",
            amountKind: "quantified",
            quantity: 220,
            unit: "g",
            amountDescription: null,
            estimateMethod: null,
            amountConfidence: null,
            nutrients: { caloriesKcal: 455, proteinG: null, fatG: null, carbsG: null }
          }]
        })
      );
    } finally {
      await authorizedFastify.close();
    }
  });
});
