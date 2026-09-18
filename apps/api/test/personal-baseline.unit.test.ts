import { describe, expect, it } from "vitest";

import {
  runDailyAssessmentRetrospective,
  serializeDailyAssessmentRetrospectiveReport,
  type RetrospectiveDailyEvidence
} from "../src/coaching/daily-assessment-retrospective.js";
import {
  compareWithPersonalBaseline,
  personalBaselineCandidates
} from "../src/domain/personal-baseline.js";

function date(day: number): string {
  return `2026-08-${String(day).padStart(2, "0")}`;
}

describe("personal baseline policy", () => {
  const policy = personalBaselineCandidates[0]!;

  it("requires fourteen eligible prior Person-local days and excludes the target day", () => {
    const thirteen = Array.from({ length: 13 }, (_, index) => ({
      localDate: date(index + 1), value: 50, eligible: true
    }));
    expect(compareWithPersonalBaseline(date(14), 40, thirteen, policy).availability)
      .toBe("insufficient_history");

    const fourteen = [...thirteen, { localDate: date(14), value: 50, eligible: true }];
    expect(compareWithPersonalBaseline(date(15), 40, fourteen, policy)).toMatchObject({
      availability: "available",
      position: "below_usual",
      eligibleDayCount: 14
    });
    expect(compareWithPersonalBaseline(date(14), 40, fourteen, policy).availability)
      .toBe("insufficient_history");
  });

  it("ignores excluded days, deduplicates dates, and is stable under input order", () => {
    const samples = Array.from({ length: 15 }, (_, index) => ({
      localDate: date(index + 1), value: 48 + (index % 3), eligible: index !== 3
    }));
    samples.push({ localDate: date(1), value: 999, eligible: true });
    const forward = compareWithPersonalBaseline(date(20), 50, samples, policy);
    const reverse = compareWithPersonalBaseline(date(20), 50, [...samples].reverse(), policy);

    expect(forward).toEqual(reverse);
    expect(forward.eligibleDayCount).toBe(14);
    expect(forward.method).toBe("median_mad");
  });

  it("gives duplicate records within a day no additional baseline weight", () => {
    const samples = Array.from({ length: 14 }, (_, index) => ({
      localDate: date(index + 1), value: 45 + index, eligible: true
    }));
    const duplicated = samples.flatMap((sample) => [sample, { ...sample }]);

    expect(compareWithPersonalBaseline(date(20), 60, duplicated, policy))
      .toEqual(compareWithPersonalBaseline(date(20), 60, samples, policy));
  });

  it("falls back to empirical percentiles when MAD is zero", () => {
    const samples = Array.from({ length: 14 }, (_, index) => ({
      localDate: date(index + 1), value: 50, eligible: true
    }));
    expect(compareWithPersonalBaseline(date(20), 50, samples, policy)).toMatchObject({
      availability: "available",
      position: "within_usual",
      severity: "usual",
      method: "median_percentiles"
    });
  });

  it("requires training evidence to span three calendar weeks", () => {
    const samples = Array.from({ length: 14 }, (_, index) => ({
      localDate: date(index + 1), value: 40 + index, eligible: true
    }));
    expect(compareWithPersonalBaseline(date(15), 60, samples, policy, {
      minimumCalendarSpanDays: policy.minimumTrainingCalendarSpanDays
    }).availability).toBe("insufficient_history");
    const spreadSamples = samples.map((sample, index) => ({
      ...sample,
      localDate: new Date(Date.UTC(2026, 7, 1 + index * 2)).toISOString().slice(0, 10)
    }));
    expect(compareWithPersonalBaseline("2026-09-01", 60, spreadSamples, policy, {
      minimumCalendarSpanDays: policy.minimumTrainingCalendarSpanDays
    }).availability).toBe("available");
  });

  it("emits only aggregates and does not imply recommendation writes", () => {
    const days = Array.from({ length: 24 }, (_, index) => ({
      localDate: date(index + 1),
      values: {
        sleep_minutes: index < 20 ? 480 : 330,
        hrv_rmssd: index < 20 ? 55 : 38,
        resting_heart_rate: index < 20 ? 58 : 72,
        body_battery: index < 20 ? 70 : 28,
        training_load: index % 2 === 0 ? 45 : 60
      },
      acuteIllness: false,
      injuryConcern: false,
      trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      trainingLoadSeriesKey: "load-a", workoutSessionCount: 0,
      baselineExcluded: index === 5,
      v1Status: index < 20 ? "ready" as const : "caution" as const,
      v1Action: index < 20 ? "follow_active_program" as const : "recovery_first" as const,
      v1AbsoluteGuardrail: index >= 20
    }));
    const report = runDailyAssessmentRetrospective(days);
    const serialized = JSON.stringify(report);

    expect(report.candidates).toHaveLength(3);
    expect(report.effects).toEqual({ recommendationsChanged: false, writesPerformed: false });
    expect(report.privacy).toEqual({
      containsDates: false,
      containsRawValues: false,
      containsFactIdentifiers: false
    });
    expect(serialized).not.toContain("2026-08-");
    expect(serialized).not.toContain("999");
    expect(report.candidates[0]!.statusTransitionCount).toBeGreaterThan(0);
    expect(report.candidates[0]!.v1ComparableDayCount).toBe(24);
  });

  it("compares V2 and V3 without dates or raw movement and rejects movement-only recovery", () => {
    const days: RetrospectiveDailyEvidence[] = Array.from({ length: 16 }, (_, index) => ({
      localDate: date(index + 1),
      values: {
        hrv_rmssd: 50 + index % 2,
        steps: index === 15 ? 50_000 : 8_000 + index % 3 * 100
      },
      acuteIllness: false,
      injuryConcern: false,
      baselineExcluded: false,
      trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false,
      recoveryHardStop: false,
      trainingLoadSeriesKey: null,
      workoutSessionCount: 0,
      counterfactualV1: {
        outcome: "comparable",
        status: "ready",
        action: "follow_active_program",
        absoluteGuardrail: false
      }
    }));

    const report = runDailyAssessmentRetrospective(days);

    expect(report.reportVersion).toBe(3);
    expect(report.v2V3Comparison).toMatchObject({
      mode: "completed_day_counterfactual",
      comparableDayCount: 16,
      movementCoverageDayCount: 16,
      movementBaselineAvailableDayCount: 2,
      suspiciousRecoveryFromMovementOnlyCount: 0,
      noMovementBehaviorMismatchCount: 0
    });
    expect(serializeDailyAssessmentRetrospectiveReport(report)).not.toContain("50000");
  });

  it("does not let illness days teach the future baseline", () => {
    const days = Array.from({ length: 20 }, (_, index) => ({
      localDate: date(index + 1),
      values: { hrv_rmssd: index === 14 ? 5 : 50 },
      acuteIllness: index === 14,
      injuryConcern: false,
      trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      trainingLoadSeriesKey: "load-a", workoutSessionCount: 0,
      baselineExcluded: false,
      v1Status: "ready" as const,
      v1Action: "follow_active_program" as const
    }));
    const report = runDailyAssessmentRetrospective(days);

    expect(report.candidates[0]!.baselineAvailableDayCounts.hrv_rmssd).toBe(6);
    expect(report.candidates[0]!.statusCounts.recovery_priority).toBe(1);
  });

  it("does not let explicitly excluded days create a persistent trend", () => {
    const days: RetrospectiveDailyEvidence[] = Array.from({ length: 14 }, (_, index) => ({
      localDate: date(index + 1), values: { hrv_rmssd: 50 }, acuteIllness: false,
      injuryConcern: false, baselineExcluded: false, trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      trainingLoadSeriesKey: "load-a", workoutSessionCount: 0
    }));
    days.push(
      { localDate: date(15), values: { hrv_rmssd: 10 }, acuteIllness: false,
        injuryConcern: false, baselineExcluded: true, trainingLoadIncompatible: false,
        recoveryAssessmentPresent: false, recoveryHardStop: false,
        trainingLoadSeriesKey: "load-a", workoutSessionCount: 0 },
      { localDate: date(16), values: { hrv_rmssd: 10 }, acuteIllness: false,
        injuryConcern: false, baselineExcluded: true, trainingLoadIncompatible: false,
        recoveryAssessmentPresent: false, recoveryHardStop: false,
        trainingLoadSeriesKey: "load-a", workoutSessionCount: 0 }
    );

    const candidate = runDailyAssessmentRetrospective(days).candidates[0]!;
    expect(candidate.persistentTrendDecisionCount).toBe(0);
    expect(candidate.statusCounts.caution).toBe(0);
  });

  it("applies recovery buffers by calendar date rather than the next observed row", () => {
    const days: RetrospectiveDailyEvidence[] = [
      { localDate: "2026-09-01", values: {}, acuteIllness: true,
        injuryConcern: false, baselineExcluded: false, trainingLoadIncompatible: false,
        recoveryAssessmentPresent: false, recoveryHardStop: false,
        trainingLoadSeriesKey: null, workoutSessionCount: 0 },
      { localDate: "2026-09-10", values: { hrv_rmssd: 50 }, acuteIllness: false,
        injuryConcern: false, baselineExcluded: false, trainingLoadIncompatible: false,
        recoveryAssessmentPresent: false, recoveryHardStop: false,
        trainingLoadSeriesKey: "load-a", workoutSessionCount: 0 }
    ];
    const candidate = runDailyAssessmentRetrospective(days).candidates[0]!;

    expect(candidate.excludedBaselineDayCount).toBe(1);
    expect(candidate.exclusionReasonCounts.recovery_buffer).toBe(0);
  });

  it("does not invent status or action without an exact v1 snapshot", () => {
    const common = {
      localDate: "2026-09-01", acuteIllness: false, injuryConcern: false,
      baselineExcluded: false, trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      trainingLoadSeriesKey: null, workoutSessionCount: 0
    };
    const candidate = runDailyAssessmentRetrospective([
      { ...common, values: { sleep_minutes: 480, body_battery_max: 10, body_battery_min: 5 } }
    ]).candidates[0]!;

    expect(candidate.missingV1SnapshotDayCount).toBe(1);
    expect(Object.values(candidate.statusCounts).reduce((sum, count) => sum + count, 0))
      .toBe(0);
    expect(Object.values(candidate.actionCounts).reduce((sum, count) => sum + count, 0))
      .toBe(0);
  });

  it("warms up before the report interval and prevents ready on an adverse center", () => {
    const days: RetrospectiveDailyEvidence[] = Array.from({ length: 15 }, (_, index) => ({
      localDate: date(index + 1),
      values: { sleep_minutes: 300 },
      acuteIllness: false,
      injuryConcern: false,
      baselineExcluded: false,
      trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false,
      recoveryHardStop: false,
      trainingLoadSeriesKey: null,
      workoutSessionCount: 0,
      ...(index === 14 ? {
        v1Status: "ready" as const,
        v1Action: "follow_active_program" as const,
        v1AbsoluteGuardrail: false
      } : {})
    }));

    const candidate = runDailyAssessmentRetrospective(days, date(15)).candidates[0]!;

    expect(candidate.evaluatedDayCount).toBe(1);
    expect(candidate.baselineAvailableDayCounts.sleep_minutes).toBe(1);
    expect(candidate.chronicAdverseBaselineWarningCount).toBe(1);
    expect(candidate.v1ToHybridTransitionCounts["ready->caution"]).toBe(1);
    expect(candidate.actionCounts.recovery_first).toBe(1);
  });

  it("evaluates an adverse center with each candidate's own window and coverage", () => {
    const targetDate = "2026-09-15";
    const shifted = (days: number) => {
      const value = new Date(`${targetDate}T00:00:00.000Z`);
      value.setUTCDate(value.getUTCDate() + days);
      return value.toISOString().slice(0, 10);
    };
    const evidence = [...Array.from({ length: 9 }, (_, index) => -110 + index * 2),
      -10, -8, -6, -4, -2].map((offset) => ({
      localDate: shifted(offset),
      values: { sleep_minutes: 300 },
      acuteIllness: false,
      injuryConcern: false,
      baselineExcluded: false,
      trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false,
      recoveryHardStop: false,
      trainingLoadSeriesKey: null,
      workoutSessionCount: 0
    }));
    const report = runDailyAssessmentRetrospective([...evidence, {
      ...evidence.at(-1)!,
      localDate: targetDate,
      v1Status: "ready" as const,
      v1Action: "follow_active_program" as const,
      v1AbsoluteGuardrail: false
    }], targetDate);
    const byCandidate = new Map(report.candidates.map((candidate) => [
      candidate.candidate,
      candidate
    ]));

    expect(byCandidate.get("responsive")!.baselineAvailableDayCounts.sleep_minutes).toBe(0);
    expect(byCandidate.get("balanced")!.baselineAvailableDayCounts.sleep_minutes).toBe(0);
    expect(byCandidate.get("stable")!.baselineAvailableDayCounts.sleep_minutes).toBe(1);
    expect(byCandidate.get("balanced")!.v1ToHybridTransitionCounts["ready->ready"]).toBe(1);
    expect(byCandidate.get("stable")!.v1ToHybridTransitionCounts["ready->caution"]).toBe(1);
  });

  it("uses the canonical eligible set and even-sample median for adverse centers", () => {
    const days: RetrospectiveDailyEvidence[] = Array.from({ length: 23 }, (_, index) => ({
      localDate: date(index + 1),
      values: { sleep_minutes: index < 7 ? 300 : 400 },
      acuteIllness: false,
      injuryConcern: false,
      baselineExcluded: index >= 14 && index < 22,
      trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false,
      recoveryHardStop: false,
      trainingLoadSeriesKey: null,
      workoutSessionCount: 0,
      ...(index === 22 ? {
        v1Status: "ready" as const,
        v1Action: "follow_active_program" as const,
        v1AbsoluteGuardrail: false
      } : {})
    }));

    const candidate = runDailyAssessmentRetrospective(days, date(23)).candidates[0]!;

    expect(candidate.baselineAvailableDayCounts.sleep_minutes).toBe(1);
    expect(candidate.chronicAdverseBaselineWarningCount).toBe(1);
    expect(candidate.v1ToHybridTransitionCounts["ready->caution"]).toBe(1);
  });

  it("does not count switches across a non-comparable gap", () => {
    const base = {
      values: {}, acuteIllness: false, injuryConcern: false,
      baselineExcluded: false, trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      trainingLoadSeriesKey: null, workoutSessionCount: 0
    };
    const candidate = runDailyAssessmentRetrospective([
      { ...base, localDate: date(1), v1Status: "ready", v1Action: "follow_active_program" },
      { ...base, localDate: date(2) },
      { ...base, localDate: date(3), v1Status: "caution", v1Action: "recovery_first" }
    ]).candidates[0]!;

    expect(candidate.missingV1SnapshotDayCount).toBe(1);
    expect(candidate.statusTransitionCount).toBe(0);
    expect(candidate.abruptReversalCount).toBe(0);
  });

  it("uses counterfactual decisions separately and resets continuity on ambiguity", () => {
    const base = {
      values: {}, acuteIllness: false, injuryConcern: false,
      baselineExcluded: false, trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      trainingLoadSeriesKey: null, workoutSessionCount: 0
    };
    const candidate = runDailyAssessmentRetrospective([
      { ...base, localDate: date(1), counterfactualV1: {
        outcome: "comparable" as const, status: "caution" as const,
        action: "recovery_first" as const, absoluteGuardrail: true
      } },
      { ...base, localDate: date(2), counterfactualV1: {
        outcome: "ambiguous_program_state" as const
      } },
      { ...base, localDate: date(3), counterfactualV1: {
        outcome: "comparable" as const, status: "recovery_priority" as const,
        action: "recovery_first" as const, absoluteGuardrail: true
      } }
    ]).candidates[0]!;

    expect(candidate.storedV1ComparableDayCount).toBe(0);
    expect(candidate.v1ComparableDayCount).toBe(0);
    expect(candidate.counterfactualComparableDayCount).toBe(2);
    expect(candidate.missingV1SnapshotDayCount).toBe(3);
    expect(candidate.counterfactualAmbiguousProgramStateDayCount).toBe(1);
    expect(candidate.counterfactualUnavailableDayCount).toBe(0);
    expect(candidate.statusTransitionCount).toBe(0);
    expect(candidate.counterfactualStatusTransitionCount).toBe(0);
  });

  it("suppresses sensitivity ranking until thirty comparable target days", () => {
    const make = (count: number): RetrospectiveDailyEvidence[] =>
      Array.from({ length: count }, (_, index) => ({
        localDate: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
        values: {}, acuteIllness: false, injuryConcern: false,
        baselineExcluded: false, trainingLoadIncompatible: false,
        recoveryAssessmentPresent: false, recoveryHardStop: false,
        trainingLoadSeriesKey: null, workoutSessionCount: 0,
        counterfactualV1: {
          outcome: "comparable" as const, status: "insufficient_data" as const,
          action: "record_recovery_check_in" as const, absoluteGuardrail: false
        }
      }));

    expect(runDailyAssessmentRetrospective(make(29))).toMatchObject({
      sensitivityRankingMode: "insufficient_evidence",
      sensitivityRanking: []
    });
    expect(runDailyAssessmentRetrospective(make(30))).toMatchObject({
      sensitivityRankingMode: "counterfactual_current_facts_v1"
    });
    expect(runDailyAssessmentRetrospective(make(30)).sensitivityRanking).toHaveLength(3);
  });

  it("never mixes stored and counterfactual transition sequences", () => {
    const base = {
      values: {}, acuteIllness: false, injuryConcern: false,
      baselineExcluded: false, trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      trainingLoadSeriesKey: null, workoutSessionCount: 0,
      v1Status: "ready" as const, v1Action: "follow_active_program" as const
    };
    const candidate = runDailyAssessmentRetrospective([
      { ...base, localDate: date(1), counterfactualV1: {
        outcome: "comparable" as const, status: "caution" as const,
        action: "recovery_first" as const
      } },
      { ...base, localDate: date(2), counterfactualV1: {
        outcome: "comparable" as const, status: "recovery_priority" as const,
        action: "recovery_first" as const
      } }
    ]).candidates[0]!;

    expect(candidate.statusTransitionCount).toBe(0);
    expect(candidate.counterfactualStatusTransitionCount).toBe(1);
    expect(candidate.statusCounts.ready).toBe(2);
    expect(candidate.counterfactualStatusCounts.ready).toBe(0);
  });

  it("reports incompatible Training semantics and freezes a coordinated marked shift", () => {
    const days: RetrospectiveDailyEvidence[] = Array.from({ length: 14 }, (_, index) => ({
      localDate: date(index + 1),
      values: { sleep_minutes: 480 + index % 2, hrv_rmssd: 50 + index % 2,
        resting_heart_rate: 55 + index % 2 },
      acuteIllness: false, injuryConcern: false, baselineExcluded: false,
      trainingLoadIncompatible: false,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      trainingLoadSeriesKey: "load-a", workoutSessionCount: 0
    }));
    days.push({
      localDate: date(15),
      values: { sleep_minutes: 200, hrv_rmssd: 10, resting_heart_rate: 100 },
      acuteIllness: false, injuryConcern: false, baselineExcluded: false,
      trainingLoadIncompatible: true,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      trainingLoadSeriesKey: "load-a", workoutSessionCount: 0
    });
    const candidate = runDailyAssessmentRetrospective(days).candidates[0]!;

    expect(candidate.unstableBaselineDayCount).toBe(1);
    expect(candidate.exclusionReasonCounts.incompatible_training_load).toBe(1);
  });

  it("fails closed if an unapproved field reaches report serialization", () => {
    const report = runDailyAssessmentRetrospective([]);
    expect(() => serializeDailyAssessmentRetrospectiveReport({
      ...report,
      localDate: "2026-09-15"
    } as typeof report)).toThrow("Unsafe report field");
    expect(serializeDailyAssessmentRetrospectiveReport(report)).not.toContain("localDate");
  });

  it("preserves insufficient-data fallback and windowed Recovery hard stops", () => {
    const empty: RetrospectiveDailyEvidence = {
      localDate: "2026-09-01", values: {}, acuteIllness: false, injuryConcern: false,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      baselineExcluded: false, trainingLoadIncompatible: false,
      trainingLoadSeriesKey: null, workoutSessionCount: 0,
      v1Status: "insufficient_data",
      v1Action: "record_recovery_check_in"
    };
    const insufficient = runDailyAssessmentRetrospective([empty]).candidates[0]!;
    expect(insufficient.statusCounts.insufficient_data).toBe(1);
    expect(insufficient.actionCounts.record_recovery_check_in).toBe(1);
    expect(insufficient.v1ToHybridTransitionCounts["insufficient_data->insufficient_data"])
      .toBe(1);

    const hardStop = runDailyAssessmentRetrospective([{
      ...empty,
      recoveryAssessmentPresent: true,
      recoveryHardStop: true,
      v1Status: "recovery_priority",
      v1Action: "recovery_first",
      v1AbsoluteGuardrail: true
    }]).candidates[0]!;
    expect(hardStop.statusCounts.recovery_priority).toBe(1);
  });

  it("separates cross-day Training semantics and uses internal sessions for v1 guardrail", () => {
    const days: RetrospectiveDailyEvidence[] = Array.from({ length: 15 }, (_, index) => ({
      localDate: date(index + 1),
      values: { sleep_minutes: 480, hrv_rmssd: 50, training_load: 40 + index % 2 },
      acuteIllness: false, injuryConcern: false,
      recoveryAssessmentPresent: false, recoveryHardStop: false,
      baselineExcluded: false, trainingLoadIncompatible: false,
      trainingLoadSeriesKey: index < 7 ? "load-a" : "load-b",
      workoutSessionCount: 0
    }));
    const separated = runDailyAssessmentRetrospective(days).candidates[0]!;
    expect(separated.baselineAvailableDayCounts.training_load).toBe(0);
    expect(separated.exclusionReasonCounts.training_source_series_change).toBe(1);

    const sessions = runDailyAssessmentRetrospective([{
      ...days[0]!,
      values: { sleep_minutes: 480, hrv_rmssd: 50 },
      workoutSessionCount: 2,
      v1Status: "caution",
      v1Action: "recovery_first",
      v1AbsoluteGuardrail: true
    }]).candidates[0]!;
    expect(sessions.absoluteGuardrailDayCount).toBe(1);
    expect(sessions.statusCounts.caution).toBe(1);
  });
});
