import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { RequestPersonContext } from "../src/application/person-context.js";
import { ConflictError, DomainValidationError, NotFoundError } from "../src/domain/errors.js";
import { registerMcpRoutes } from "../src/mcp/server.js";

async function unavailable(): Promise<never> { throw new Error("Unrelated service called"); }

const sourceReference = { channel: "manual", externalSystem: "synthetic_screenshot",
  externalRecordId: "synthetic:report", occurredAt: null };
const note = { localDate: "2026-10-05", timezone: "Europe/Belgrade", text: "Synthetic resleep report",
  contextKind: "general", dedupeKey: "synthetic:context", sourceReference };
const recovery = { localDate: note.localDate, timezone: note.timezone, kind: "metric",
  temporalPrecision: "local_date", quality: "reliable", dedupeKey: "synthetic:nightly",
  sourceReference, detail: { type: "metric", metric: "hrv_rmssd", value: 51, unit: "ms" } };

function fixture(error?: unknown) {
  const logs: string[] = [];
  const server = Fastify({ logger: { level: "error", stream: { write: (line: string) => logs.push(line) } } });
  const write = vi.fn(async (): Promise<never> => {
    throw error ?? new Error("Writer must not be called for invalid input");
  });
  const authorize = vi.fn(async () => ({ personId: "00000000-0000-4000-8000-000000000001", roles: ["owner"] as const }));
  registerMcpRoutes({ fastify: server, issuer: "https://identity.example.test", resource: "https://api.example.test/mcp",
    authorizer: { authorize }, personContext: new RequestPersonContext(),
    services: {
      weights: { list: unavailable, create: unavailable, correct: unavailable },
      bodyMeasurements: { list: unavailable, create: unavailable, correct: unavailable },
      nutrition: { listMeals: unavailable, createMeal: unavailable, correctMeal: unavailable },
      training: { listWorkoutSessions: unavailable, createWorkoutSession: unavailable,
        correctWorkoutSession: unavailable, findActiveProgram: unavailable,
        getTrainingContext: unavailable, saveConfirmedProgram: unavailable, materializeProgramCadence: unavailable,
        classifyExternalActivity: unavailable, setTrustedExternalActivityTitle: unavailable,
        setActivityRecordingMode: unavailable, confirmWorkoutActivityLink: unavailable, getExternalActivityDetails: unavailable },
      recovery: { listObservations: unavailable, createObservation: write, correctObservation: write },
      dailyContextNotes: { list: unavailable, create: write, correct: write },
      currentRecoveryContext: { read: unavailable }, dailyProjection: { projection: unavailable }
    }
  });
  const call = async (name: string, args: object) => {
    const response = await server.inject({ method: "POST", url: "/mcp",
      headers: { accept: "application/json, text/event-stream", authorization: "Bearer test" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } });
    expect(response.statusCode).toBe(200);
    return response.json().result;
  };
  return { server, call, write, authorize, logs };
}

describe("Recovery and context note MCP failure diagnostics", () => {
  it.each(["record_daily_context_note", "correct_daily_context_note"])(
    "%s identifies contradictory baseline eligibility before calling a writer", async (tool) => {
      const { server, call, write, authorize } = fixture();
      try {
        const args = { ...note, baselineEligibility: "exclude", ...(tool.startsWith("correct")
          ? { id: "00000000-0000-4000-8000-000000000002", reason: "Synthetic clarification" } : {}) };
        const result = await call(tool, args);
        expect(result).toMatchObject({ isError: true,
          structuredContent: { outcome: "not_saved", reason: "invalid_baseline_eligibility" } });
        expect(result.content[0].text).toContain("General notes require baselineEligibility=include");
        expect(write).not.toHaveBeenCalled();
        expect(authorize).not.toHaveBeenCalled();
      } finally { await server.close(); }
    });

  it("distinguishes malformed input from an execution failure", async () => {
    const { server, call, write, logs } = fixture();
    try {
      const result = await call("record_recovery_observation", { ...recovery, detail: { ...recovery.detail, value: "unknown" } });
      expect(result).toMatchObject({ isError: true, structuredContent: { reason: "invalid_input" } });
      expect(write).not.toHaveBeenCalled();
      expect(logs).toHaveLength(0);
    } finally { await server.close(); }
  });

  it.each([
    [new DomainValidationError("private-domain-message"), "invalid_fact"],
    [new ConflictError("private-conflict-message"), "stale_or_conflicting_fact"],
    [new NotFoundError("private-missing-message"), "stale_or_conflicting_fact"]
  ])("returns a bounded cause for known domain failures: %s", async (error, reason) => {
    const { server, call, logs } = fixture(error);
    try {
      const result = await call("record_recovery_observation", recovery);
      expect(result).toMatchObject({ isError: true, structuredContent: { outcome: "not_saved", reason } });
      expect(JSON.stringify(result)).not.toContain((error as Error).message);
      expect(logs).toHaveLength(0);
    } finally { await server.close(); }
  });

  it.each(["record_recovery_observation", "correct_recovery_observation",
    "record_daily_context_note", "correct_daily_context_note"])(
    "%s correlates execution failures without logging payloads, SQL or raw exceptions", async (tool) => {
      const secretMarker = "private-health-and-token-marker";
      const error = new Error(`SQL and parameters ${secretMarker}`, {
        cause: { code: "23514", message: secretMarker, detail: secretMarker, query: secretMarker }
      });
      const { server, call, write, logs } = fixture(error);
      try {
        const base = tool.includes("context_note") ? { ...note, text: secretMarker } : recovery;
        const result = await call(tool, { ...base, dedupeKey: secretMarker,
          ...(tool.startsWith("correct") ? { id: "00000000-0000-4000-8000-000000000002",
            reason: secretMarker } : {}) });
        expect(result).toMatchObject({ isError: true, structuredContent: { outcome: "not_saved", reason: "write_failed" } });
        expect(result.structuredContent.diagnosticId).toMatch(/^[0-9a-f-]{36}$/u);
        expect(result.content[0].text).toContain(`Diagnostic ID: ${result.structuredContent.diagnosticId}`);
        expect(write).toHaveBeenCalledOnce();
        expect(logs).toHaveLength(1);
        const logged = JSON.parse(logs[0]!);
        expect(logged).toMatchObject({ event: "mcp_fact_write_failed", tool,
          diagnosticId: result.structuredContent.diagnosticId, failureCategory: "execution_failure", databaseCode: "23514" });
        for (const output of [JSON.stringify(result), logs.join("")]) {
          expect(output).not.toContain(secretMarker);
          expect(output).not.toContain("synthetic:report");
          expect(output).not.toContain("Bearer test");
        }
        expect(result.content[0].text).toContain("Do not speculate about the cause or retry blindly");
      } finally { await server.close(); }
    });

  it.each(["secret-arbitrary-code", "ALICE", "TOKEN", "12345"])(
    "does not serialize arbitrary error code %s and bounds cyclic causes", async (code) => {
    const cause: Record<string, unknown> = { code };
    cause.cause = cause;
    const { server, call, logs } = fixture(new Error("private-message", { cause }));
    try {
      const result = await call("record_recovery_observation", recovery);
      expect(result.structuredContent.reason).toBe("write_failed");
      expect(JSON.parse(logs[0]!)).not.toHaveProperty("databaseCode");
      expect(logs.join("")).not.toContain(code);
    } finally { await server.close(); }
  });
});
