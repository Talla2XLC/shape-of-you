import { describe, expect, it } from "vitest";
import { CreateWorkoutSessionV2Schema, CorrectWorkoutSessionV2Schema } from "@shape-of-you/contracts";
import { connectorWorkoutV2Schema } from "../src/mcp/workout-input-schema.js";

describe("V2 connector workout schema", () => {
  it.each([false, true])("publishes all common fields and combined set measurements: correction=%s", (correction) => {
    const original = correction ? CorrectWorkoutSessionV2Schema : CreateWorkoutSessionV2Schema;
    const snapshot = structuredClone(original);
    const result = connectorWorkoutV2Schema(original, correction);
    expect(result.anyOf).toBeUndefined();
    for (const [name, property] of Object.entries(original.properties)) {
      if (name !== "exercises") expect(result.properties[name]).toEqual(property);
    }
    const exercise = result.properties.exercises as typeof original.properties.exercises;
    const set = exercise.items.properties.sets.items;
    expect((set as Record<string, unknown>).anyOf).toBeUndefined();
    expect(Object.keys(set.properties)).toEqual(["weightKg", "reps", "durationSeconds", "distanceMeters", "rir"]);
    expect(set.properties).toEqual(original.properties.exercises.items.properties.sets.items.properties);
    expect(result.required).not.toContain("sourceReference");
    expect(Boolean(result.properties.startReportedNow)).toBe(!correction);
    expect(original).toEqual(snapshot);
    expect(original.anyOf).toBeDefined();
    expect(original.properties.exercises.items.properties.sets.items.anyOf).toBeDefined();
  });
});
