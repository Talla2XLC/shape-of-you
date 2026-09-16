import { describe, expect, it } from "vitest";

import type { PoolClient, QueryResult } from "pg";

import {
  addCounterfactualV1Replays,
  loadRetrospectiveEvidence,
  retrospectiveHistoryFrom
} from "../src/commands/run-daily-assessment-retrospective.js";

describe("daily assessment retrospective reader", () => {
  it("loads the maximum candidate lookback before the report interval", () => {
    expect(retrospectiveHistoryFrom("2026-09-15")).toBe("2026-05-18");
  });

  it("uses a read-only transaction and returns normalized facts without provider fields", async () => {
    const statements: string[] = [];
    const responses = [
      { rows: [] },
      { rows: [{
        local_date: "2026-09-01", sleep_minutes: null, hrv_rmssd: "50",
        resting_heart_rate: null, body_battery: null, body_battery_min: null,
        body_battery_max: null,
        acute_illness: false, injury_concern: false,
        assessment_present: false, hard_stop: false, risk_level: null
      }] },
      { rows: [{
        local_date: "2026-09-01", training_load: "42",
        load_series_key: "00000000-0000-4000-8000-000000000100",
        workout_session_count: 0, external_activity_count: 1,
        incompatible_load_sources: false
      }] },
      { rows: [{ available: true }] },
      { rows: [{ local_date: "2026-09-01" }] },
      { rows: [{
        local_date: "2026-09-01", status: "ready",
        action: {
          type: "follow_active_program",
          text: "Follow the active program.",
          trainingProgramVersionId: "00000000-0000-4000-8000-000000000200"
        },
        absolute_guardrail: false
      }] },
      { rows: [] }
    ];
    const client = {
      query: async (statement: string) => {
        statements.push(statement);
        return responses.shift() as QueryResult;
      }
    } as unknown as PoolClient;

    const result = await loadRetrospectiveEvidence(
      client,
      "00000000-0000-4000-8000-000000000001",
      "2026-09-01",
      "2026-09-30"
    );

    expect(statements[0]).toContain("read only");
    expect(statements.at(-1)).toBe("rollback");
    expect(statements.join(" ")).not.toContain("source_provider");
    expect(statements.join(" ")).toContain("source.evidence_purpose = 'person_context'");
    expect(statements.join(" ")).toContain("connection.erasure_requested_at is not null");
    expect(result).toHaveLength(30);
    expect(result[0]).toEqual({
      localDate: "2026-09-01",
      values: { hrv_rmssd: 50, training_load: 42 },
      acuteIllness: false,
      injuryConcern: false,
      recoveryAssessmentPresent: false,
      recoveryHardStop: false,
      baselineExcluded: true,
      trainingLoadIncompatible: false,
      trainingLoadSeriesKey: "00000000-0000-4000-8000-000000000100",
      workoutSessionCount: 0,
      externalActivityCount: 1,
      recoveryRiskLevel: null,
      contextEligibilityAvailable: true,
      v1Status: "ready",
      v1Action: "follow_active_program",
      v1AbsoluteGuardrail: false,
      counterfactualV1: {
        outcome: "comparable", status: "insufficient_data",
        action: "record_recovery_check_in", absoluteGuardrail: false
      }
    });
    expect(result[1]).toMatchObject({
      localDate: "2026-09-02",
      values: {},
      contextEligibilityAvailable: true
    });
  });

  it("treats a malformed stored action as non-comparable", async () => {
    const responses = [
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [{ available: true }] },
      { rows: [] },
      { rows: [{
        local_date: "2026-09-01", status: "ready",
        action: { type: "follow_active_program" }, absolute_guardrail: false
      }] },
      { rows: [] }
    ];
    const client = {
      query: async () => responses.shift() as QueryResult
    } as unknown as PoolClient;

    expect(await loadRetrospectiveEvidence(
      client,
      "00000000-0000-4000-8000-000000000001",
      "2026-09-01",
      "2026-09-01"
    )).toEqual([expect.objectContaining({
      localDate: "2026-09-01",
      values: {},
      contextEligibilityAvailable: true
    })]);
  });

  it("does not query typed context fields when the migration is absent", async () => {
    const statements: string[] = [];
    const responses = [
      { rows: [] }, { rows: [] }, { rows: [] },
      { rows: [{ available: false }] }, { rows: [] }, { rows: [] }
    ];
    const client = {
      query: async (statement: string) => {
        statements.push(statement);
        return responses.shift() as QueryResult;
      }
    } as unknown as PoolClient;

    const result = await loadRetrospectiveEvidence(
      client,
      "00000000-0000-4000-8000-000000000001",
      "2026-09-01",
      "2026-09-01"
    );

    expect(statements.some((statement) => statement.includes("information_schema.columns"))).toBe(true);
    expect(statements.some((statement) => statement.includes("note.baseline_eligibility"))).toBe(false);
    expect(result[0]).toMatchObject({ contextEligibilityAvailable: false });
  });

  it("does not let a future fact change an earlier replay", () => {
    const first = {
      localDate: "2026-09-01", values: { sleep_minutes: 300 },
      acuteIllness: false, injuryConcern: false, recoveryAssessmentPresent: false,
      recoveryHardStop: false, baselineExcluded: false,
      trainingLoadIncompatible: false, trainingLoadSeriesKey: null,
      workoutSessionCount: 0, externalActivityCount: 0
    };
    const future = {
      ...first, localDate: "2026-09-02", values: { sleep_minutes: 600 },
      recoveryHardStop: true
    };

    expect(addCounterfactualV1Replays([first])[0]!.counterfactualV1)
      .toEqual(addCounterfactualV1Replays([first, future])[0]!.counterfactualV1);
  });
});
