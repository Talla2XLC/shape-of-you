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
  MCP_READ_SCOPE,
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

registerMcpRoutes({
  fastify,
  issuer: "https://identity.example.test",
  resource: "https://api.example.test/api/mcp",
  authorizer: denied,
  personContext: new RequestPersonContext(),
  services: {
    weights: { list: unreachable, create: unreachable },
    bodyMeasurements: { list: unreachable, create: unreachable },
    nutrition: { listMeals: unreachable, createMeal: unreachable },
    training: { listWorkoutSessions: unreachable, createWorkoutSession: unreachable }
  }
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
    expect(body.result.tools).toHaveLength(8);
    expect(body.result.tools[0]._meta.securitySchemes).toEqual([
      { type: "oauth2", scopes: [MCP_READ_SCOPE] }
    ]);
    expect(body.result.tools[0].securitySchemes).toEqual([
      { type: "oauth2", scopes: [MCP_READ_SCOPE] }
    ]);
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
        weights: { list, create: unreachable },
        bodyMeasurements: { list: unreachable, create: unreachable },
        nutrition: { listMeals: unreachable, createMeal: unreachable },
        training: { listWorkoutSessions: unreachable, createWorkoutSession: unreachable }
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
});
