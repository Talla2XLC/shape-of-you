import type { Pool, PoolClient } from "pg";

import type { BodyMeasurementValueInput } from "@shape-of-you/contracts";

import type { ImportTargetReader } from "./contracts.js";
import type { BodyImportTarget } from "./body-dry-run.js";

interface BodyTargetRow {
  readonly id: string;
  readonly local_date: string;
  readonly temporal_precision: "instant" | "local_date";
  readonly note: string | null;
  readonly checksum: string | null;
  readonly external_system: string | null;
  readonly external_record_id: string | null;
  readonly metric: BodyMeasurementValueInput["metric"] | null;
  readonly value: string | null;
  readonly unit: "cm" | null;
}

/** PostgreSQL Body comparison reader with an explicit read-only boundary. */
export class PostgresBodyTargetReader
  implements ImportTargetReader<BodyImportTarget>
{
  public constructor(
    private readonly pool: Pool,
    private readonly spreadsheetId: string,
    private readonly sheetId: number
  ) {}

  /** Reads current Body facts for the exact workbook and sheet. */
  public async readTarget(personId: string): Promise<readonly BodyImportTarget[]> {
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
  ): Promise<readonly BodyImportTarget[]> {
    return this.query(client, personId);
  }

  private async query(client: PoolClient, personId: string): Promise<BodyImportTarget[]> {
    const externalSystem = `google_sheets:${this.spreadsheetId}:${this.sheetId}`;
    const precisionColumn = await client.query<{ present: boolean }>(
      `select exists (
         select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'body_measurement_sessions'
            and column_name = 'temporal_precision'
       ) as present`
    );
    const temporalPrecision = precisionColumn.rows[0]?.present
      ? "bms.temporal_precision"
      : "'instant'::text";
    const result = await client.query<BodyTargetRow>(
      `select bms.id, bms.local_date::text, ${temporalPrecision} as temporal_precision, bms.note,
              sr.checksum, sr.external_system, sr.external_record_id,
              bmv.metric, bmv.value::text, bmv.unit
         from body_measurement_sessions bms
         join source_references sr
           on sr.id = bms.source_reference_id
          and sr.person_id = bms.person_id
         left join body_measurement_values bmv on bmv.session_id = bms.id
        where bms.person_id = $1
          and bms.source = 'google_sheets'
          and sr.external_system = $2
          and not exists (
            select 1 from body_measurement_sessions successor
             where successor.supersedes_id = bms.id
          )
        order by sr.external_record_id, bms.id, bmv.metric`,
      [personId, externalSystem]
    );
    const grouped = new Map<string, BodyImportTarget>();
    for (const row of result.rows) {
      if (row.external_system !== externalSystem || !row.external_record_id) continue;
      const current = grouped.get(row.id) ?? {
        id: row.id,
        sourceIdentity: {
          spreadsheetId: this.spreadsheetId,
          sheetId: this.sheetId,
          sourceKey: row.external_record_id
        },
        checksum: row.checksum,
        localDate: row.local_date,
        temporalPrecision: row.temporal_precision,
        values: [],
        note: row.note
      };
      if (row.metric && row.value !== null && row.unit) {
        grouped.set(row.id, {
          ...current,
          values: [
            ...current.values,
            { metric: row.metric, value: Number(row.value), unit: row.unit }
          ]
        });
      } else {
        grouped.set(row.id, current);
      }
    }
    return [...grouped.values()];
  }
}
