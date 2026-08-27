import Fastify from "fastify";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT
} from "jose";
import { afterAll, describe, expect, it, vi } from "vitest";

import { RequestPersonContext } from "../src/application/person-context.js";
import {
  MCP_BODY_MEASUREMENT_WRITE_SCOPE,
  MCP_DAILY_CONTEXT_NOTE_WRITE_SCOPE,
  MCP_DAY_CLOSURE_WRITE_SCOPE,
  MCP_MEAL_WRITE_SCOPE,
  MCP_READ_SCOPE,
  MCP_RECOVERY_WRITE_SCOPE,
  MCP_WEIGHT_WRITE_SCOPE,
  MCP_WORKOUT_WRITE_SCOPE,
  McpAuthorizer,
  McpAuthorizationError,
  type McpAuthorizationBoundary
} from "../src/mcp/oauth.js";
import { registerMcpRoutes } from "../src/mcp/server.js";

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
  dayClosures: {
    projection: unreachable,
    close: unreachable,
    reopen: unreachable,
    history: unreachable
  }
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
    expect(body.result.tools).toHaveLength(23);
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
      get_daily_projection: MCP_READ_SCOPE,
      list_day_closure_history: MCP_READ_SCOPE,
      close_day: MCP_DAY_CLOSURE_WRITE_SCOPE,
      reopen_day: MCP_DAY_CLOSURE_WRITE_SCOPE
    });
    expect(body.result.tools.find((tool: { name: string }) =>
      tool.name === "record_daily_context_note"
    )?.description).toContain("call reopen_day before writing");
    const workoutSetVariants = body.result.tools.find((tool: { name: string }) =>
      tool.name === "record_workout_session"
    )?.inputSchema.properties.exercises.items.properties.sets.items.anyOf;
    expect(workoutSetVariants).toHaveLength(3);
    for (const variant of workoutSetVariants) {
      expect(variant).toMatchObject({
        type: "object",
        additionalProperties: false,
        properties: {
          weightKg: expect.any(Object),
          reps: expect.any(Object),
          rir: expect.any(Object)
        }
      });
      expect(variant.required).toEqual(expect.arrayContaining([
        "weightKg",
        "reps",
        "rir"
      ]));
    }
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
        MCP_DAY_CLOSURE_WRITE_SCOPE
      ].join(" ")
    })
      .setProtectedHeader({ alg: "ES256", kid: "writer-v1" })
      .setIssuer("https://identity.example.test")
      .setSubject("identity-account-1")
      .setAudience("https://api.example.test/api/mcp")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(pair.privateKey);
    const findActiveProgram = vi.fn().mockResolvedValue({ id: "active-program" });
    const create = vi.fn().mockResolvedValue({
      created: true,
      note: { id: "00000000-0000-4000-8000-000000000201" }
    });
    const correct = vi.fn().mockResolvedValue({
      created: true,
      note: { id: "00000000-0000-4000-8000-000000000202" }
    });
    const close = vi.fn().mockResolvedValue({
      created: true,
      closure: { id: "00000000-0000-4000-8000-000000000203" }
    });
    const reopen = vi.fn().mockResolvedValue({
      created: true,
      closure: { id: "00000000-0000-4000-8000-000000000203" }
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
        dayClosures: { ...unavailableServices.dayClosures, close, reopen }
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

    try {
      expect((await call(5, "get_active_training_program", {})).json().result)
        .toMatchObject({ structuredContent: { id: "active-program" } });
      expect((await call(6, "record_daily_context_note", note)).json().result)
        .toMatchObject({
          structuredContent: { id: "00000000-0000-4000-8000-000000000201" }
        });
      expect((await call(7, "correct_daily_context_note", {
        id: "00000000-0000-4000-8000-000000000201",
        ...note,
        text: "Went to bed early.",
        dedupeKey: "chatgpt:daily-note:2026-08-26:correction:1",
        reason: "Clarified wording"
      })).json().result).toMatchObject({
        structuredContent: { id: "00000000-0000-4000-8000-000000000202" }
      });
      expect((await call(8, "close_day", {
        localDate: "2026-08-26",
        timezone: "Europe/Moscow",
        idempotencyKey: "chatgpt:close:2026-08-26"
      })).json().result).toMatchObject({
        structuredContent: { id: "00000000-0000-4000-8000-000000000203" }
      });
      expect((await call(9, "reopen_day", {
        localDate: "2026-08-26",
        reason: "Add a confirmed late fact",
        idempotencyKey: "chatgpt:reopen:2026-08-26:1"
      })).json().result).toMatchObject({
        structuredContent: { id: "00000000-0000-4000-8000-000000000203" }
      });

      expect(findActiveProgram).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledWith(note);
      expect(correct).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000201",
        expect.objectContaining({ reason: "Clarified wording" })
      );
      expect(close).toHaveBeenCalledWith({
        localDate: "2026-08-26",
        timezone: "Europe/Moscow",
        idempotencyKey: "chatgpt:close:2026-08-26"
      });
      expect(reopen).toHaveBeenCalledWith(
        "2026-08-26",
        expect.objectContaining({ reason: "Add a confirmed late fact" })
      );
    } finally {
      await authorizedFastify.close();
    }
  });
});
