import { describe, expect, it } from "vitest";

import type { IntakeItem } from "@shape-of-you/contracts";

import { deriveIntakeRequestStatus } from "../src/domain/intake.js";

function item(status: IntakeItem["status"]): IntakeItem {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    position: 0,
    kind: "weight_measurement",
    status,
    confidence: null,
    clarificationQuestion:
      status === "needs_clarification" ? "Какой вес?" : null,
    detail: null,
    createdAt: "2026-08-02T06:00:00.000Z",
    updatedAt: "2026-08-02T06:00:00.000Z"
  };
}

describe("Intake request projection", () => {
  it("derives queue and parser lifecycle before item processing", () => {
    expect(deriveIntakeRequestStatus("queued", [])).toBe("queued");
    expect(deriveIntakeRequestStatus("processing", [])).toBe("processing");
    expect(deriveIntakeRequestStatus("failed", [])).toBe("failed");
  });

  it("keeps ambiguous siblings actionable while exposing partial progress", () => {
    expect(
      deriveIntakeRequestStatus("parsed", [
        item("awaiting_confirmation"),
        item("needs_clarification")
      ])
    ).toBe("awaiting_action");
    expect(
      deriveIntakeRequestStatus("parsed", [
        item("completed"),
        item("awaiting_confirmation")
      ])
    ).toBe("partial");
  });

  it("derives terminal outcomes without a mutable request status", () => {
    expect(
      deriveIntakeRequestStatus("parsed", [item("completed"), item("completed")])
    ).toBe("completed");
    expect(
      deriveIntakeRequestStatus("parsed", [item("failed"), item("failed")])
    ).toBe("failed");
    expect(
      deriveIntakeRequestStatus("parsed", [item("completed"), item("failed")])
    ).toBe("partial");
  });
});
