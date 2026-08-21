/** Outcomes shared by every typed import adapter. */
export type ImportOutcome = "created" | "unchanged" | "conflict" | "invalid";

/** Immutable identity of one source record, separate from its content checksum. */
export interface ImportSourceIdentity {
  readonly spreadsheetId: string;
  readonly sheetId: number;
  readonly sourceKey: string;
}

/** Safe finding suitable for ordinary operator output. */
export interface SafeImportFinding {
  readonly outcome: ImportOutcome;
  readonly code: string;
  readonly locator: string;
  readonly sourceKeyHash: string;
}

/** Deterministic, non-sensitive dry-run report. */
export interface SafeImportReport {
  readonly version: 1;
  readonly mode: "dry_run";
  readonly domain: string;
  readonly sourceManifestChecksum: string;
  readonly counts: Readonly<Record<ImportOutcome, number>>;
  readonly findings: readonly SafeImportFinding[];
}

/** Adapter result containing safe output and an explicitly private detail payload. */
export interface DryRunAdapterResult<Detail> {
  readonly safeReport: SafeImportReport;
  readonly privateDetail: Detail;
}

/** Typed source snapshot reader. It exposes no mutation capability. */
export interface ImportSourceReader<Snapshot> {
  /** Reads one bounded immutable source snapshot. */
  readSnapshot(): Promise<Snapshot>;
}

/** Typed target reader. Implementations must not expose mutation methods. */
export interface ImportTargetReader<Target> {
  /** Reads comparison state for one data owner. */
  readTarget(personId: string): Promise<readonly Target[]>;
}

/** Domain-owned adapter used by the shared dry-run lifecycle. */
export interface DryRunImportAdapter<Snapshot, Target, Detail> {
  /** Classifies one source snapshot against read-only target state. */
  classify(
    snapshot: Snapshot,
    target: readonly Target[]
  ): DryRunAdapterResult<Detail>;
}

/**
 * Runs a typed import adapter without constructing or receiving a writer port.
 *
 * @param personId - Data-owner UUID used only by the target read boundary.
 * @param source - Read-only source snapshot reader.
 * @param target - Read-only target comparison reader.
 * @param adapter - Domain-owned deterministic classifier.
 * @returns Safe and private dry-run reports.
 */
export async function runDryRun<Snapshot, Target, Detail>(
  personId: string,
  source: ImportSourceReader<Snapshot>,
  target: ImportTargetReader<Target>,
  adapter: DryRunImportAdapter<Snapshot, Target, Detail>
): Promise<DryRunAdapterResult<Detail>> {
  const snapshot = await source.readSnapshot();
  const targetRows = await target.readTarget(personId);
  return adapter.classify(snapshot, targetRows);
}
