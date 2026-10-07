import Fastify from "fastify";
import { RequestPersonContext } from "../../src/application/person-context.js";
import { registerMcpRoutes, type McpRouteOptions } from "../../src/mcp/server.js";

async function unavailable(): Promise<never> { throw new Error("Unrelated service called"); }

/** Creates an isolated MCP endpoint using the supplied Nutrition boundary. */
export function mcpMealServer(nutrition: McpRouteOptions["services"]["nutrition"], personId: string) {
  const server = Fastify({ logger: false });
  const context = new RequestPersonContext(personId);
  registerMcpRoutes({ fastify: server, issuer: "https://identity.example.test", resource: "https://api.example.test/mcp",
    authorizer: { authorize: async () => ({ personId, roles: ["owner"] }) }, personContext: context,
    services: {
      nutrition,
      weights: { list: unavailable, create: unavailable, correct: unavailable },
      bodyMeasurements: { list: unavailable, create: unavailable, correct: unavailable },
      training: { listWorkoutSessions: unavailable, createWorkoutSession: unavailable, correctWorkoutSession: unavailable,
        findActiveProgram: unavailable, getTrainingContext: unavailable, saveConfirmedProgram: unavailable,
        materializeProgramCadence: unavailable, classifyExternalActivity: unavailable, setTrustedExternalActivityTitle: unavailable,
        setActivityRecordingMode: unavailable, confirmWorkoutActivityLink: unavailable, getExternalActivityDetails: unavailable },
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

/** Synthetic menu capture carrying decimals that fail naive multipleOf validation. */
export function decimalMenuMeal(dedupeKey: string) {
  return { occurredAt: "2026-10-07T12:00:00Z", timezone: "Europe/Belgrade", kind: "lunch", dedupeKey,
    items: [{ label: "Synthetic menu meal", amountKind: "estimated", quantity: 1, unit: "serving",
      estimateMethod: "text", amountConfidence: 0.7,
      nutrients: { caloriesKcal: 635, proteinG: 5.1, fatG: 11, carbsG: 69 } }] };
}
