import Fastify from "fastify";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT
} from "jose";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ToolSchema } from "@modelcontextprotocol/sdk/types.js";

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
      "Match the user's language and conversational tone"
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
      required: expect.arrayContaining([
        "amountKind",
        "quantity",
        "unit",
        "amountDescription",
        "estimateMethod",
        "amountConfidence"
      ]),
      properties: {
        amountKind: {
          enum: ["unknown", "described", "quantified", "estimated"]
        }
      }
    });
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
        MCP_MEAL_WRITE_SCOPE
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
      description: "Капучино",
      items: [{
        label: "Капучино",
        amountKind: "unknown",
        quantity: null,
        unit: null,
        amountDescription: null,
        estimateMethod: null,
        amountConfidence: null,
        nutrients: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
      }]
    };
    const correctedMeal = {
      ...originalMeal,
      id: "00000000-0000-4000-8000-000000000204",
      supersedesId: originalMeal.id,
      items: [{
        ...originalMeal.items[0],
        amountKind: "quantified",
        quantity: 300,
        unit: "ml",
        nutrients: { caloriesKcal: 120, proteinG: null, fatG: null, carbsG: null }
      }]
    };
    const createMeal = vi.fn().mockResolvedValue({ created: true, meal: originalMeal });
    const correctMeal = vi.fn().mockResolvedValue({ created: true, meal: correctedMeal });
    const listMeals = vi.fn()
      .mockResolvedValueOnce({ items: [originalMeal], nextCursor: null })
      .mockResolvedValueOnce({ items: [correctedMeal], nextCursor: null });
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
        nutrition: { listMeals, createMeal, correctMeal }
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
    const cappuccino = {
      occurredAt: "2026-08-29T07:30:00.000Z",
      timezone: "Europe/Moscow",
      kind: "snack",
      description: "Капучино",
      note: null,
      photoMediaId: null,
      items: [{
        foodVersionId: null,
        label: "Капучино",
        amountKind: "unknown",
        quantity: null,
        unit: null,
        amountDescription: null,
        estimateMethod: null,
        amountConfidence: null,
        nutrients: { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null }
      }],
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-08-29T07:30:00.000Z"
      },
      dedupeKey: "chatgpt:meal:cappuccino:2026-08-29:0730",
      confidence: null
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
      expect((await call(10, "record_meal", cappuccino)).json().result)
        .toMatchObject({ structuredContent: originalMeal });
      expect((await call(11, "list_meals", { localDate: "2026-08-29" })).json().result)
        .toMatchObject({ structuredContent: { items: [originalMeal] } });
      const correction = {
        ...cappuccino,
        id: originalMeal.id,
        items: [{
          ...cappuccino.items[0],
          amountKind: "quantified",
          quantity: 300,
          unit: "ml",
          nutrients: { caloriesKcal: 120, proteinG: null, fatG: null, carbsG: null }
        }],
        dedupeKey: "chatgpt:meal:cappuccino:2026-08-29:0730:correction:1",
        reason: "Пользователь уточнил объём и калорийность"
      };
      expect((await call(12, "correct_meal", correction)).json().result)
        .toMatchObject({ structuredContent: correctedMeal });
      expect((await call(13, "list_meals", { localDate: "2026-08-29" })).json().result)
        .toMatchObject({ structuredContent: { items: [correctedMeal] } });
      expect(findActiveProgram).toHaveBeenCalledTimes(3);
      expect(create).toHaveBeenCalledWith(note);
      expect(correct).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000201",
        expect.objectContaining({ reason: "Clarified wording" })
      );
      expect(createMeal).toHaveBeenCalledWith(cappuccino);
      expect(listMeals).toHaveBeenCalledTimes(2);
      expect(correctMeal).toHaveBeenCalledWith(
        originalMeal.id,
        expect.objectContaining({ reason: "Пользователь уточнил объём и калорийность" })
      );
    } finally {
      await authorizedFastify.close();
    }
  });
});
