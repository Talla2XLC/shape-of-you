import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { RequestPersonContext } from "../src/application/person-context.js";
import { DailyAssessmentEvidenceChangedError } from "../src/domain/errors.js";
import { McpAuthorizationError, MCP_READ_SCOPE } from "../src/mcp/oauth.js";
import { registerMcpRoutes } from "../src/mcp/server.js";

const tools = ["get_current_recovery_context", "get_daily_decision_context"] as const;
async function unavailable(): Promise<never> { throw new Error("Unrelated service called"); }

function fixture() {
  const logs: string[] = [];
  const server = Fastify({ logger: { level: "error", stream: { write: (line: string) => logs.push(line) } } });
  const read = vi.fn(async () => ({ state: "timezone_required" as const, timezone: null }));
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
      recovery: { listObservations: unavailable, createObservation: unavailable, correctObservation: unavailable },
      dailyContextNotes: { list: unavailable, create: unavailable, correct: unavailable },
      currentRecoveryContext: { read }, dailyDecisionContext: { read }, dailyProjection: { projection: unavailable }
    }
  });
  const call = async (name: string, args: object = {}) => {
    const response = await server.inject({ method: "POST", url: "/mcp",
      headers: { accept: "application/json, text/event-stream", authorization: "Bearer synthetic-private-token" },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } } });
    expect(response.statusCode).toBe(200);
    return response.json().result;
  };
  return { server, call, read, authorize, logs };
}

const marker = "synthetic-private-failure";
const evidence = new DailyAssessmentEvidenceChangedError();
Object.assign(evidence, { cause: { code: "08006", message: marker } });
const classificationCases = [
  { error: new DailyAssessmentEvidenceChangedError(), reason: "evidence_changed", code: undefined },
  { error: new Error(marker, { cause: evidence }), reason: "evidence_changed", code: "08006" },
  { error: Object.assign(new Error(marker), { name: "DailyAssessmentEvidenceChangedError" }),
    reason: "unclassified", code: undefined },
  { error: new Error(marker), reason: "unclassified", code: undefined },
  { error: marker, reason: "unclassified", code: undefined },
  { error: new Error(marker, { cause: { code: "08006", message: marker } }),
    reason: "database_failure", code: "08006" },
  { error: new Error("timeout exceeded when trying to connect"), reason: "pool_acquisition_timeout", code: undefined },
  { error: new Error(marker, { cause: new Error("timeout exceeded when trying to connect") }),
    reason: "pool_acquisition_timeout", code: undefined },
  { error: new Error("timeout exceeded when trying to connect", { cause: new DailyAssessmentEvidenceChangedError() }),
    reason: "evidence_changed", code: undefined },
  { error: new Error("timeout exceeded when trying to connect", { cause: { code: "08006" } }),
    reason: "database_failure", code: "08006" },
  { error: { message: "timeout exceeded when trying to connect" }, reason: "unclassified", code: undefined },
  { error: new Error("timeout exceeded when trying to connect: " + marker), reason: "unclassified", code: undefined }
];

describe("Composed Recovery MCP read failures", () => {
  it.each(tools.flatMap((tool) => classificationCases.map((testCase, index) => ({ tool, index, ...testCase }))))(
    "$tool classifies error case $index as $reason without private values", async ({ tool, error, reason, code }) => {
      const { server, call, read, logs } = fixture();
      try {
        read.mockRejectedValueOnce(error);
        const result = await call(tool);
        const log = JSON.parse(logs.at(-1)!);
        expect(log).toMatchObject({ failureStage: "execute", failureReason: reason,
          diagnosticId: result.structuredContent.diagnosticId });
        expect(log.databaseCode).toBe(code);
        expect(Object.keys(log).sort()).toEqual(["level", "time", "pid", "hostname", "msg", "reqId",
          "event", "tool", "diagnosticId", "failureCategory", "failureStage", "failureReason",
          ...(code ? ["databaseCode"] : [])].sort());
        expect(result.structuredContent).toEqual({ outcome: "unknown", reason: "read_failed",
          diagnosticId: expect.any(String) });
        expect(JSON.stringify(result) + JSON.stringify(log)).not.toContain(marker);
      } finally { await server.close(); }
    });

  it.each(tools)("%s distinguishes answer formation from service execution", async (tool) => {
    const { server, call, read, logs } = fixture();
    const result = { state: "timezone_required" as const, timezone: null };
    const isArray = Array.isArray;
    // Inject a fault at successResult's inspection without failing Promise resolution.
    const inspection = vi.spyOn(Array, "isArray").mockImplementation((value) => {
      if (value === result) { throw new Error("synthetic-private-presentation"); }
      return isArray(value);
    });
    read.mockResolvedValueOnce(result);
    try {
      const failed = await call(tool);
      expect(failed.structuredContent.reason).toBe("read_failed");
      expect(JSON.parse(logs[0]!)).toMatchObject({ failureStage: "present", failureReason: "unclassified" });
      expect(JSON.stringify(failed) + logs.join("")).not.toContain("synthetic-private-presentation");
      expect((await call(tool)).isError).not.toBe(true);
      expect(logs).toHaveLength(1);
    } finally { inspection.mockRestore(); await server.close(); }
  });

  it("bounds cause traversal for recognized and unrecognized nested errors", async () => {
    const { server, call, read, logs } = fixture();
    const wrap = (cause: unknown) => new Error("synthetic-private-nested", { cause });
    try {
      for (const leaf of [new DailyAssessmentEvidenceChangedError(), { code: "08006" },
        new Error("timeout exceeded when trying to connect")]) {
        read.mockRejectedValueOnce(wrap(wrap(wrap(leaf))));
        await call("get_daily_decision_context");
        expect(JSON.parse(logs.at(-1)!).failureReason).toBe(
          leaf instanceof DailyAssessmentEvidenceChangedError ? "evidence_changed" :
            leaf instanceof Error ? "pool_acquisition_timeout" : "database_failure");
        read.mockRejectedValueOnce(wrap(wrap(wrap(wrap(leaf)))));
        await call("get_daily_decision_context");
        expect(JSON.parse(logs.at(-1)!).failureReason).toBe("unclassified");
      }
      expect(logs.join("")).not.toContain("synthetic-private-nested");
    } finally { await server.close(); }
  });

  it.each(tools)("%s correlates a transient failure privately and does not retain it after a successful read", async (tool) => {
    const { server, call, read, authorize, logs } = fixture();
    const privateMarker = "synthetic-private-health-person-sql-marker";
    read.mockRejectedValueOnce(new Error(privateMarker, { cause: { code: "08006", message: privateMarker, query: privateMarker } }));
    try {
      const failed = await call(tool);
      expect(authorize).toHaveBeenCalledWith("Bearer synthetic-private-token", MCP_READ_SCOPE, false);
      expect(failed).toMatchObject({ isError: true,
        structuredContent: { outcome: "unknown", reason: "read_failed", diagnosticId: expect.any(String) } });
      const id = failed.structuredContent.diagnosticId;
      expect(id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
      expect(failed.content[0].text).toContain(`Diagnostic ID: ${id}`);
      expect(logs).toHaveLength(1);
      const log = JSON.parse(logs[0]!);
      expect(log).toMatchObject({ event: "mcp_context_read_failed", tool, diagnosticId: id,
        failureCategory: "execution_failure", failureStage: "execute",
        failureReason: "database_failure", databaseCode: "08006" });
      expect(Object.keys(log).sort()).toEqual(["level", "time", "pid", "hostname", "msg", "reqId",
        "event", "tool", "diagnosticId", "failureCategory", "failureStage", "failureReason", "databaseCode"].sort());
      for (const output of [JSON.stringify(failed), logs.join("")]) {
        expect(output).not.toContain(privateMarker);
        expect(output).not.toContain("synthetic-private-token");
        expect(output).not.toContain("00000000-0000-4000-8000-000000000001");
      }
      expect(failed.structuredContent).not.toHaveProperty("databaseCode");
      expect(failed.structuredContent).not.toHaveProperty("failureReason");
      expect(failed.structuredContent).not.toHaveProperty("failureStage");
      const text = failed.content[0].text;
      expect(text).toContain("does not establish invalid input or missing source data");
      expect(text).not.toContain("do not recommend today's strength workout");
      expect(text).toContain("Resleep alone does not establish readiness");
      expect(text).toContain("never assume normal wellbeing unless reported");
      expect(text).toContain("never promise recovery or training suitability tomorrow");
      expect(text).toContain("A successful context with missing metrics also preserves uncertainty");
      expect(text).toContain("A failed focused Recovery read does not invalidate a separately successful current daily context");
      expect(text).toContain("Do not include diagnosticId in an ordinary Coach reply");
      const success = await call(tool);
      expect(success.isError).not.toBe(true);
      expect(success.structuredContent).toEqual({ state: "timezone_required", timezone: null });
      expect(JSON.stringify(success)).not.toContain(id);
      expect(logs).toHaveLength(1);
      expect(read).toHaveBeenCalledTimes(2);
    } finally { await server.close(); }
  });

  it.each(tools)("%s rejects invalid input before authorization and does not log execution failure", async (tool) => {
    const { server, call, read, authorize, logs } = fixture();
    try {
      const result = await call(tool, { localDate: "synthetic-private-invalid-field" });
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.reason).not.toBe("read_failed");
      expect(JSON.stringify(result)).not.toContain("synthetic-private-invalid-field");
      expect(read).not.toHaveBeenCalled();
      expect(authorize).not.toHaveBeenCalled();
      expect(logs).toHaveLength(0);
    } finally { await server.close(); }
  });

  it.each(tools)("%s preserves authorization failure without calling or logging the read", async (tool) => {
    const { server, call, read, authorize, logs } = fixture();
    authorize.mockRejectedValueOnce(new McpAuthorizationError("Insufficient scope", "insufficient_scope"));
    try {
      const result = await call(tool);
      expect(result.isError).toBe(true);
      expect(result._meta["mcp/www_authenticate"][0]).toContain("insufficient_scope");
      expect(result.structuredContent?.reason).not.toBe("read_failed");
      expect(read).not.toHaveBeenCalled();
      expect(logs).toHaveLength(0);
    } finally { await server.close(); }
  });

  it.each(["ALICE", "TOKEN", "12345", "synthetic-private-code"])("omits arbitrary error code %s and handles cyclic causes", async (code) => {
    const { server, call, read, logs } = fixture();
    const cause: Record<string, unknown> = { code };
    cause.cause = cause;
    read.mockRejectedValueOnce(new Error("synthetic-private-message", { cause }));
    try {
      await call("get_daily_decision_context");
      expect(JSON.parse(logs[0]!)).not.toHaveProperty("databaseCode");
      expect(JSON.parse(logs[0]!)).toMatchObject({ failureStage: "execute", failureReason: "unclassified" });
      expect(logs.join("")).not.toContain(code);
      expect(logs.join("")).not.toContain("synthetic-private-message");
    } finally { await server.close(); }
  });

  it.each(tools)("%s does not label an unexpected authorization exception as a context execution failure", async (tool) => {
    const { server, call, read, authorize, logs } = fixture();
    authorize.mockRejectedValueOnce(new Error("synthetic-private-auth-backend-error"));
    try {
      const result = await call(tool);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("synthetic-private-auth-backend-error");
      expect(read).not.toHaveBeenCalled();
      expect(logs).toHaveLength(0);
    } finally { await server.close(); }
  });

  it("does not widen diagnostics to unrelated reads", async () => {
    const { server, call, logs } = fixture();
    try {
      const result = await call("list_recovery_observations");
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(logs).toHaveLength(0);
    } finally { await server.close(); }
  });
});
