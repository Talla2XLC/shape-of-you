import { describe, expect, it } from "vitest";
import { CreateWorkoutSessionV2Schema, CorrectWorkoutSessionV2Schema, type WorkoutSession } from "@shape-of-you/contracts";
import { JsonSchemaPipe } from "../src/http/json-schema.js";
import { legacyWorkoutSession } from "../src/training/workout-compatibility.js";
import { MCP_COACH_FINAL_RESPONSE_REQUIREMENT, MCP_OPERATIONAL_INSTRUCTIONS } from "../src/mcp/server.js";

const input = {
  temporalPrecision: "local_date", localDate: "2026-10-02", timezone: "Europe/Belgrade",
  completionState: "completed", workoutName: "A", dedupeKey: "reported-a",
  sourceReference: { channel: "manual", externalSystem: null, externalRecordId: null, occurredAt: null },
  exercises: [
    { exerciseLabel: "Smith-присед", loadBasis: "external_weight", note: "60 кг блинов; RIR 1–2", sets: Array.from({ length: 3 }, () => ({ weightKg: 60, reps: 10 })) },
    { exerciseLabel: "Разведения", sets: [] },
    { exerciseLabel: "Пресс", note: "Дальше тяжко", sets: Array.from({ length: 3 }, () => ({ weightKg: 15, reps: 12 })) }
  ]
};

describe("gradually reported WorkoutSession V2", () => {
  const create = new JsonSchemaPipe(CreateWorkoutSessionV2Schema);
  it("accepts reported work, unresolved names, unknown sets and day-only occurrence", () => {
    expect(create.transform(input)).toEqual(input);
    expect(create.transform({ ...input, completionState: "in_progress" })).toMatchObject({ completionState: "in_progress" });
    expect(create.transform({ ...input, exercises: [] })).toMatchObject({ exercises: [] });
    expect(create.transform({ ...input, exercises: [{ exerciseLabel: "Press", sets: [{ weightKg: 15 }] }] })).toBeDefined();
  });
  it("rejects fabricated temporal combinations, empty measured sets and invalid precision", () => {
    for (const candidate of [
      { ...input, occurredAt: "2026-10-02T12:00:00Z" },
      { ...input, localDate: undefined },
      { ...input, completionState: "maybe" },
      { ...input, exercises: [{ exerciseLabel: "Press", sets: [{}] }] },
      { ...input, exercises: [{ exerciseLabel: "Press", sets: [{ weightKg: null, reps: null, rir: null }] }] },
      { ...input, exercises: [{ exerciseLabel: "Press", sets: [{ reps: 0 }] }] },
      { ...input, exercises: [{ exerciseLabel: "Press", sets: [{ rir: 1.3 }] }] }
    ]) expect(() => create.transform(candidate)).toThrow();
  });
  it("requires a reason for the immutable full replacement", () => {
    const correct = new JsonSchemaPipe(CorrectWorkoutSessionV2Schema);
    expect(() => correct.transform(input)).toThrow();
    expect(correct.transform({ ...input, correctionReason: "Закончил" })).toBeDefined();
  });
  it("fails legacy reads explicitly rather than hiding unresolved or ongoing work", () => {
    const fact = { ...input, exercises: [{ exerciseId: null, exerciseVersionId: null, loadBasis: null }] } as unknown as WorkoutSession;
    expect(() => legacyWorkoutSession(fact)).toThrow(/V2/);
    expect(() => legacyWorkoutSession({ ...fact, exercises: [], completionState: "in_progress" })).toThrow(/V2/);
  });
  it("permits acknowledgement without mandatory advice and explicit permanent substitution", () => {
    expect(MCP_COACH_FINAL_RESPONSE_REQUIREMENT).toContain("acknowledgement can be a complete answer");
    expect(MCP_COACH_FINAL_RESPONSE_REQUIREMENT).not.toMatch(/MUST end|mandatory|incomplete/);
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain("explicit targeted replacement");
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain("preserve all untouched prescriptions and cadence");
    expect(MCP_OPERATIONAL_INSTRUCTIONS).toContain("clarify significant unspecified load");
  });
});
