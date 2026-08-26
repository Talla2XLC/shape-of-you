import type { Pool, PoolClient } from "pg";

import type { ImportTargetReader } from "./contracts.js";
import type { TrainingImportTarget } from "./training-dry-run.js";

/** Read-only comparison boundary for imported Training sessions. */
export class PostgresTrainingTargetReader implements ImportTargetReader<TrainingImportTarget> {
  public constructor(private readonly pool: Pool, private readonly spreadsheetId: string, private readonly sheetId: number) {}

  public async readTarget(personId: string): Promise<readonly TrainingImportTarget[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      const rows = await this.readTargetWithClient(client, personId);
      await client.query("rollback");
      return rows;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  public async readTargetWithClient(client: PoolClient, personId: string): Promise<readonly TrainingImportTarget[]> {
    const externalSystem = `google_sheets:${this.spreadsheetId}:${this.sheetId}`;
    const result = await client.query<{ id: string; checksum: string | null; external_record_id: string }>(
      `select ws.id, sr.checksum, sr.external_record_id
         from workout_sessions ws
         join source_references sr on sr.id = ws.source_reference_id and sr.person_id = ws.person_id
        where ws.person_id = $1 and ws.source = 'google_sheets'
          and sr.external_system = $2 and sr.external_record_id is not null
          and not exists (select 1 from workout_sessions next where next.supersedes_id = ws.id)
        order by sr.external_record_id, ws.id`,
      [personId, externalSystem]
    );
    const sessions: TrainingImportTarget[] = result.rows.map((row) => ({ kind: "session", id: row.id, checksum: row.checksum, sourceIdentity: { spreadsheetId: this.spreadsheetId, sheetId: this.sheetId, sourceKey: row.external_record_id } }));
    const mappings = await client.query<{ id: string; source_exercise_id: string; source_name: string; source_checksum: string }>(
      `select id, source_exercise_id, source_name, source_checksum
         from training_import_exercise_mappings
        where person_id = $1 and source_system = $2
        order by source_exercise_id`,
      [personId, externalSystem]
    );
    return [
      ...sessions,
      ...mappings.rows.map((row): TrainingImportTarget => ({
        kind: "exercise_mapping",
        id: row.id,
        sourceExerciseId: row.source_exercise_id,
        sourceName: row.source_name,
        checksum: row.source_checksum
      }))
    ];
  }
}
