import { parseArgs } from "node:util";

import { Pool } from "pg";

import { runDryRun } from "../import/contracts.js";
import {
  FITNESS_TRACKER_SPREADSHEET_ID,
  FitnessTrackerSheetsReader
} from "../import/fitness-tracker-sheets-reader.js";
import { PostgresWeightTargetReader } from "../import/postgres-weight-target-reader.js";
import { PrivateJsonFileReportSink } from "../import/private-report-sink.js";
import { WeightDryRunAdapter } from "../import/weight-dry-run.js";

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required runtime value ${name}`);
  return normalized;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { "detail-report": { type: "string" } }
  });
  const personId = required(process.env.FITNESS_TRACKER_PERSON_ID, "FITNESS_TRACKER_PERSON_ID");
  const pool = new Pool({
    connectionString: required(process.env.DATABASE_URL, "DATABASE_URL"),
    max: 1
  });
  try {
    const source = new FitnessTrackerSheetsReader({
      clientEmail: required(
        process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL,
        "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL"
      ),
      privateKey: required(
        process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY,
        "GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY"
      )
    });
    const snapshot = await source.readSnapshot();
    const target = new PostgresWeightTargetReader(
      pool,
      FITNESS_TRACKER_SPREADSHEET_ID,
      snapshot.weight.sheetId
    );
    const result = await runDryRun(
      personId,
      { readSnapshot: async () => snapshot },
      target,
      new WeightDryRunAdapter()
    );
    if (values["detail-report"]) {
      await new PrivateJsonFileReportSink(values["detail-report"]).write(
        result.privateDetail
      );
    }
    process.stdout.write(`${JSON.stringify(result.safeReport, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Weight dry-run import failed"}\n`
  );
  process.exitCode = 1;
});
