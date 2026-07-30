import { describe, expect, it } from "vitest";

import type {
  BodyMeasurementValueInput,
  PhysicalGoalCriterionInput
} from "@shape-of-you/contracts";

import { validateBodyMeasurementValues } from "../src/domain/body-measurement-session.js";
import { DomainValidationError } from "../src/domain/errors.js";
import { validatePhysicalGoalCriteria } from "../src/domain/physical-goal.js";
import { reconcileWeightMirror } from "../src/domain/weight-source-reconciliation.js";

describe("Physical State domain policies", () => {
  it("rejects duplicate body metrics within one session", () => {
    const values: BodyMeasurementValueInput[] = [
      { metric: "waist", value: 80, unit: "cm" },
      { metric: "waist", value: 81, unit: "cm" }
    ];

    expect(() => validateBodyMeasurementValues(values)).toThrow(
      DomainValidationError
    );
  });

  it("accepts narrative-compatible directional and dynamic criteria", () => {
    const criteria: PhysicalGoalCriterionInput[] = [
      {
        metric: "body_fat_percentage",
        mode: "directional",
        direction: "decrease",
        targetValue: null,
        minimumValue: null,
        maximumValue: null,
        unit: "percent"
      },
      {
        metric: "weight",
        mode: "dynamic",
        direction: null,
        targetValue: null,
        minimumValue: null,
        maximumValue: null,
        unit: "kg"
      }
    ];

    expect(() => validatePhysicalGoalCriteria(criteria)).not.toThrow();
  });

  it("rejects metric/unit and range-shape mismatches", () => {
    expect(() =>
      validatePhysicalGoalCriteria([
        {
          metric: "weight",
          mode: "range",
          direction: null,
          targetValue: null,
          minimumValue: 90,
          maximumValue: 80,
          unit: "cm"
        }
      ])
    ).toThrow(DomainValidationError);
  });

  it("reconciles the legacy weight mirror without creating facts", () => {
    const matched = reconcileWeightMirror(
      [
        {
          sourceRecordId: "Weight!2",
          localDate: "2026-07-28",
          weightKg: 82
        }
      ],
      [
        {
          sourceRecordId: "Daily_Log!2",
          localDate: "2026-07-28",
          weightKg: 82
        }
      ]
    );
    const mismatched = reconcileWeightMirror(
      [
        {
          sourceRecordId: "Weight!2",
          localDate: "2026-07-28",
          weightKg: 82
        }
      ],
      [
        {
          sourceRecordId: "Daily_Log!2",
          localDate: "2026-07-28",
          weightKg: 81
        }
      ]
    );

    expect(matched).toEqual({
      readyForAutomaticImport: true,
      matchedDates: ["2026-07-28"],
      findings: []
    });
    expect(mismatched.readyForAutomaticImport).toBe(false);
    expect(mismatched.findings[0]?.kind).toBe("value_mismatch");
  });
});
