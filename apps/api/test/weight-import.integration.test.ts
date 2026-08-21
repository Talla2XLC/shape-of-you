import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../src/database/migrate.js";
import { FITNESS_TRACKER_SPREADSHEET_ID } from "../src/import/fitness-tracker-sheets-reader.js";
import { PostgresWeightTargetReader } from "../src/import/postgres-weight-target-reader.js";

let container: StartedPostgreSqlContainer;
let pool: Pool;
const personId = "00000000-0000-4000-8000-000000000001";
const sheetId = 901;
const externalSystem = `google_sheets:${FITNESS_TRACKER_SPREADSHEET_ID}:${sheetId}`;

beforeAll(async () => {
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = personId;
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_weight_import")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  await runMigrations(container.getConnectionUri());
  pool = new Pool({ connectionString: container.getConnectionUri() });
  const source = await pool.query<{ id: string }>(
    `insert into source_references (
       person_id, channel, external_system, external_record_id, checksum
     ) values ($1, 'google_sheets', $2, '2026-08-21', 'fixture-checksum')
     returning id`,
    [personId, externalSystem]
  );
  await pool.query(
    `insert into weight_measurements (
       person_id, measured_at, local_date, timezone, weight_kg, source,
       source_reference_id, dedupe_key
     ) values (
       $1, '2026-08-21T06:00:00Z', '2026-08-21', 'Europe/Moscow', 82.125,
       'google_sheets', $2, 'fitness-tracker-weight:2026-08-21'
     )`,
    [personId, source.rows[0]!.id]
  );
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe("Weight import PostgreSQL target reader", () => {
  it("reads current provenance in a read-only transaction without mutations", async () => {
    const before = await relationCounts();
    const reader = new PostgresWeightTargetReader(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetId
    );

    const rows = await reader.readTarget(personId);
    const after = await relationCounts();

    expect(rows).toEqual([
      expect.objectContaining({
        sourceIdentity: {
          spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
          sheetId,
          sourceKey: "2026-08-21"
        },
        checksum: "fixture-checksum",
        localDate: "2026-08-21",
        temporalPrecision: "instant",
        weightKg: 82.125
      })
    ]);
    expect(after).toEqual(before);
  });

  it("rolls back a failed comparison and leaves the pool reusable", async () => {
    const reader = new PostgresWeightTargetReader(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      sheetId
    );
    await expect(reader.readTarget("not-a-uuid")).rejects.toThrow();
    await expect(reader.readTarget(personId)).resolves.toHaveLength(1);
    expect(await relationCounts()).toEqual({ sourceReferences: 1, weights: 1 });
  });
});

async function relationCounts(): Promise<{
  readonly sourceReferences: number;
  readonly weights: number;
}> {
  const result = await pool.query<{
    source_references: string;
    weights: string;
  }>(
    `select
       (select count(*) from source_references)::text as source_references,
       (select count(*) from weight_measurements)::text as weights`
  );
  return {
    sourceReferences: Number(result.rows[0]!.source_references),
    weights: Number(result.rows[0]!.weights)
  };
}
