import type { Pool, PoolClient } from "pg";

import type { ImportTargetReader } from "./contracts.js";
import type { RecoveryImportTarget } from "./recovery-dry-run.js";

/** Read-only comparison boundary for imported raw Recovery observations. */
export class PostgresRecoveryTargetReader implements ImportTargetReader<RecoveryImportTarget> {
  public constructor(private readonly pool: Pool, private readonly spreadsheetId: string, private readonly sheetId: number) {}

  public async readTarget(personId: string): Promise<readonly RecoveryImportTarget[]> {
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

  public async readTargetWithClient(client: PoolClient, personId: string): Promise<readonly RecoveryImportTarget[]> {
    const externalSystem = `google_sheets:${this.spreadsheetId}:${this.sheetId}`;
    const result = await client.query<{ id: string; checksum: string | null; external_record_id: string }>(
      `select ro.id, sr.checksum, sr.external_record_id
         from recovery_observations ro
         join source_references sr on sr.id = ro.source_reference_id and sr.person_id = ro.person_id
        where ro.person_id = $1 and ro.source = 'google_sheets'
          and sr.external_system = $2 and sr.external_record_id is not null
          and not exists (select 1 from recovery_observations next where next.supersedes_id = ro.id)
        order by sr.external_record_id, ro.id`,
      [personId, externalSystem]
    );
    return result.rows.map((row) => ({ id: row.id, checksum: row.checksum, sourceIdentity: { spreadsheetId: this.spreadsheetId, sheetId: this.sheetId, sourceKey: row.external_record_id } }));
  }
}
