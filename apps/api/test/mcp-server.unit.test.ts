import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";

import { RequestPersonContext } from "../src/application/person-context.js";
import {
  MCP_READ_SCOPE,
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
});
