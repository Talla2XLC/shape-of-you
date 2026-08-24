import { parseArgs } from "node:util";

import { Pool } from "pg";

import { runDryRun } from "../import/contracts.js";
import { BodyDryRunAdapter } from "../import/body-dry-run.js";
import { BodyImportApplyService } from "../import/body-import-apply.js";
import {
  FITNESS_TRACKER_SPREADSHEET_ID,
  type FitnessTrackerBodySnapshot,
  type FitnessTrackerSourceSnapshot,
  type FitnessTrackerWeightSnapshot
} from "../import/fitness-tracker-sheets-reader.js";
import { createFitnessTrackerSource } from "../import/fitness-tracker-source.js";
import { PostgresWeightTargetReader } from "../import/postgres-weight-target-reader.js";
import { PostgresBodyTargetReader } from "../import/postgres-body-target-reader.js";
import { PrivateJsonFileReportSink } from "../import/private-report-sink.js";
import { WeightDryRunAdapter } from "../import/weight-dry-run.js";
import { WeightImportApplyService } from "../import/weight-import-apply.js";

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required runtime value ${name}`);
  return normalized;
}

/** Runs the shared Fitness Tracker import lifecycle for one typed domain adapter. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      domain: { type: "string" },
      mode: { type: "string" },
      "detail-report": { type: "string" },
      "snapshot-file": { type: "string" }
    }
  });
  const domain = required(values.domain, "--domain");
  const mode = required(values.mode, "--mode");
  if (domain !== "weight" && domain !== "body") {
    throw new Error(`Unsupported import domain ${domain}; available: weight, body`);
  }
  if (mode !== "dry-run" && mode !== "apply") {
    throw new Error("--mode must be dry-run or apply");
  }
  if (mode === "apply" && values["detail-report"]) {
    throw new Error("--detail-report is available only in dry-run mode");
  }

  const personId = required(
    process.env.FITNESS_TRACKER_PERSON_ID,
    "FITNESS_TRACKER_PERSON_ID"
  );
  const pool = new Pool({
    connectionString: required(process.env.DATABASE_URL, "DATABASE_URL"),
    max: 2
  });
  try {
    const source = createFitnessTrackerSource(
      values["snapshot-file"],
      process.env,
      domain
    );
    const snapshot = await source.readSnapshot();
    if (domain === "body") {
      const bodySnapshot = requireBodySnapshot(snapshot);
      if (mode === "apply") {
        const report = await new BodyImportApplyService(
          pool,
          FITNESS_TRACKER_SPREADSHEET_ID,
          bodySnapshot.body.sheetId
        ).apply(personId, bodySnapshot);
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      const result = await runDryRun(
        personId,
        { readSnapshot: async () => bodySnapshot },
        new PostgresBodyTargetReader(
          pool,
          FITNESS_TRACKER_SPREADSHEET_ID,
          bodySnapshot.body.sheetId
        ),
        new BodyDryRunAdapter()
      );
      if (values["detail-report"]) {
        await new PrivateJsonFileReportSink(values["detail-report"]).write(
          result.privateDetail
        );
      }
      process.stdout.write(`${JSON.stringify(result.safeReport, null, 2)}\n`);
      return;
    }

    const weightSnapshot = requireWeightSnapshot(snapshot);
    if (mode === "apply") {
      const report = await new WeightImportApplyService(
        pool,
        FITNESS_TRACKER_SPREADSHEET_ID,
        weightSnapshot.weight.sheetId
      ).apply(personId, weightSnapshot);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    const result = await runDryRun(
      personId,
      { readSnapshot: async () => weightSnapshot },
      new PostgresWeightTargetReader(
        pool,
        FITNESS_TRACKER_SPREADSHEET_ID,
        weightSnapshot.weight.sheetId
      ),
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

function requireBodySnapshot(
  snapshot: FitnessTrackerSourceSnapshot
): FitnessTrackerBodySnapshot {
  if (!("body" in snapshot) || snapshot.body === undefined) {
    throw new Error("Body import requires a schema v2 snapshot containing Body");
  }
  return snapshot as FitnessTrackerBodySnapshot;
}

function requireWeightSnapshot(
  snapshot: FitnessTrackerSourceSnapshot
): FitnessTrackerWeightSnapshot {
  if (!("weight" in snapshot) || snapshot.weight === undefined ||
      !("dailyLog" in snapshot) || snapshot.dailyLog === undefined) {
    throw new Error("Weight import requires Weight and Daily_Log sheets");
  }
  return snapshot as FitnessTrackerWeightSnapshot;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Fitness Tracker import failed"}\n`
  );
  process.exitCode = 1;
});
