import type { Pool, PoolClient } from "pg";

import type { ImportTargetReader } from "./contracts.js";
import type { WeightImportTarget } from "./weight-dry-run.js";

interface WeightTargetRow {
  readonly id: string;
  readonly local_date: string;
  readonly temporal_precision: "instant" | "local_date";
  readonly weight_kg: string;
  readonly checksum: string | null;
  readonly external_system: string | null;
  readonly external_record_id: string | null;
}

/**
 * PostgreSQL Weight comparison reader with transaction-level write protection.
 *
 * It preserves stored temporal precision, so an instant never silently equals
 * a date-only legacy fact.
 */
export class PostgresWeightTargetReader
  implements ImportTargetReader<WeightImportTarget>
{
  public constructor(
    private readonly pool: Pool,
    private readonly spreadsheetId: string,
    private readonly sheetId: number
  ) {}

  /** Reads current facts for the approved workbook/sheet in a read-only transaction. */
  public async readTarget(personId: string): Promise<readonly WeightImportTarget[]> {
    const client = await this.pool.connect();
    try {
      await client.query("begin read only");
      const rows = await this.query(client, personId);
      await client.query("rollback");
      return rows;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Reads comparison rows through an existing caller-owned transaction. */
  public async readTargetWithClient(
    client: PoolClient,
    personId: string
  ): Promise<readonly WeightImportTarget[]> {
    return this.query(client, personId);
  }

  private async query(client: PoolClient, personId: string): Promise<WeightImportTarget[]> {
    const externalSystem = `google_sheets:${this.spreadsheetId}:${this.sheetId}`;
    const result = await client.query<WeightTargetRow>(
      `select wm.id, wm.local_date::text, wm.temporal_precision, wm.weight_kg::text,
              sr.checksum, sr.external_system, sr.external_record_id
         from weight_measurements wm
         join source_references sr
           on sr.id = wm.source_reference_id
          and sr.person_id = wm.person_id
        where wm.person_id = $1
          and wm.source = 'google_sheets'
          and sr.external_system = $2
          and not exists (
            select 1 from weight_measurements successor
             where successor.supersedes_id = wm.id
          )
        order by sr.external_record_id, wm.id`,
      [personId, externalSystem]
    );
    return result.rows.flatMap((row) =>
      row.external_system === externalSystem && row.external_record_id
        ? [{
            id: row.id,
            sourceIdentity: {
              spreadsheetId: this.spreadsheetId,
              sheetId: this.sheetId,
              sourceKey: row.external_record_id
            },
            checksum: row.checksum,
            localDate: row.local_date,
            temporalPrecision: row.temporal_precision,
            weightKg: Number(row.weight_kg)
          }]
        : []
    );
  }
}
