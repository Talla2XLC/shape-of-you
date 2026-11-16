import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { RequestPersonContext } from "../src/application/person-context.js";
import { ConflictError, DomainValidationError } from "../src/domain/errors.js";
import { registerMcpRoutes, type McpRouteOptions } from "../src/mcp/server.js";

const personId = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const instant = "2026-11-15T07:00:00.000Z";
const command = { measuredAt: instant, timezone: "Europe/Moscow", weightKg: 76.4, sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: instant }, dedupeKey: "synthetic-morning" };
const measurement = { ...command, id, personId, temporalPrecision: "instant", localDate: "2026-11-15",
  sourceReference: { id, channel: "manual", externalSystem: null, externalRecordId: null,
    occurredAt: instant, ingestedAt: instant }, confidence: null, supersedesId: null, correctionReason: null, createdAt: instant } as const;

async function unavailable(): Promise<never> { throw new Error("Synthetic unavailable service"); }

function fixture(overrides: Partial<McpRouteOptions["services"]> = {}) {
  const server = Fastify();
  registerMcpRoutes({ fastify: server, issuer: "https://identity.example.test", resource: "https://api.example.test/mcp",
    authorizer: { authorize: async () => ({ personId, roles: ["owner"] }) }, personContext: new RequestPersonContext(),
    services: {
      weights: { list: unavailable, create: unavailable, correct: unavailable },
      bodyMeasurements: { list: unavailable, create: unavailable, correct: unavailable },
      nutrition: { listMeals: unavailable, createMeal: unavailable, correctMeal: unavailable },
      training: { listWorkoutSessions: unavailable, createWorkoutSession: unavailable, correctWorkoutSession: unavailable,
        findActiveProgram: unavailable, getTrainingContext: unavailable, saveConfirmedProgram: unavailable, completeProgram: unavailable,
        listPrograms: unavailable, findProgramVersion: unavailable, materializeProgramCadence: unavailable,
        classifyExternalActivity: unavailable, setTrustedExternalActivityTitle: unavailable,
        setActivityRecordingMode: unavailable, confirmWorkoutActivityLink: unavailable, getExternalActivityDetails: unavailable },
      recovery: { listObservations: unavailable, createObservation: unavailable, correctObservation: unavailable },
      dailyContextNotes: { list: unavailable, create: unavailable, correct: unavailable },
      currentRecoveryContext: { read: unavailable }, dailyProjection: { projection: unavailable }, ...overrides
    }
  });
  const request = async (method: string, params: object) => {
    const response = await server.inject({ method: "POST", url: "/mcp",
      headers: { accept: "application/json, text/event-stream", authorization: "Bearer synthetic" },
      payload: { jsonrpc: "2.0", id: 1, method, params } });
    expect(response.statusCode).toBe(200);
    return response.json().result;
  };
  return { server, request, call: (name: string, args: object) => request("tools/call", { name, arguments: args }) };
}

describe("MCP canonical result delivery and uncertain writes", () => {
  it("declares an output schema for every advertised writer", async () => {
    const f = fixture();
    try {
      const { tools } = await f.request("tools/list", {});
      const writers = tools.filter((tool: { annotations: { readOnlyHint: boolean } }) => !tool.annotations.readOnlyHint);
      expect(writers).toHaveLength(23);
      for (const tool of writers) expect(tool.outputSchema, tool.name).toMatchObject({ type: "object" });
      const client = new AjvJsonSchemaValidator();
      // Discovery crosses JSON wire boundaries; shared JS object identity cannot
      // hide repeated IDs from the real client's one validator registry.
      for (const tool of JSON.parse(JSON.stringify(tools))) {
        if (tool.outputSchema) expect(() => client.getValidator(tool.outputSchema), tool.name).not.toThrow();
      }
    } finally { await f.server.close(); }
  });

  it("delivers matching canonical JSON to a text-only client without a compulsory read", async () => {
    const create = vi.fn().mockResolvedValue({ created: true, measurement });
    const list = vi.fn().mockResolvedValue({ items: [measurement], nextCursor: null });
    const f = fixture({ weights: { create, list, correct: unavailable } });
    try {
      const saved = await f.call("record_weight_measurement", command);
      expect(saved.isError).not.toBe(true);
      expect(JSON.parse(saved.content[1].text)).toEqual(measurement);
      expect(saved.structuredContent).toEqual(measurement);
      expect(list).not.toHaveBeenCalled();
      const read = await f.call("list_weight_measurements", {});
      expect(JSON.parse(read.content[1].text)).toEqual(read.structuredContent);
      expect(read.structuredContent.items).toEqual([measurement]);
    } finally { await f.server.close(); }
  });

  it.each([undefined, null, {}, "not-a-measurement", { ...measurement, id: "invalid" },
    { ...measurement, weightKg: -1 }, { ...measurement, weightKg: 76.4001 }])(
    "never confirms an invalid stored result: %j", async (value) => {
      const create = vi.fn().mockResolvedValue({ created: true, measurement: value });
      const f = fixture({ weights: { create, list: unavailable, correct: unavailable } });
      try {
        const result = await f.call("record_weight_measurement", command);
        expect(result).toMatchObject({ isError: true, structuredContent: { state: "unknown" } });
        expect(result.content[0].text).toContain("list_weight_measurements");
        expect(result.content[0].text).toContain("original idempotency key");
        expect(create).toHaveBeenCalledOnce();
      } finally { await f.server.close(); }
    }
  );

  it.each([false, true])("verifies state before exact retry when committed=%s", async (committed) => {
    let stored: typeof measurement | undefined;
    const create = vi.fn(async () => {
      if (!stored && committed) { stored = measurement; throw new Error("Synthetic lost acknowledgement"); }
      if (!stored && create.mock.calls.length === 1) throw new Error("Synthetic pre-commit failure");
      const created = !stored;
      stored ??= measurement;
      return { created, measurement: stored };
    });
    const list = vi.fn(async () => ({ items: stored ? [stored] : [], nextCursor: null }));
    const f = fixture({ weights: { create, list, correct: unavailable } });
    try {
      const result = await f.call("record_weight_measurement", command);
      expect(result).toMatchObject({ isError: true, structuredContent: { state: "unknown" } });
      expect(create).toHaveBeenCalledOnce();
      const read = await f.call("list_weight_measurements", {});
      expect(read.structuredContent.items).toHaveLength(committed ? 1 : 0);
      if (!committed) {
        const retry = await f.call("record_weight_measurement", command);
        expect(retry.isError).not.toBe(true);
        expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
      }
      expect((await f.call("list_weight_measurements", {})).structuredContent.items).toEqual([measurement]);
    } finally { await f.server.close(); }
  });

  it("keeps the outcome unknown when its verification read fails", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Synthetic uncertain result"));
    const f = fixture({ weights: { create, list: unavailable, correct: unavailable } });
    try {
      const result = await f.call("record_weight_measurement", command);
      expect(result.content[0].text).toContain("If verification fails or report identity is ambiguous, keep the outcome unknown");
      expect((await f.call("list_weight_measurements", {})).isError).toBe(true);
      expect(create).toHaveBeenCalledOnce();
    } finally { await f.server.close(); }
  });

  it.each([new DomainValidationError("private domain detail"), new ConflictError("private conflict detail")])(
    "distinguishes known rejection from an unknown result", async (error) => {
      const create = vi.fn().mockRejectedValue(error);
      const f = fixture({ weights: { create, list: unavailable, correct: unavailable } });
      try {
        const result = await f.call("record_weight_measurement", command);
        expect(result).toMatchObject({ isError: true, structuredContent: { state: "not_saved" } });
        expect(JSON.stringify(result)).not.toContain(error.message);
        expect(create).toHaveBeenCalledOnce();
      } finally { await f.server.close(); }
    }
  );

  it("does not treat presentation failure after a committed result as domain rejection", async () => {
    const program = { outcome: "created" };
    Object.defineProperty(program, "program", { enumerable: true, get: () => { throw new DomainValidationError("private getter"); } });
    const saveConfirmedProgram = vi.fn().mockResolvedValue(program);
    const f = fixture({ training: { listWorkoutSessions: unavailable, createWorkoutSession: unavailable, correctWorkoutSession: unavailable,
      findActiveProgram: unavailable, getTrainingContext: unavailable, saveConfirmedProgram, completeProgram: unavailable,
      listPrograms: unavailable, findProgramVersion: unavailable, materializeProgramCadence: unavailable,
      classifyExternalActivity: unavailable, setTrustedExternalActivityTitle: unavailable, setActivityRecordingMode: unavailable,
      confirmWorkoutActivityLink: unavailable, getExternalActivityDetails: unavailable } });
    try {
      const result = await f.call("save_confirmed_training_program", { expectedActiveProgramId: null, expectedLockVersion: null,
        name: "Synthetic program", note: null, workouts: [{ name: "A", prescriptions: [{ exerciseVersionId: id,
          loadBasis: "external_weight", targetSets: 3, targetRepsMin: 8, targetRepsMax: 10,
          targetWeightKg: 20, targetRir: 2, progressionIncrementKg: 2, note: null }] }] });
      expect(result).toMatchObject({ isError: true, structuredContent: { state: "unknown", reason: "retryable_failure" } });
      expect(saveConfirmedProgram).toHaveBeenCalledOnce();
      expect(JSON.stringify(result)).not.toContain("private getter");
    } finally { await f.server.close(); }
  });

  it.each([
    { tool: "set_trusted_external_activity_title", method: "setTrustedExternalActivityTitle",
      input: { expectedProgramId: id, expectedProgramVersionId: id, expectedLockVersion: 1,
        workoutPosition: 1, expectedCurrentTitle: null, title: "Synthetic A" },
      result: { outcome: "stale", currentTitle: "Concurrent title" } },
    { tool: "set_activity_recording_mode", method: "setActivityRecordingMode",
      input: { expectedLockVersion: 1, title: "Synthetic strength" },
      result: { outcome: "stale", current: { title: "Concurrent mode", lockVersion: 2, updatedAt: instant } } },
    { tool: "confirm_workout_activity_link", method: "confirmWorkoutActivityLink",
      input: { sessionId: id, externalActivityId: personId, expectedExternalActivityId: null },
      result: { outcome: "stale", sessionId: id, externalActivityId: personId } }
  ])("does not confirm a schema-valid stale result from $tool", async ({ tool, method, input, result }) => {
    const write = vi.fn().mockResolvedValue(result);
    const f = fixture({ training: { listWorkoutSessions: unavailable, createWorkoutSession: unavailable, correctWorkoutSession: unavailable,
      findActiveProgram: unavailable, getTrainingContext: unavailable, saveConfirmedProgram: unavailable, completeProgram: unavailable,
      listPrograms: unavailable, findProgramVersion: unavailable, materializeProgramCadence: unavailable,
      classifyExternalActivity: unavailable, setTrustedExternalActivityTitle: unavailable, setActivityRecordingMode: unavailable,
      confirmWorkoutActivityLink: unavailable, getExternalActivityDetails: unavailable, [method]: write } });
    try {
      const current = await f.call(tool, input);
      expect(current.structuredContent).toEqual(result);
      expect(JSON.parse(current.content[1].text)).toEqual(result);
      expect(current.content[0].text).toContain("The command was not applied");
      expect(current.content[0].text).not.toContain("routine fact has been saved");
      expect(write).toHaveBeenCalledOnce();
    } finally { await f.server.close(); }
  });
});
