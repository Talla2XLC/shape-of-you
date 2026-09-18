import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { Pool, type PoolClient } from "pg";

import {
  runDailyAssessmentRetrospective,
  serializeDailyAssessmentRetrospectiveReport,
  type RetrospectiveDailyEvidence
} from "../coaching/daily-assessment-retrospective.js";
import {
  personalBaselineCandidates,
  type PersonalBaselineMetric
} from "../domain/personal-baseline.js";
import {
  evaluateCounterfactualDailyAssessmentV1,
  type CounterfactualDailyAssessmentFacts
} from "../domain/daily-assessment-counterfactual.js";
import { buildCoverageDirection } from "../progress-overview/progress-data-coverage.policy.js";
import { readRecoveryBaselineDays } from "../recovery/personal-baseline-history.js";
import { readTrainingBaselineDays } from "../training/personal-baseline-history.js";

interface ExclusionRow {
  readonly local_date: string;
}

interface ContextSchemaRow {
  readonly available: boolean;
}

interface V1SnapshotRow {
  readonly local_date: string;
  readonly status: "ready" | "caution" | "recovery_priority" | "insufficient_data";
  readonly action: unknown;
  readonly absolute_guardrail: boolean;
}

type V1Action = NonNullable<RetrospectiveDailyEvidence["v1Action"]>;
const v1ActionTypes = new Set<V1Action>([
  "recovery_first", "record_recovery_check_in", "follow_active_program",
  "complete_nutrition_record", "record_weight", "confirm_training_program"
]);

function parseV1Action(value: unknown): V1Action | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([key]) => !["type", "text", "trainingProgramVersionId"].includes(key))) {
    return null;
  }
  const action = value as Record<string, unknown>;
  if (
    typeof action.type !== "string" || !v1ActionTypes.has(action.type as V1Action) ||
    typeof action.text !== "string" || action.text.length < 1 || action.text.length > 512 ||
    !(action.trainingProgramVersionId === null ||
      (typeof action.trainingProgramVersionId === "string" &&
       /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
         .test(action.trainingProgramVersionId)))
  ) return null;
  return action.type as V1Action;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required runtime value ${name}`);
  return normalized;
}

function parseLocalDate(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must be an ISO local date`);
  }
  return value;
}

function rangeLength(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  ) + 1;
}

function addCalendarDays(localDate: string, days: number): string {
  const value = new Date(`${localDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Returns the bounded warm-up start shared by every shadow candidate. */
export function retrospectiveHistoryFrom(reportFrom: string): string {
  const maximumLookbackDays = Math.max(
    ...personalBaselineCandidates.map((candidate) => candidate.maximumLookbackDays)
  );
  return addCalendarDays(reportFrom, -maximumLookbackDays);
}

function median(values: readonly number[]): number | null {
  if (values.length < 7) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function coverageStatus(
  key: "sleep" | "hrv" | "resting_heart_rate" | "body_battery" | "training",
  targetDate: string,
  days: readonly RetrospectiveDailyEvidence[],
  usable: (day: RetrospectiveDailyEvidence) => boolean
): "good" | "partial" | "sparse" {
  const evidenceDays = days
    .filter((day) => day.localDate <= targetDate && usable(day))
    .map((day) => ({ localDate: day.localDate, usable: true }));
  return buildCoverageDirection(key, targetDate, {
    firstDataDate: evidenceDays[0]?.localDate ?? null,
    lastDataDate: evidenceDays.at(-1)?.localDate ?? null,
    days: evidenceDays
  }).status;
}

/**
 * Adds a v1 decision envelope from normalized current facts. Nutrition, weight
 * and evidence identifiers are deliberately absent: a decision is exposed
 * only when recovery/training facts dominate both TrainingProgram branches,
 * making those omitted fields unable to change status or action type.
 */
export function addCounterfactualV1Replays(
  inputDays: readonly RetrospectiveDailyEvidence[]
): readonly RetrospectiveDailyEvidence[] {
  const days = [...inputDays].sort((left, right) => left.localDate.localeCompare(right.localDate));
  return days.map((day) => {
    const hasDecisionEvidence = day.recoveryAssessmentPresent ||
      day.recoveryHardStop || day.acuteIllness || day.injuryConcern ||
      day.workoutSessionCount > 0 || (day.externalActivityCount ?? 0) > 0 ||
      Object.keys(day.values).length > 0;
    if (!hasDecisionEvidence) return day;
    const historyFrom = addCalendarDays(day.localDate, -28);
    const recentFrom = addCalendarDays(day.localDate, -2);
    const prior = days.filter((candidate) =>
      candidate.localDate >= historyFrom && candidate.localDate < day.localDate
    );
    const recent = days.filter((candidate) =>
      candidate.localDate >= recentFrom && candidate.localDate <= day.localDate
    );
    const priorMetric = (metric: PersonalBaselineMetric) => prior
      .map((candidate) => candidate.values[metric])
      .filter((value): value is number => value !== undefined && Number.isFinite(value));
    const facts: CounterfactualDailyAssessmentFacts = {
      recoveryObservationIds: [],
      recoveryAssessmentIds: day.recoveryAssessmentPresent
        ? ["00000000-0000-4000-8000-000000000002"]
        : [],
      workoutSessionIds: [],
      externalActivityIds: [],
      mealIds: [],
      weightMeasurementIds: [],
      coveragePolicyVersion: "profile-data-coverage-v1",
      coverageReadiness: {
        sleep: coverageStatus("sleep", day.localDate, days, (item) => item.values.sleep_minutes !== undefined),
        hrv: coverageStatus("hrv", day.localDate, days, (item) => item.values.hrv_rmssd !== undefined),
        restingHeartRate: coverageStatus("resting_heart_rate", day.localDate, days, (item) => item.values.resting_heart_rate !== undefined),
        bodyBattery: coverageStatus("body_battery", day.localDate, days, (item) =>
          item.values.body_battery !== undefined ||
          (item.values.body_battery_min !== undefined && item.values.body_battery_max !== undefined)
        ),
        training: coverageStatus("training", day.localDate, days, (item) =>
          item.workoutSessionCount > 0 || (item.externalActivityCount ?? 0) > 0
        ),
        weight: "sparse",
        nutrition: "sparse"
      },
      summary: {
        recoveryRiskLevel: day.recoveryRiskLevel ?? null,
        recoveryHardStop: day.recoveryHardStop || day.acuteIllness || day.injuryConcern,
        sleepMinutes: day.values.sleep_minutes ?? null,
        hrvMs: day.values.hrv_rmssd ?? null,
        hrvBaselineMs: median(priorMetric("hrv_rmssd")),
        restingHeartRateBpm: day.values.resting_heart_rate ?? null,
        restingHeartRateBaselineBpm: median(priorMetric("resting_heart_rate")),
        bodyBattery: day.values.body_battery ?? null,
        bodyBatteryMin: day.values.body_battery_min ?? null,
        bodyBatteryMax: day.values.body_battery_max ?? null,
        recentWorkoutCount: recent.reduce((sum, item) => sum + item.workoutSessionCount, 0),
        recentExternalActivityCount: recent.reduce((sum, item) => sum + (item.externalActivityCount ?? 0), 0),
        recentTrainingLoad: recent.some((item) => item.values.training_load !== undefined)
          ? recent.reduce((sum, item) => sum + (item.values.training_load ?? 0), 0)
          : null,
        nutritionCompleteness: "complete",
        mealCount: 0,
        caloriesKcal: null,
        proteinG: null,
        latestWeightKg: null
      }
    };
    return { ...day, counterfactualV1: evaluateCounterfactualDailyAssessmentV1(facts) };
  });
}

/**
 * Loads only provider-neutral typed facts in a read-only repeatable-read
 * transaction. Raw rows remain process-local and are never returned or logged.
 */
export async function loadRetrospectiveEvidence(
  client: PoolClient,
  personId: string,
  from: string,
  to: string
): Promise<readonly RetrospectiveDailyEvidence[]> {
  await client.query("begin transaction isolation level repeatable read read only");
  try {
    const recovery = await readRecoveryBaselineDays(client, personId, from, to);
    const training = await readTrainingBaselineDays(client, personId, from, to);
    const contextSchema = await client.query<ContextSchemaRow>(
      `select count(*) = 2 as available
       from information_schema.columns
       where table_schema = current_schema()
         and table_name = 'daily_context_notes'
         and column_name in ('context_kind', 'baseline_eligibility')`
    );
    const contextEligibilityAvailable = contextSchema.rows[0]?.available === true;
    const exclusions = contextEligibilityAvailable
      ? await client.query<ExclusionRow>(`select distinct note.local_date::text
       from daily_context_notes note
       join source_references source
         on source.id = note.source_reference_id
        and source.person_id = note.person_id
       where note.person_id = $1
         and note.local_date between $2 and $3
         and note.baseline_eligibility = 'exclude'
         and source.evidence_purpose = 'person_context'
         and not exists (
           select 1 from daily_context_notes successor
           where successor.person_id = note.person_id
             and successor.supersedes_id = note.id
         )`,
      [personId, from, to])
      : { rows: [] as ExclusionRow[] };
    const v1Snapshots = await client.query<V1SnapshotRow>(
      `with latest_v1 as (
         select distinct on (detail.local_date)
                recommendation.id as recommendation_id,
                detail.local_date,
                detail.status,
                detail.recommended_action,
                detail.reasons,
                detail.used_facts
         from coaching_daily_assessment_details detail
         join coaching_recommendations recommendation
           on recommendation.id = detail.recommendation_id
          and recommendation.person_id = detail.person_id
         where detail.person_id = $1
           and detail.local_date between $2 and $3
           and detail.policy_version = 'daily-assessment-v1'
         order by detail.local_date, recommendation.created_at desc, recommendation.id desc
       )
       select snapshot.local_date::text,
              snapshot.status::text,
              snapshot.recommended_action as action,
              snapshot.reasons && array[
                'recovery_hard_stop', 'short_sleep', 'low_body_battery',
                'recent_training_load'
              ]::text[] as absolute_guardrail
       from latest_v1 snapshot
       where true
         and not exists (
           select 1
           from coaching_daily_assessment_recovery_evidence evidence
           join recovery_observations observation
             on observation.id = evidence.observation_id
            and observation.person_id = evidence.person_id
           join recovery_connections connection
             on connection.id = observation.connection_id
            and connection.person_id = observation.person_id
           where evidence.recommendation_id = snapshot.recommendation_id
             and connection.erasure_requested_at is not null
         )
         and not exists (
           select 1
           from jsonb_array_elements_text(snapshot.used_facts -> 'externalActivityIds') used(id)
           where not exists (
             select 1
             from integration_activity_facts activity
             join integration_connections integration_connection
               on integration_connection.id = activity.connection_id
              and integration_connection.person_id = activity.person_id
             join recovery_connections connection
               on connection.id = integration_connection.recovery_connection_id
              and connection.person_id = integration_connection.person_id
             where activity.id::text = used.id
               and activity.person_id = $1
               and connection.erasure_requested_at is null
               and not exists (
                 select 1 from integration_activity_facts successor
                 where successor.person_id = activity.person_id
                   and successor.supersedes_id = activity.id
               )
           )
         )
       order by snapshot.local_date`,
      [personId, from, to]
    );

    const byDate = new Map<string, {
      values: Partial<Record<PersonalBaselineMetric, number>>;
      acuteIllness: boolean;
      injuryConcern: boolean;
      recoveryAssessmentPresent: boolean;
      recoveryHardStop: boolean;
      baselineExcluded: boolean;
      trainingLoadIncompatible: boolean;
      trainingLoadSeriesKey: string | null;
      workoutSessionCount: number;
      externalActivityCount: number;
      recoveryRiskLevel: "low" | "moderate" | "high" | "blocked" | null;
      contextEligibilityAvailable: boolean;
      v1Status?: V1SnapshotRow["status"];
      v1Action?: V1Action;
      v1AbsoluteGuardrail?: boolean;
    }>();
    const ensure = (localDate: string) => {
      const existing = byDate.get(localDate);
      if (existing) return existing;
      const created: {
        values: Partial<Record<PersonalBaselineMetric, number>>;
        acuteIllness: boolean;
        injuryConcern: boolean;
        recoveryAssessmentPresent: boolean;
        recoveryHardStop: boolean;
        baselineExcluded: boolean;
        trainingLoadIncompatible: boolean;
        trainingLoadSeriesKey: string | null;
        workoutSessionCount: number;
        externalActivityCount: number;
        recoveryRiskLevel: "low" | "moderate" | "high" | "blocked" | null;
        contextEligibilityAvailable: boolean;
        v1Status?: V1SnapshotRow["status"];
        v1Action?: V1Action;
        v1AbsoluteGuardrail?: boolean;
      } = {
        values: {}, acuteIllness: false, injuryConcern: false,
        recoveryAssessmentPresent: false, recoveryHardStop: false,
        baselineExcluded: false, trainingLoadIncompatible: false,
        trainingLoadSeriesKey: null, workoutSessionCount: 0,
        externalActivityCount: 0, recoveryRiskLevel: null,
        contextEligibilityAvailable
      };
      byDate.set(localDate, created);
      return created;
    };
    for (let localDate = from; localDate <= to; localDate = addCalendarDays(localDate, 1)) {
      ensure(localDate);
    }
    for (const row of recovery) {
      const day = ensure(row.localDate);
      day.acuteIllness = row.acuteIllness;
      day.injuryConcern = row.injuryConcern;
      day.recoveryAssessmentPresent = row.assessmentPresent;
      day.recoveryHardStop = row.hardStop;
      day.recoveryRiskLevel = row.riskLevel;
      if (row.sleepMinutes !== null) day.values.sleep_minutes = row.sleepMinutes;
      if (row.hrvRmssd !== null) day.values.hrv_rmssd = row.hrvRmssd;
      if (row.restingHeartRate !== null) day.values.resting_heart_rate = row.restingHeartRate;
      if (row.bodyBattery !== null) day.values.body_battery = row.bodyBattery;
      if (row.bodyBatteryMin !== null) day.values.body_battery_min = row.bodyBatteryMin;
      if (row.bodyBatteryMax !== null) day.values.body_battery_max = row.bodyBatteryMax;
      if (row.steps !== null) day.values.steps = row.steps;
    }
    for (const row of training) {
      const day = ensure(row.localDate);
      if (row.trainingLoad !== null) day.values.training_load = row.trainingLoad;
      day.trainingLoadIncompatible = row.incompatibleLoadSources;
      day.trainingLoadSeriesKey = row.loadSeriesKey;
      day.workoutSessionCount = row.workoutSessionCount;
      day.externalActivityCount = row.externalActivityCount;
    }
    for (const row of exclusions.rows) ensure(row.local_date).baselineExcluded = true;
    for (const row of v1Snapshots.rows) {
      const action = parseV1Action(row.action);
      if (action === null) continue;
      const day = ensure(row.local_date);
      day.v1Status = row.status;
      day.v1Action = action;
      day.v1AbsoluteGuardrail = row.absolute_guardrail;
    }

    await client.query("rollback");
    return addCounterfactualV1Replays([...byDate.entries()].map(([localDate, day]) => ({
      localDate,
      values: day.values,
      acuteIllness: day.acuteIllness,
      injuryConcern: day.injuryConcern,
      recoveryAssessmentPresent: day.recoveryAssessmentPresent,
      recoveryHardStop: day.recoveryHardStop,
      baselineExcluded: day.baselineExcluded,
      trainingLoadIncompatible: day.trainingLoadIncompatible,
      trainingLoadSeriesKey: day.trainingLoadSeriesKey,
      workoutSessionCount: day.workoutSessionCount,
      externalActivityCount: day.externalActivityCount,
      recoveryRiskLevel: day.recoveryRiskLevel,
      contextEligibilityAvailable: day.contextEligibilityAvailable,
      ...(day.v1Status === undefined ? {} : {
        v1Status: day.v1Status,
        v1Action: day.v1Action,
        v1AbsoluteGuardrail: day.v1AbsoluteGuardrail
      })
    })));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

/** Runs an explicitly bounded retrospective shadow evaluation. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: "string" },
      to: { type: "string" }
    }
  });
  const from = parseLocalDate(required(values.from, "--from"), "--from");
  const to = parseLocalDate(required(values.to, "--to"), "--to");
  const days = rangeLength(from, to);
  if (days < 1 || days > 366) {
    throw new Error("Retrospective range must contain from 1 to 366 days");
  }
  const pool = new Pool({
    connectionString: required(process.env.DATABASE_URL, "DATABASE_URL"),
    max: 1
  });
  try {
    const client = await pool.connect();
    try {
      const evidence = await loadRetrospectiveEvidence(
        client,
        required(process.env.DAILY_ASSESSMENT_RETROSPECTIVE_PERSON_ID, "DAILY_ASSESSMENT_RETROSPECTIVE_PERSON_ID"),
        retrospectiveHistoryFrom(from),
        to
      );
      process.stdout.write(`${serializeDailyAssessmentRetrospectiveReport(
        runDailyAssessmentRetrospective(evidence, from)
      )}\n`);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  try {
    await main();
  } catch {
    process.stderr.write('{"error":"retrospective_failed"}\n');
    process.exitCode = 1;
  }
}
