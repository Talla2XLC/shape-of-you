import type { Pool, PoolClient } from "pg";

/** One Training-owned daily load representative for shadow analysis. */
export interface TrainingBaselineDay {
  readonly localDate: string;
  readonly trainingLoad: number | null;
  readonly loadSeriesKey: string | null;
  readonly loadBasis: "relative_training_stress" | null;
  readonly loadBasisVersion: string | null;
  readonly workoutSessionCount: number;
  readonly externalActivityCount: number;
  readonly incompatibleLoadSources: boolean;
  readonly externalActivityIds: readonly string[];
  readonly workoutSessionIds: readonly string[];
}

interface TrainingBaselineRow {
  readonly local_date: string;
  readonly training_load: string | null;
  readonly load_series_key: string | null;
  readonly load_basis: "relative_training_stress" | null;
  readonly load_basis_version: string | null;
  readonly workout_session_count: number;
  readonly external_activity_count: number;
  readonly incompatible_load_sources: boolean;
  readonly external_activity_ids: readonly string[];
  readonly workout_session_ids: readonly string[];
}

/**
 * Reads current typed external activities and sums load only when all facts for
 * the day share one opaque connection-backed source series. This conservative
 * shadow partition does not claim that two series have distinct load units or
 * that one series can never change its algorithm. Provider names and raw
 * payloads are neither selected nor returned.
 */
export async function readTrainingBaselineDays(
  client: Pool | PoolClient,
  personId: string,
  from: string,
  to: string
): Promise<readonly TrainingBaselineDay[]> {
  const result = await client.query<TrainingBaselineRow>(
    `with current_activity as (
       select activity.id, activity.person_id, activity.local_date,
              activity.training_load, activity.connection_id,
              activity.training_load_basis,
              activity.training_load_basis_version,
              activity.normalized_checksum
       from integration_activity_facts activity
       join integration_connections integration_connection
         on integration_connection.id = activity.connection_id
        and integration_connection.person_id = activity.person_id
       join recovery_connections recovery_connection
         on recovery_connection.id = integration_connection.recovery_connection_id
        and recovery_connection.person_id = integration_connection.person_id
       where activity.person_id = $1
         and activity.local_date between $2 and $3
         and recovery_connection.erasure_requested_at is null
         and not exists (
           select 1 from integration_activity_facts successor
           where successor.person_id = activity.person_id
             and successor.supersedes_id = activity.id
         )
     ), deduplicated_activity as (
       select distinct on (local_date, normalized_checksum)
              id, local_date, training_load, connection_id,
              training_load_basis, training_load_basis_version
       from current_activity
       order by local_date, normalized_checksum, id
     ), activity_daily as (
       select local_date,
              case when count(training_load) > 0
                         and count(training_load) = count(training_load_basis)
                         and count(training_load) = count(training_load_basis_version)
                         and count(distinct (training_load_basis, training_load_basis_version))
                               filter (where training_load is not null) = 1
                then sum(training_load)::text else null end as training_load,
              case when count(training_load) > 0
                         and count(training_load) = count(training_load_basis)
                         and count(training_load) = count(training_load_basis_version)
                         and count(distinct (training_load_basis, training_load_basis_version))
                               filter (where training_load is not null) = 1
                then min(training_load_basis) else null end as load_basis,
              case when count(training_load) > 0
                         and count(training_load) = count(training_load_basis)
                         and count(training_load) = count(training_load_basis_version)
                         and count(distinct (training_load_basis, training_load_basis_version))
                               filter (where training_load is not null) = 1
                then min(training_load_basis_version) else null end as load_basis_version,
              case when count(training_load) > 0
                         and count(training_load) = count(training_load_basis)
                         and count(training_load) = count(training_load_basis_version)
                         and count(distinct (training_load_basis, training_load_basis_version))
                               filter (where training_load is not null) = 1
                then min(training_load_basis) || ':' || min(training_load_basis_version)
                else null end as load_series_key,
              (count(training_load) <> count(training_load_basis)
                or count(training_load) <> count(training_load_basis_version)
                or count(distinct (training_load_basis, training_load_basis_version))
                     filter (where training_load is not null) > 1)
                as incompatible_load_sources,
              count(*)::int as external_activity_count,
              array_agg(id::text order by id) as external_activity_ids
       from deduplicated_activity
       group by local_date
     ), current_session as (
       select session.id, session.person_id, session.local_date
       from workout_sessions session
       join source_references source
         on source.id = session.source_reference_id
        and source.person_id = session.person_id
       where session.person_id = $1
         and session.local_date between $2 and $3
         and source.evidence_purpose = 'person_context'
         and not exists (
           select 1 from workout_sessions successor
           where successor.person_id = session.person_id
             and successor.supersedes_id = session.id
         )
     ), session_daily as (
       select local_date, count(*)::int as workout_session_count,
              array_agg(id::text order by id) as workout_session_ids
       from current_session
       group by local_date
     ), dates as (
       select local_date from activity_daily
       union
       select local_date from session_daily
     )
     select dates.local_date::text,
            activity.training_load,
            activity.load_series_key,
            activity.load_basis,
            activity.load_basis_version,
            coalesce(session.workout_session_count, 0)::int as workout_session_count,
            coalesce(activity.external_activity_count, 0)::int as external_activity_count,
            coalesce(activity.incompatible_load_sources, false) as incompatible_load_sources
            ,coalesce(activity.external_activity_ids, array[]::text[]) as external_activity_ids
            ,coalesce(session.workout_session_ids, array[]::text[]) as workout_session_ids
     from dates
     left join activity_daily activity using (local_date)
     left join session_daily session using (local_date)
     order by dates.local_date`,
    [personId, from, to]
  );
  return result.rows.map((row) => ({
    localDate: row.local_date,
    trainingLoad: row.training_load === null ? null : Number(row.training_load),
    loadSeriesKey: row.load_series_key,
    loadBasis: row.load_basis,
    loadBasisVersion: row.load_basis_version,
    workoutSessionCount: row.workout_session_count,
    externalActivityCount: row.external_activity_count,
    incompatibleLoadSources: row.incompatible_load_sources,
    externalActivityIds: row.external_activity_ids,
    workoutSessionIds: row.workout_session_ids
  }));
}
