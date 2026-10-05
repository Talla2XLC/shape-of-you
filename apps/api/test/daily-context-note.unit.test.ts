import { describe, expect, it } from "vitest";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";

import { CreateDailyContextNoteSchema, CorrectDailyContextNoteSchema,
  type CreateDailyContextNote } from "@shape-of-you/contracts";

import { toNewDailyContextNote } from "../src/domain/daily-context-note.js";

const baseInput: CreateDailyContextNote = {
  localDate: "2026-09-15",
  timezone: "Europe/Moscow",
  text: "Usual day",
  dedupeKey: "manual:context:2026-09-15",
  sourceReference: {
    channel: "manual",
    externalSystem: null,
    externalRecordId: null,
    occurredAt: null
  }
};

describe("DailyContextNote baseline eligibility", () => {
  it("publishes the same eligibility combinations and defaults as the writer", () => {
    const ajv = new Ajv({ strict: false });
    (addFormats as unknown as (instance: Ajv) => Ajv)(ajv);
    const create = ajv.compile(CreateDailyContextNoteSchema);
    const correct = ajv.compile(CorrectDailyContextNoteSchema);
    for (const contextKind of [undefined, "general", "travel"] as const) {
      for (const baselineEligibility of [undefined, "include", "exclude"] as const) {
        const input = { ...baseInput,
          ...(contextKind ? { contextKind } : {}),
          ...(baselineEligibility ? { baselineEligibility } : {}) };
        const valid = baselineEligibility === undefined ||
          baselineEligibility === (contextKind === "travel" ? "exclude" : "include");
        expect(create(input), JSON.stringify(input)).toBe(valid);
        expect(correct({ ...input, reason: "Synthetic correction" })).toBe(valid);
        if (valid) {
          expect(toNewDailyContextNote("person", "source", input).baselineEligibility)
            .toBe(contextKind === "travel" ? "exclude" : "include");
        } else {
          expect(() => toNewDailyContextNote("person", "source", input)).toThrow("incompatible");
        }
      }
    }
  });

  it("keeps old commands backward compatible", () => {
    expect(toNewDailyContextNote("person", "source", baseInput)).toMatchObject({
      contextKind: "general",
      baselineEligibility: "include"
    });
  });

  it("turns an explicit travel note into a baseline exclusion", () => {
    expect(toNewDailyContextNote("person", "source", {
      ...baseInput,
      contextKind: "travel",
      dedupeKey: "manual:travel:2026-09-15"
    })).toMatchObject({
      contextKind: "travel",
      baselineEligibility: "exclude"
    });
  });

  it("rejects contradictory context and eligibility", () => {
    expect(() => toNewDailyContextNote("person", "source", {
      ...baseInput,
      contextKind: "travel",
      baselineEligibility: "include"
    })).toThrow("incompatible");
  });
});
