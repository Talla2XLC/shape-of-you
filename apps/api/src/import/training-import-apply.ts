import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import type { SafeApplyImportReport } from "./contracts.js";
import type { FitnessTrackerTrainingSnapshot } from "./fitness-tracker-sheets-reader.js";
import { PostgresImportLifecycle, type PostgresApplyAdapter } from "./postgres-import-lifecycle.js";
import { PostgresTrainingTargetReader } from "./postgres-training-target-reader.js";
import { TrainingDryRunAdapter, type TrainingDryRunPrivateDetail, type TrainingImportAuditRecord, type TrainingImportCandidate, type TrainingImportTarget } from "./training-dry-run.js";

/** Transactional Training apply implementation behind the shared importer lifecycle. */
export class TrainingImportApplyService {
  public constructor(private readonly pool: Pool, private readonly spreadsheetId: string, private readonly sheetId: number) {}

  public apply(personId: string, snapshot: FitnessTrackerTrainingSnapshot): Promise<SafeApplyImportReport> {
    const targetReader = new PostgresTrainingTargetReader(this.pool, this.spreadsheetId, this.sheetId);
    const classifier = new TrainingDryRunAdapter();
    const adapter: PostgresApplyAdapter<FitnessTrackerTrainingSnapshot, TrainingImportTarget, TrainingDryRunPrivateDetail> = {
      domain: "training",
      blockOnFindings: false,
      readTarget: (client, ownerId) => targetReader.readTargetWithClient(client, ownerId),
      classify: (source, target) => classifier.classify(source, target),
      targetStateChecksum: (target) => digest(target),
      createFacts: async (client, batchId, ownerId, source, detail) => {
        const created = new Map<string, string>();
        for (const record of detail.records) {
          if (record.outcome !== "created" || !record.sourceSessionId) continue;
          const candidate = detail.candidates.find(({ sourceIdentity }) => sourceIdentity.sourceKey === record.sourceSessionId);
          if (!candidate) throw new Error("Created Training finding has no candidate");
          created.set(record.sourceSessionId, await createSession(client, batchId, ownerId, source.timeZone, candidate));
        }
        return { ...detail, records: detail.records.map((record) => ({ ...record, targetSessionId: record.sourceSessionId ? created.get(record.sourceSessionId) ?? record.targetSessionId : record.targetSessionId })) };
      },
      persistAudit: (client, batchId, ownerId, detail) => insertAudit(client, batchId, ownerId, detail.records)
    };
    return new PostgresImportLifecycle(this.pool).apply({ personId, snapshot, sourceSystem: "google_sheets", sourceContainerId: this.spreadsheetId, sourceManifestChecksum: snapshot.manifestChecksum, adapter });
  }
}

async function createSession(client: PoolClient, batchId: string, personId: string, timezone: string, candidate: TrainingImportCandidate): Promise<string> {
  const externalSystem = `google_sheets:${candidate.sourceIdentity.spreadsheetId}:${candidate.sourceIdentity.sheetId}`;
  const source = await client.query<{ id: string }>(
    `insert into source_references (person_id, channel, external_system, external_record_id, import_batch_id, checksum, contains_sensitive_data)
     values ($1, 'google_sheets', $2, $3, $4, $5, true) returning id`,
    [personId, externalSystem, candidate.sourceIdentity.sourceKey, batchId, candidate.checksum]
  );
  const dedupeKey = `fitness-tracker:training:${digest(candidate.sourceIdentity)}`;
  const session = await client.query<{ id: string }>(
    `insert into workout_sessions (person_id, occurred_at, temporal_precision, local_date, timezone, program_version_id, workout_name, feeling, note, source, source_reference_id, dedupe_key, confidence)
     values ($1, null, 'local_date', $2, $3, null, $4, null, null, 'google_sheets', $5, $6, null)
     on conflict (person_id, source, dedupe_key) do nothing returning id`,
    [personId, candidate.localDate, timezone, candidate.workoutName, source.rows[0]!.id, dedupeKey]
  );
  if (!session.rows[0]) {
    await client.query("delete from source_references where id = $1", [source.rows[0]!.id]);
    const existing = await client.query<{ id: string }>("select id from workout_sessions where person_id = $1 and source = 'google_sheets' and dedupe_key = $2", [personId, dedupeKey]);
    if (!existing.rows[0]) throw new Error("Training dedupe conflict could not be resolved");
    return existing.rows[0].id;
  }
  for (const [position, exercise] of candidate.exercises.entries()) {
    const mapping = await ensureExercise(client, personId, externalSystem, exercise.sourceExerciseId, exercise.sourceName);
    const performed = await client.query<{ id: string }>(
      `insert into performed_exercises (session_id, position, exercise_id, exercise_version_id, exercise_label, load_basis, feeling, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [session.rows[0].id, position + 1, mapping.exerciseId, mapping.exerciseVersionId, exercise.sourceName, exercise.loadBasis, exercise.feeling, exercise.note]
    );
    for (const [setPosition, set] of exercise.sets.entries()) {
      await client.query(
        `insert into performed_sets (performed_exercise_id, position, weight_kg, reps, duration_seconds, distance_meters, rir)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [performed.rows[0]!.id, setPosition + 1, set.weightKg, set.reps, set.durationSeconds, set.distanceMeters, set.rir]
      );
    }
  }
  return session.rows[0].id;
}

async function ensureExercise(client: PoolClient, personId: string, sourceSystem: string, sourceExerciseId: string, sourceName: string): Promise<{ exerciseId: string; exerciseVersionId: string }> {
  const checksum = digest({ sourceExerciseId, sourceName });
  const existing = await client.query<{ exercise_id: string; exercise_version_id: string; source_name: string; source_checksum: string }>(
    `select exercise_id, exercise_version_id, source_name, source_checksum from training_import_exercise_mappings
      where person_id = $1 and source_system = $2 and source_exercise_id = $3`,
    [personId, sourceSystem, sourceExerciseId]
  );
  if (existing.rows[0]) {
    const mappingChecksum = digest({
      sourceExerciseId,
      sourceName: existing.rows[0].source_name
    });
    if (existing.rows[0].source_checksum !== mappingChecksum) {
      throw new Error("Training exercise source mapping checksum is invalid");
    }
    if (existing.rows[0].source_name === sourceName) {
      return { exerciseId: existing.rows[0].exercise_id, exerciseVersionId: existing.rows[0].exercise_version_id };
    }
    const version = await client.query<{ id: string }>(
      `select id from training_exercise_versions
        where exercise_id = $1 and name = $2
        order by version
        limit 1`,
      [existing.rows[0].exercise_id, sourceName]
    );
    if (version.rows[0]) {
      return {
        exerciseId: existing.rows[0].exercise_id,
        exerciseVersionId: version.rows[0].id
      };
    }
    const createdVersion = await client.query<{ id: string }>(
      `insert into training_exercise_versions (exercise_id, version, name)
       select $1, coalesce(max(version), 0) + 1, $2
         from training_exercise_versions
        where exercise_id = $1
       returning id`,
      [existing.rows[0].exercise_id, sourceName]
    );
    await client.query(
      "update training_exercises set current_version_id = $1 where id = $2",
      [createdVersion.rows[0]!.id, existing.rows[0].exercise_id]
    );
    return {
      exerciseId: existing.rows[0].exercise_id,
      exerciseVersionId: createdVersion.rows[0]!.id
    };
  }
  const exercise = await client.query<{ id: string }>("insert into training_exercises (visibility, owner_person_id) values ('private', $1) returning id", [personId]);
  const version = await client.query<{ id: string }>("insert into training_exercise_versions (exercise_id, version, name) values ($1, 1, $2) returning id", [exercise.rows[0]!.id, sourceName]);
  await client.query("update training_exercises set current_version_id = $1 where id = $2", [version.rows[0]!.id, exercise.rows[0]!.id]);
  await client.query(
    `insert into training_import_exercise_mappings (person_id, source_system, source_exercise_id, source_name, source_checksum, exercise_id, exercise_version_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [personId, sourceSystem, sourceExerciseId, sourceName, checksum, exercise.rows[0]!.id, version.rows[0]!.id]
  );
  return { exerciseId: exercise.rows[0]!.id, exerciseVersionId: version.rows[0]!.id };
}

async function insertAudit(client: PoolClient, batchId: string, personId: string, records: readonly TrainingImportAuditRecord[]): Promise<void> {
  for (const record of records) {
    const inserted = await client.query<{ id: string }>(
      `insert into training_import_records (batch_id, person_id, source_sheet_id, source_locator, source_session_id, source_local_date, source_checksum, normalized_workout_name, outcome, finding_code, target_session_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (batch_id, source_locator, finding_code) do nothing returning id`,
      [batchId, personId, record.sourceSheetId, record.sourceLocator, record.sourceSessionId, record.sourceLocalDate, record.sourceChecksum, record.normalizedWorkoutName, record.outcome, record.findingCode, record.targetSessionId]
    );
    if (!inserted.rows[0]) continue;
    for (const [position, exercise] of record.exercises.entries()) {
      const first = exercise.sets[0]!;
      await client.query(
        `insert into training_import_record_exercises (record_id, position, source_locator, source_exercise_id, source_name, source_reps, load_basis, set_count, reps, duration_seconds, distance_meters, weight_kg, rir)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [inserted.rows[0].id, position + 1, exercise.locator, exercise.sourceExerciseId, exercise.sourceName, exercise.sourceReps, exercise.loadBasis, exercise.sets.length, first.reps, first.durationSeconds, first.distanceMeters, first.weightKg, first.rir]
      );
    }
  }
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
