import Fastify from "fastify";
import { RequestPersonContext } from "../../src/application/person-context.js";
import { registerMcpRoutes, type McpRouteOptions } from "../../src/mcp/server.js";

async function unavailable(): Promise<never> { throw new Error("Unrelated service called"); }

/** Creates an isolated MCP endpoint using the supplied Training boundary and receipt clock. */
export function mcpWorkoutServer(training: McpRouteOptions["services"]["training"], personId: string, now: () => Date) {
  const server = Fastify({ logger: false });
  const context = new RequestPersonContext(personId);
  registerMcpRoutes({ fastify: server, issuer: "https://identity.example.test", resource: "https://api.example.test/mcp",
    authorizer: { authorize: async () => ({ personId, roles: ["owner"] }) }, personContext: context,
    now, services: {
      nutrition: { listMeals: unavailable, createMeal: unavailable, correctMeal: unavailable },
      weights: { list: unavailable, create: unavailable, correct: unavailable },
      bodyMeasurements: { list: unavailable, create: unavailable, correct: unavailable },
      training,
      recovery: { listObservations: unavailable, createObservation: unavailable, correctObservation: unavailable },
      dailyContextNotes: { list: unavailable, create: unavailable, correct: unavailable },
      currentRecoveryContext: { read: unavailable }, dailyProjection: { projection: unavailable }
    }
  });
  let requestId = 0;
  const request = async (method: string, params: object) => {
    const response = await server.inject({ method: "POST", url: "/mcp",
      headers: { accept: "application/json, text/event-stream", authorization: "Bearer synthetic-test-token" },
      payload: { jsonrpc: "2.0", id: ++requestId, method, params } });
    return response.json().result;
  };
  return { server, context, list: () => request("tools/list", {}),
    call: (name: string, args: object) => request("tools/call", { name, arguments: args }) };
}

