import type { Pool, PoolClient } from "pg";

/** One Recovery-owned, provider-neutral daily representative for shadow analysis. */
export interface RecoveryBaselineDay {
  readonly localDate: string;
  readonly sleepMinutes: number | null;
  readonly hrvRmssd: number | null;
  readonly restingHeartRate: number | null;
  readonly bodyBattery: number | null;
  readonly bodyBatteryMin: number | null;
  readonly bodyBatteryMax: number | null;
  readonly acuteIllness: boolean;
  readonly injuryConcern: boolean;
  readonly assessmentPresent: boolean;
  readonly hardStop: boolean;
  readonly riskLevel: "low" | "moderate" | "high" | "blocked" | null;
  readonly observationIds: readonly string[];
  readonly assessmentIds: readonly string[];
}

interface RecoveryBaselineRow {
  readonly local_date: string;
  readonly sleep_minutes: string | null;
  readonly hrv_rmssd: string | null;
  readonly resting_heart_rate: string | null;
  readonly body_battery: string | null;
  readonly body_battery_min: string | null;
  readonly body_battery_max: string | null;
  readonly acute_illness: boolean;
  readonly injury_concern: boolean;
  readonly assessment_present: boolean;
  readonly hard_stop: boolean;
  readonly risk_level: "low" | "moderate" | "high" | "blocked" | null;
  readonly observation_ids: readonly string[];
  readonly assessment_ids: readonly string[];
}

function numberOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reads bounded current Recovery facts and consolidates one equal-weight row
 * per Person-local day. Longest sleep avoids summing naps/duplicates; metric
 * readings use a median without inspecting provider identity.
 */
export async function readRecoveryBaselineDays(
  client: Pool | PoolClient,
  personId: string,
  from: string,
  to: string
): Promise<readonly RecoveryBaselineDay[]> {
  const result = await client.query<RecoveryBaselineRow>(
    `with current_recovery as (
       select observation.id, observation.person_id, observation.local_date,
              observation.observed_until
       from recovery_observations observation
       join source_references source on source.id = observation.source_reference_id
       where observation.person_id = $1
         and observation.local_date between $2 and $3
         and observation.withdrawn_at is null
         and observation.quality <> 'poor'
         and source.evidence_purpose = 'person_context'
         and (
           observation.connection_id is null
           or not exists (
             select 1 from recovery_connections connection
             where connection.id = observation.connection_id
               and connection.person_id = observation.person_id
               and connection.erasure_requested_at is not null
           )
         )
         and not exists (
           select 1 from recovery_observations successor
           where successor.person_id = observation.person_id
             and successor.supersedes_id = observation.id
         )
     ), current_safety_subjective as (
       select observation.id, observation.person_id, observation.local_date
       from recovery_observations observation
       join source_references source on source.id = observation.source_reference_id
       where observation.person_id = $1
         and observation.local_date between $2 and $3
         and observation.kind = 'subjective'
         and observation.withdrawn_at is null
         and source.evidence_purpose = 'person_context'
         and (
           observation.connection_id is null
           or not exists (
             select 1 from recovery_connections connection
             where connection.id = observation.connection_id
               and connection.person_id = observation.person_id
               and connection.erasure_requested_at is not null
           )
         )
         and not exists (
           select 1 from recovery_observations successor
           where successor.person_id = observation.person_id
             and successor.supersedes_id = observation.id
         )
     ), current_assessment_observation as (
       select observation.id, observation.person_id, observation.observed_until
       from recovery_observations observation
       where observation.person_id = $1
         and observation.withdrawn_at is null
         and (
           observation.connection_id is null
           or not exists (
             select 1 from recovery_connections connection
             where connection.id = observation.connection_id
               and connection.person_id = observation.person_id
               and connection.erasure_requested_at is not null
           )
         )
         and not exists (
           select 1 from recovery_observations successor
           where successor.person_id = observation.person_id
             and successor.supersedes_id = observation.id
         )
     ), current_assessment_session as (
       select distinct session.id, session.person_id, session.occurred_at
       from workout_sessions session
       join performed_exercises exercise on exercise.session_id = session.id
       join performed_sets performed_set
         on performed_set.performed_exercise_id = exercise.id
       where session.person_id = $1
         and not exists (
           select 1 from workout_sessions successor
           where successor.person_id = session.person_id
             and successor.supersedes_id = session.id
         )
     ), valid_assessment as (
       select assessment.*
       from recovery_assessments assessment
       where assessment.person_id = $1
         and assessment.local_date between $2 and $3
         and not exists (
           select 1
           from recovery_assessment_observation_evidence evidence
           join recovery_observations observation
             on observation.id = evidence.observation_id
            and observation.person_id = evidence.person_id
           where evidence.assessment_id = assessment.id
             and (
               observation.withdrawn_at is not null
               or (
                 observation.connection_id is not null
                 and exists (
                   select 1 from recovery_connections connection
                   where connection.id = observation.connection_id
                     and connection.person_id = observation.person_id
                     and connection.erasure_requested_at is not null
                 )
               )
               or exists (
                 select 1 from recovery_observations successor
                 where successor.person_id = observation.person_id
                   and successor.supersedes_id = observation.id
               )
             )
         )
         and not exists (
           select 1
           from current_assessment_observation observation
           where observation.observed_until between assessment.window_start and assessment.window_end
             and not exists (
               select 1 from recovery_assessment_observation_evidence evidence
               where evidence.assessment_id = assessment.id
                 and evidence.person_id = observation.person_id
                 and evidence.observation_id = observation.id
             )
         )
         and not exists (
           select 1
           from recovery_assessment_training_evidence evidence
           where evidence.assessment_id = assessment.id
             and exists (
               select 1 from workout_sessions successor
               where successor.person_id = evidence.person_id
                 and successor.supersedes_id = evidence.workout_session_id
             )
         )
         and not exists (
           select 1
           from current_assessment_session session
           where session.occurred_at between assessment.window_start and assessment.window_end
             and not exists (
               select 1 from recovery_assessment_training_evidence evidence
               where evidence.assessment_id = assessment.id
                 and evidence.person_id = session.person_id
                 and evidence.workout_session_id = session.id
             )
         )
     ), latest_assessment as (
       select distinct on (local_date) id, local_date, hard_stop, risk_level
       from valid_assessment
       order by local_date, as_of desc, id desc
     ), evidence_observation as (
       select id, local_date from current_recovery
       union
       select id, local_date from current_safety_subjective
     ), observation_daily as (
       select local_date, array_agg(id::text order by id) as observation_ids
       from evidence_observation
       group by local_date
     ), dates as (
       select distinct local_date from current_recovery
       union
       select distinct local_date from current_safety_subjective
       union
       select local_date from latest_assessment
     ), sleep_daily as (
       select observation.local_date, max(sleep.total_sleep_minutes) as sleep_minutes
       from current_recovery observation
       join recovery_sleep_details sleep on sleep.observation_id = observation.id
       group by observation.local_date
     ), metric_values as (
       select distinct observation.local_date, metric.metric, metric.value
       from current_recovery observation
       join recovery_metric_details metric on metric.observation_id = observation.id
       where metric.metric in (
         'hrv_rmssd', 'resting_heart_rate', 'body_battery',
         'body_battery_min', 'body_battery_max'
       )
     ), metric_daily as (
       select local_date,
              (percentile_cont(0.5) within group (order by value::numeric)
                filter (where metric = 'hrv_rmssd'))::text as hrv_rmssd,
              (percentile_cont(0.5) within group (order by value::numeric)
                filter (where metric = 'resting_heart_rate'))::text as resting_heart_rate,
              (percentile_cont(0.5) within group (order by value::numeric)
                filter (where metric = 'body_battery'))::text as body_battery,
              (percentile_cont(0.5) within group (order by value::numeric)
                filter (where metric = 'body_battery_min'))::text as body_battery_min,
              (percentile_cont(0.5) within group (order by value::numeric)
                filter (where metric = 'body_battery_max'))::text as body_battery_max
       from metric_values
       group by local_date
     ), subjective_daily as (
       select observation.local_date,
              bool_or(subjective.acute_illness) as acute_illness,
              bool_or(subjective.injury_concern) as injury_concern
       from current_safety_subjective observation
       join recovery_subjective_details subjective on subjective.observation_id = observation.id
       group by observation.local_date
     )
     select dates.local_date::text,
            sleep.sleep_minutes::text,
            metric.hrv_rmssd,
            metric.resting_heart_rate,
            metric.body_battery,
            metric.body_battery_min,
            metric.body_battery_max,
            coalesce(subjective.acute_illness, false) as acute_illness,
            coalesce(subjective.injury_concern, false) as injury_concern,
            assessment.local_date is not null as assessment_present,
            coalesce(assessment.hard_stop, false) as hard_stop
            ,assessment.risk_level::text as risk_level,
            coalesce(observation.observation_ids, array[]::text[]) as observation_ids,
            case when assessment.id is null then array[]::text[]
                 else array[assessment.id::text] end as assessment_ids
     from dates
     left join sleep_daily sleep using (local_date)
     left join metric_daily metric using (local_date)
     left join subjective_daily subjective using (local_date)
     left join latest_assessment assessment using (local_date)
     left join observation_daily observation using (local_date)
     order by dates.local_date`,
    [personId, from, to]
  );
  return result.rows.map((row) => ({
    localDate: row.local_date,
    sleepMinutes: numberOrNull(row.sleep_minutes),
    hrvRmssd: numberOrNull(row.hrv_rmssd),
    restingHeartRate: numberOrNull(row.resting_heart_rate),
    bodyBattery: numberOrNull(row.body_battery),
    bodyBatteryMin: numberOrNull(row.body_battery_min),
    bodyBatteryMax: numberOrNull(row.body_battery_max),
    acuteIllness: row.acute_illness,
    injuryConcern: row.injury_concern,
    assessmentPresent: row.assessment_present,
    hardStop: row.hard_stop,
    riskLevel: row.risk_level,
    observationIds: row.observation_ids,
    assessmentIds: row.assessment_ids
  }));
}
