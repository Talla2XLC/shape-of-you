import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { Pool } from "pg";

import {
  runDryRun,
  type ImportOutcome,
  type SafeImportReport
} from "../import/contracts.js";
import { BodyDryRunAdapter } from "../import/body-dry-run.js";
import { BodyImportApplyService } from "../import/body-import-apply.js";
import {
  FITNESS_TRACKER_SPREADSHEET_ID,
  type FitnessTrackerImportDomain,
  type FitnessTrackerBodySnapshot,
  type FitnessTrackerNutritionSnapshot,
  type FitnessTrackerRecoverySnapshot,
  type FitnessTrackerSourceSnapshot,
  type FitnessTrackerTrainingSnapshot,
  type FitnessTrackerWeightSnapshot
} from "../import/fitness-tracker-sheets-reader.js";
import { createFitnessTrackerSource } from "../import/fitness-tracker-source.js";
import { PostgresWeightTargetReader } from "../import/postgres-weight-target-reader.js";
import { PostgresBodyTargetReader } from "../import/postgres-body-target-reader.js";
import { PrivateJsonFileReportSink } from "../import/private-report-sink.js";
import { WeightDryRunAdapter } from "../import/weight-dry-run.js";
import { WeightImportApplyService } from "../import/weight-import-apply.js";
import { NutritionDryRunAdapter } from "../import/nutrition-dry-run.js";
import { NutritionImportApplyService } from "../import/nutrition-import-apply.js";
import { PostgresNutritionTargetReader } from "../import/postgres-nutrition-target-reader.js";
import { TrainingDryRunAdapter } from "../import/training-dry-run.js";
import { TrainingImportApplyService } from "../import/training-import-apply.js";
import { PostgresTrainingTargetReader } from "../import/postgres-training-target-reader.js";
import { RecoveryDryRunAdapter } from "../import/recovery-dry-run.js";
import { RecoveryImportApplyService } from "../import/recovery-import-apply.js";
import { PostgresRecoveryTargetReader } from "../import/postgres-recovery-target-reader.js";

const importDomains = [
  "weight",
  "body",
  "nutrition",
  "training",
  "recovery"
] as const satisfies readonly FitnessTrackerImportDomain[];

type ImportMode = "dry-run" | "apply";
type ImportCommandDomain = FitnessTrackerImportDomain | "all";

const snapshotOptionByDomain = {
  weight: "weight-snapshot-file",
  body: "body-snapshot-file",
  nutrition: "nutrition-snapshot-file",
  training: "training-snapshot-file",
  recovery: "recovery-snapshot-file"
} as const satisfies Readonly<Record<FitnessTrackerImportDomain, string>>;

/** Safe failure marker for one independently executed all-domain step. */
export interface SafeAllDomainFailure {
  readonly domain: FitnessTrackerImportDomain;
  readonly code: "domain_execution_failed";
}

/** Safe aggregate emitted by the operator-facing all-domain orchestration. */
export interface SafeAllDomainImportReport {
  readonly version: 1;
  readonly mode: "dry_run" | "apply";
  readonly domain: "all";
  readonly counts: Readonly<Record<ImportOutcome, number>>;
  readonly domains: readonly SafeImportReport[];
  readonly failures: readonly SafeAllDomainFailure[];
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required runtime value ${name}`);
  return normalized;
}

/** Runs one domain or the deterministic all-domain operator orchestration. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      domain: { type: "string" },
      mode: { type: "string" },
      "detail-report": { type: "string" },
      "snapshot-file": { type: "string" },
      "weight-snapshot-file": { type: "string" },
      "body-snapshot-file": { type: "string" },
      "nutrition-snapshot-file": { type: "string" },
      "training-snapshot-file": { type: "string" },
      "recovery-snapshot-file": { type: "string" }
    }
  });
  const domain = parseDomain(required(values.domain, "--domain"));
  const mode = parseMode(required(values.mode, "--mode"));
  if (mode === "apply" && values["detail-report"]) {
    throw new Error("--detail-report is available only in dry-run mode");
  }
  if (domain === "all" && values["detail-report"]) {
    throw new Error("--detail-report is available only for one-domain runs");
  }

  const snapshotFiles = domain === "all"
    ? requireAllSnapshotFiles(values)
    : undefined;

  const personId = required(
    process.env.FITNESS_TRACKER_PERSON_ID,
    "FITNESS_TRACKER_PERSON_ID"
  );
  const pool = new Pool({
    connectionString: required(process.env.DATABASE_URL, "DATABASE_URL"),
    max: 2
  });
  try {
    if (domain === "all") {
      if (!snapshotFiles) throw new Error("All-domain snapshot files are missing");
      const report = await runAllDomainImports(
        mode,
        snapshotFiles,
        (currentDomain, snapshotFile) => runDomainImport(
            pool,
            personId,
            currentDomain,
            mode,
            snapshotFile
        )
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.failures.length > 0) process.exitCode = 1;
      return;
    }

    const report = await runDomainImport(
      pool,
      personId,
      domain,
      mode,
      values["snapshot-file"],
      values["detail-report"]
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

/** Runs one existing typed adapter and returns only its safe report. */
export async function runDomainImport(
  pool: Pool,
  personId: string,
  domain: FitnessTrackerImportDomain,
  mode: ImportMode,
  snapshotFile?: string,
  detailReport?: string
): Promise<SafeImportReport> {
    const source = createFitnessTrackerSource(snapshotFile, process.env, domain);
    const snapshot = await source.readSnapshot();
    if (domain === "training") {
      const trainingSnapshot = requireTrainingSnapshot(snapshot);
      if (mode === "apply") {
        return new TrainingImportApplyService(pool, FITNESS_TRACKER_SPREADSHEET_ID, trainingSnapshot.training.sheetId).apply(personId, trainingSnapshot);
      }
      const result = await runDryRun(personId, { readSnapshot: async () => trainingSnapshot }, new PostgresTrainingTargetReader(pool, FITNESS_TRACKER_SPREADSHEET_ID, trainingSnapshot.training.sheetId), new TrainingDryRunAdapter());
      if (detailReport) await new PrivateJsonFileReportSink(detailReport).write(result.privateDetail);
      return result.safeReport;
    }
    if (domain === "recovery") {
      const recoverySnapshot = requireRecoverySnapshot(snapshot);
      if (mode === "apply") {
        return new RecoveryImportApplyService(pool, FITNESS_TRACKER_SPREADSHEET_ID, recoverySnapshot.dailyLog.sheetId).apply(personId, recoverySnapshot);
      }
      const result = await runDryRun(personId, { readSnapshot: async () => recoverySnapshot }, new PostgresRecoveryTargetReader(pool, FITNESS_TRACKER_SPREADSHEET_ID, recoverySnapshot.dailyLog.sheetId), new RecoveryDryRunAdapter());
      if (detailReport) await new PrivateJsonFileReportSink(detailReport).write(result.privateDetail);
      return result.safeReport;
    }
    if (domain === "nutrition") {
      const nutritionSnapshot = requireNutritionSnapshot(snapshot);
      const sheetIds = {
        brands: nutritionSnapshot.brands.sheetId,
        ingredients: nutritionSnapshot.ingredients.sheetId,
        foods: nutritionSnapshot.foods.sheetId,
        foodIngredients: nutritionSnapshot.foodIngredients.sheetId,
        meals: nutritionSnapshot.meals.sheetId,
        dailyLog: nutritionSnapshot.dailyLog.sheetId
      };
      if (mode === "apply") {
        return new NutritionImportApplyService(
          pool,
          FITNESS_TRACKER_SPREADSHEET_ID,
          sheetIds
        ).apply(personId, nutritionSnapshot);
      }
      const result = await runDryRun(
        personId,
        { readSnapshot: async () => nutritionSnapshot },
        new PostgresNutritionTargetReader(
          pool,
          FITNESS_TRACKER_SPREADSHEET_ID,
          sheetIds
        ),
        new NutritionDryRunAdapter()
      );
      if (detailReport) {
        await new PrivateJsonFileReportSink(detailReport).write(
          result.privateDetail
        );
      }
      return result.safeReport;
    }
    if (domain === "body") {
      const bodySnapshot = requireBodySnapshot(snapshot);
      if (mode === "apply") {
        return new BodyImportApplyService(
          pool,
          FITNESS_TRACKER_SPREADSHEET_ID,
          bodySnapshot.body.sheetId
        ).apply(personId, bodySnapshot);
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
      if (detailReport) {
        await new PrivateJsonFileReportSink(detailReport).write(
          result.privateDetail
        );
      }
      return result.safeReport;
    }

    const weightSnapshot = requireWeightSnapshot(snapshot);
    if (mode === "apply") {
      return new WeightImportApplyService(
        pool,
        FITNESS_TRACKER_SPREADSHEET_ID,
        weightSnapshot.weight.sheetId
      ).apply(personId, weightSnapshot);
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
    if (detailReport) {
      await new PrivateJsonFileReportSink(detailReport).write(
        result.privateDetail
      );
    }
    return result.safeReport;
}

/** Combines independently safe domain reports without exposing private values. */
export function aggregateAllDomainReports(
  mode: ImportMode,
  reports: readonly SafeImportReport[],
  failures: readonly SafeAllDomainFailure[]
): SafeAllDomainImportReport {
  const counts: Record<ImportOutcome, number> = {
    created: 0,
    unchanged: 0,
    conflict: 0,
    invalid: 0
  };
  for (const report of reports) {
    for (const outcome of Object.keys(counts) as ImportOutcome[]) {
      counts[outcome] += report.counts[outcome];
    }
  }
  return {
    version: 1,
    mode: mode === "dry-run" ? "dry_run" : "apply",
    domain: "all",
    counts,
    domains: reports,
    failures
  };
}

/**
 * Runs every typed domain in fixed order and isolates failed domain steps.
 *
 * Completed apply steps retain their own transaction. The caller receives a
 * complete safe report and can fail the operator process after every domain
 * has been attempted.
 */
export async function runAllDomainImports(
  mode: ImportMode,
  snapshotFiles: Readonly<Record<FitnessTrackerImportDomain, string>>,
  runner: (
    domain: FitnessTrackerImportDomain,
    snapshotFile: string
  ) => Promise<SafeImportReport>
): Promise<SafeAllDomainImportReport> {
  const reports: SafeImportReport[] = [];
  const failures: SafeAllDomainFailure[] = [];
  for (const domain of importDomains) {
    try {
      reports.push(await runner(domain, snapshotFiles[domain]));
    } catch {
      failures.push({ domain, code: "domain_execution_failed" });
    }
  }
  return aggregateAllDomainReports(mode, reports, failures);
}

function parseDomain(value: string): ImportCommandDomain {
  if (value === "all" || importDomains.some((domain) => domain === value)) {
    return value as ImportCommandDomain;
  }
  throw new Error(
    `Unsupported import domain ${value}; available: ${importDomains.join(", ")}, all`
  );
}

function parseMode(value: string): ImportMode {
  if (value === "dry-run" || value === "apply") return value;
  throw new Error("--mode must be dry-run or apply");
}

function requireAllSnapshotFiles(
  values: Readonly<Record<string, string | boolean | undefined>>
): Readonly<Record<FitnessTrackerImportDomain, string>> {
  return Object.fromEntries(importDomains.map((domain) => {
    const option = snapshotOptionByDomain[domain];
    return [domain, required(
      typeof values[option] === "string" ? values[option] : undefined,
      `--${option}`
    )];
  })) as Readonly<Record<FitnessTrackerImportDomain, string>>;
}

function requireNutritionSnapshot(
  snapshot: FitnessTrackerSourceSnapshot
): FitnessTrackerNutritionSnapshot {
  if (!("brands" in snapshot) || !("ingredients" in snapshot) ||
      !("foods" in snapshot) || !("foodIngredients" in snapshot) ||
      !("meals" in snapshot) || !("dailyLog" in snapshot)) {
    throw new Error("Nutrition import requires linked Nutrition and Daily_Log sheets");
  }
  return snapshot as FitnessTrackerNutritionSnapshot;
}

function requireTrainingSnapshot(snapshot: FitnessTrackerSourceSnapshot): FitnessTrackerTrainingSnapshot {
  if (!("training" in snapshot) || snapshot.training === undefined) throw new Error("Training import requires the Training sheet");
  return snapshot as FitnessTrackerTrainingSnapshot;
}

function requireRecoverySnapshot(snapshot: FitnessTrackerSourceSnapshot): FitnessTrackerRecoverySnapshot {
  if (!("dailyLog" in snapshot) || "weight" in snapshot || "brands" in snapshot) throw new Error("Recovery import requires a raw Daily_Log snapshot");
  return snapshot as FitnessTrackerRecoverySnapshot;
}

function requireBodySnapshot(
  snapshot: FitnessTrackerSourceSnapshot
): FitnessTrackerBodySnapshot {
  if (!("body" in snapshot) || snapshot.body === undefined) {
    throw new Error("Body import requires a current-schema snapshot containing Body");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Fitness Tracker import failed"}\n`
    );
    process.exitCode = 1;
  });
}
