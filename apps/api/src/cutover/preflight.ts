import { createHash } from "node:crypto";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";

import type { FitnessTrackerImportDomain } from "../import/fitness-tracker-sheets-reader.js";
import type { SafeAllDomainImportReport } from "../commands/import-fitness-tracker.js";

export const cutoverDomains = [
  "weight",
  "body",
  "nutrition",
  "training",
  "recovery"
] as const satisfies readonly FitnessTrackerImportDomain[];

/** One MCP tool and its exact OAuth resource scope required before cutover. */
export interface CutoverWriterToolRequirement {
  readonly name: string;
  readonly scope: string;
  readonly canaryRequired: boolean;
}

/** Complete deployed connector surface required for exclusive writer cutover. */
export const cutoverWriterTools: readonly CutoverWriterToolRequirement[] = [
  { name: "list_weight_measurements", scope: "person:read", canaryRequired: false },
  { name: "record_weight_measurement", scope: "weight:write", canaryRequired: true },
  { name: "correct_weight_measurement", scope: "weight:write", canaryRequired: true },
  { name: "list_body_measurements", scope: "person:read", canaryRequired: false },
  { name: "record_body_measurements", scope: "body-measurement:write", canaryRequired: true },
  { name: "correct_body_measurements", scope: "body-measurement:write", canaryRequired: true },
  { name: "list_meals", scope: "person:read", canaryRequired: false },
  { name: "record_meal", scope: "meal:write", canaryRequired: true },
  { name: "correct_meal", scope: "meal:write", canaryRequired: true },
  { name: "get_active_training_program", scope: "person:read", canaryRequired: false },
  { name: "list_workout_sessions", scope: "person:read", canaryRequired: false },
  { name: "record_workout_session", scope: "workout:write", canaryRequired: true },
  { name: "correct_workout_session", scope: "workout:write", canaryRequired: true },
  { name: "list_recovery_observations", scope: "person:read", canaryRequired: false },
  { name: "record_recovery_observation", scope: "recovery:write", canaryRequired: true },
  { name: "correct_recovery_observation", scope: "recovery:write", canaryRequired: true },
  { name: "list_daily_context_notes", scope: "person:read", canaryRequired: false },
  { name: "record_daily_context_note", scope: "daily-context-note:write", canaryRequired: true },
  { name: "correct_daily_context_note", scope: "daily-context-note:write", canaryRequired: true },
  { name: "get_daily_projection", scope: "person:read", canaryRequired: false },
];

/** Immutable local evidence captured immediately before the writer switch. */
export interface CutoverPreflightManifest {
  readonly version: 1;
  readonly workbookId: string;
  readonly checkpointAt: string;
  readonly gitCommit: string;
  readonly snapshotChecksums: Readonly<Record<FitnessTrackerImportDomain, string>>;
  readonly reconciliation: SafeAllDomainImportReport;
  readonly requiredWriterTools: readonly CutoverWriterToolRequirement[];
}

/** Deployed tool/canary evidence supplied by an MCP E2E run. */
export interface CutoverWriterEvidence {
  readonly tools: readonly { readonly name: string; readonly scope: string }[];
  readonly canaries: readonly {
    readonly tool: string;
    readonly success: boolean;
    readonly readBack: boolean;
  }[];
}

/** Safe typed reference to one fact created after the source checkpoint. */
export interface PostCheckpointFact {
  readonly kind:
    | "weight_measurement"
    | "body_measurement_session"
    | "meal"
    | "workout_session"
    | "recovery_observation"
    | "daily_context_note";
  readonly id: string;
  readonly localDate: string;
  readonly createdAt: string;
}

/** Zero-write rollback rehearsal result grouped by replay owner. */
export interface CutoverRollbackPlan {
  readonly version: 1;
  readonly checkpointAt: string;
  readonly requiresReplay: boolean;
  readonly facts: readonly PostCheckpointFact[];
  readonly counts: Readonly<Record<PostCheckpointFact["kind"], number>>;
}

/** Computes a canonical SHA-256 checksum for one parsed bounded snapshot. */
export function canonicalSnapshotChecksum(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");
}

/** Reads and checksums each exact bounded private snapshot file. */
export async function checksumSnapshotFiles(
  files: Readonly<Record<FitnessTrackerImportDomain, string>>
): Promise<Readonly<Record<FitnessTrackerImportDomain, string>>> {
  const entries = await Promise.all(
    cutoverDomains.map(async (domain) => {
      const value: unknown = JSON.parse(await readFile(files[domain], "utf8"));
      return [domain, canonicalSnapshotChecksum(value)] as const;
    })
  );
  return Object.fromEntries(entries) as Readonly<Record<FitnessTrackerImportDomain, string>>;
}

/** Builds a checkpoint only from a conflict-free final reconciliation. */
export function createCutoverManifest(input: {
  readonly workbookId: string;
  readonly checkpointAt: string;
  readonly gitCommit: string;
  readonly snapshotChecksums: Readonly<Record<FitnessTrackerImportDomain, string>>;
  readonly reconciliation: SafeAllDomainImportReport;
}): CutoverPreflightManifest {
  if (
    input.reconciliation.failures.length > 0 ||
    input.reconciliation.counts.created > 0 ||
    input.reconciliation.counts.conflict > 0
  ) {
    throw new Error("Final reconciliation is not cutover-ready");
  }
  return {
    version: 1,
    workbookId: input.workbookId,
    checkpointAt: input.checkpointAt,
    gitCommit: input.gitCommit,
    snapshotChecksums: input.snapshotChecksums,
    reconciliation: input.reconciliation,
    requiredWriterTools: cutoverWriterTools
  };
}

/** Creates a new mode-0600 manifest without overwriting prior evidence. */
export async function writePrivateCutoverManifest(
  path: string,
  manifest: CutoverPreflightManifest
): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  await chmod(path, 0o600);
}

/** Reads a private manifest and rejects group/world-readable evidence. */
export async function readPrivateCutoverManifest(
  path: string
): Promise<CutoverPreflightManifest> {
  const metadata = await stat(path);
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("Cutover manifest permissions must be 0600");
  }
  const value = JSON.parse(await readFile(path, "utf8")) as CutoverPreflightManifest;
  if (value.version !== 1) throw new Error("Unsupported cutover manifest version");
  return value;
}

/** Proves that every bounded source snapshot still matches the checkpoint. */
export function verifyFrozenSnapshots(
  manifest: CutoverPreflightManifest,
  actual: Readonly<Record<FitnessTrackerImportDomain, string>>
): void {
  for (const domain of cutoverDomains) {
    if (manifest.snapshotChecksums[domain] !== actual[domain]) {
      throw new Error(`Source snapshot changed after checkpoint: ${domain}`);
    }
  }
}

/** Rejects incomplete deployed tool, scope, canary, or read-back evidence. */
export function verifyCutoverWriterEvidence(evidence: CutoverWriterEvidence): void {
  const tools = new Map(evidence.tools.map((tool) => [tool.name, tool.scope]));
  const canaries = new Map(evidence.canaries.map((item) => [item.tool, item]));
  for (const requirement of cutoverWriterTools) {
    if (tools.get(requirement.name) !== requirement.scope) {
      throw new Error(`Writer tool or scope is missing: ${requirement.name}`);
    }
    if (requirement.canaryRequired) {
      const canary = canaries.get(requirement.name);
      if (!canary?.success || !canary.readBack) {
        throw new Error(`Writer canary is incomplete: ${requirement.name}`);
      }
    }
  }
}

/** Creates a deterministic zero-write rollback plan for post-checkpoint facts. */
export function createRollbackPlan(
  checkpointAt: string,
  facts: readonly PostCheckpointFact[]
): CutoverRollbackPlan {
  const sorted = [...facts].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id)
  );
  const counts: Record<PostCheckpointFact["kind"], number> = {
    weight_measurement: 0,
    body_measurement_session: 0,
    meal: 0,
    workout_session: 0,
    recovery_observation: 0,
    daily_context_note: 0
  };
  for (const fact of sorted) counts[fact.kind] += 1;
  return {
    version: 1,
    checkpointAt,
    requiresReplay: sorted.length > 0,
    facts: sorted,
    counts
  };
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)])
    );
  }
  return value;
}
