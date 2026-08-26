import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { Pool } from "pg";

import {
  FITNESS_TRACKER_SPREADSHEET_ID,
  type FitnessTrackerImportDomain
} from "../import/fitness-tracker-sheets-reader.js";
import {
  runAllDomainImports,
  runDomainImport
} from "./import-fitness-tracker.js";
import {
  checksumSnapshotFiles,
  createCutoverManifest,
  createRollbackPlan,
  cutoverDomains,
  readPrivateCutoverManifest,
  verifyCutoverWriterEvidence,
  verifyFrozenSnapshots,
  writePrivateCutoverManifest,
  type CutoverWriterEvidence,
  type PostCheckpointFact
} from "../cutover/preflight.js";

type Phase = "prepare" | "verify-frozen" | "verify-writer" | "rehearse-rollback";

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required runtime value ${name}`);
  return normalized;
}

function parsePhase(value: string): Phase {
  if (["prepare", "verify-frozen", "verify-writer", "rehearse-rollback"].includes(value)) {
    return value as Phase;
  }
  throw new Error("--phase must be prepare, verify-frozen, verify-writer, or rehearse-rollback");
}

function snapshotFiles(values: Record<string, string | boolean | undefined>): Readonly<Record<FitnessTrackerImportDomain, string>> {
  return Object.fromEntries(
    cutoverDomains.map((domain) => [
      domain,
      required(values[`${domain}-snapshot-file`] as string | undefined, `--${domain}-snapshot-file`)
    ])
  ) as Readonly<Record<FitnessTrackerImportDomain, string>>;
}

/** Runs one explicitly selected, zero-Sheets-write cutover preflight phase. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      phase: { type: "string" },
      manifest: { type: "string" },
      "git-commit": { type: "string" },
      "writer-evidence": { type: "string" },
      "weight-snapshot-file": { type: "string" },
      "body-snapshot-file": { type: "string" },
      "nutrition-snapshot-file": { type: "string" },
      "training-snapshot-file": { type: "string" },
      "recovery-snapshot-file": { type: "string" }
    }
  });
  const phase = parsePhase(required(values.phase, "--phase"));
  const manifestPath = required(values.manifest, "--manifest");

  if (phase === "verify-writer") {
    const evidence = JSON.parse(
      await readFile(required(values["writer-evidence"], "--writer-evidence"), "utf8")
    ) as CutoverWriterEvidence;
    verifyCutoverWriterEvidence(evidence);
    process.stdout.write(`${JSON.stringify({ phase, verified: true })}\n`);
    return;
  }

  if (phase === "verify-frozen") {
    const manifest = await readPrivateCutoverManifest(manifestPath);
    verifyFrozenSnapshots(manifest, await checksumSnapshotFiles(snapshotFiles(values)));
    process.stdout.write(`${JSON.stringify({ phase, verified: true })}\n`);
    return;
  }

  const pool = new Pool({
    connectionString: required(process.env.DATABASE_URL, "DATABASE_URL"),
    max: 2
  });
  try {
    if (phase === "prepare") {
      const files = snapshotFiles(values);
      const personId = required(process.env.FITNESS_TRACKER_PERSON_ID, "FITNESS_TRACKER_PERSON_ID");
      const report = await runAllDomainImports("dry-run", files, (domain, file) =>
        runDomainImport(pool, personId, domain, "dry-run", file)
      );
      const manifest = createCutoverManifest({
        workbookId: FITNESS_TRACKER_SPREADSHEET_ID,
        checkpointAt: new Date().toISOString(),
        gitCommit: required(values["git-commit"], "--git-commit"),
        snapshotChecksums: await checksumSnapshotFiles(files),
        reconciliation: report
      });
      await writePrivateCutoverManifest(manifestPath, manifest);
      process.stdout.write(`${JSON.stringify({ phase, counts: report.counts, failures: report.failures.length })}\n`);
      return;
    }

    const manifest = await readPrivateCutoverManifest(manifestPath);
    const personId = required(process.env.FITNESS_TRACKER_PERSON_ID, "FITNESS_TRACKER_PERSON_ID");
    const result = await pool.query<PostCheckpointFact>(
      `select 'weight_measurement'::text as kind, id::text, local_date::text as "localDate", created_at::text as "createdAt" from weight_measurements where created_at > $1 and person_id = $2
       union all select 'body_measurement_session', id::text, local_date::text, created_at::text from body_measurement_sessions where created_at > $1 and person_id = $2
       union all select 'meal', id::text, local_date::text, created_at::text from meals where created_at > $1 and person_id = $2
       union all select 'workout_session', id::text, local_date::text, created_at::text from workout_sessions where created_at > $1 and person_id = $2
       union all select 'recovery_observation', id::text, local_date::text, created_at::text from recovery_observations where created_at > $1 and person_id = $2
       union all select 'daily_context_note', id::text, local_date::text, created_at::text from daily_context_notes where created_at > $1 and person_id = $2`,
      [manifest.checkpointAt, personId]
    );
    const plan = createRollbackPlan(manifest.checkpointAt, result.rows);
    process.stdout.write(`${JSON.stringify({ phase, ...plan }, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
