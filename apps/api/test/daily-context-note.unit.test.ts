import { describe, expect, it } from "vitest";

import type { CreateDailyContextNote } from "@shape-of-you/contracts";

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
