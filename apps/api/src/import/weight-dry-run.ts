import { createHash } from "node:crypto";

import {
  reconcileWeightMirror,
  type AuthoritativeWeightRow,
  type DailyWeightMirrorRow
} from "../domain/weight-source-reconciliation.js";
import type {
  DryRunAdapterResult,
  DryRunImportAdapter,
  ImportOutcome,
  ImportSourceIdentity,
  SafeImportFinding
} from "./contracts.js";
import type {
  BoundedSheetRow,
  FitnessTrackerWeightSnapshot,
  SheetCellValue
} from "./fitness-tracker-sheets-reader.js";

/** Comparable current Weight fact returned by a typed target reader. */
export interface WeightImportTarget {
  readonly id: string;
  readonly sourceIdentity: ImportSourceIdentity;
  readonly checksum: string | null;
  readonly localDate: string;
  readonly temporalPrecision: "instant" | "local_date";
  readonly weightKg: number;
}

/** Date-only Weight candidate preserving the precision present in Sheets. */
export interface WeightImportCandidate {
  readonly locator: string;
  readonly sourceIdentity: ImportSourceIdentity;
  readonly checksum: string;
  readonly localDate: string;
  readonly temporalPrecision: "local_date";
  readonly weightKg: number;
}

/** Private result retained only when an operator explicitly requests it. */
export interface WeightDryRunPrivateDetail {
  readonly candidates: readonly WeightImportCandidate[];
  readonly targetRecordIds: readonly string[];
  readonly records: readonly WeightImportAuditRecord[];
}

/** Typed private evidence persisted for one Weight reconciliation finding. */
export interface WeightImportAuditRecord {
  readonly role: "authority" | "mirror" | "target";
  readonly sourceSheetId: number | null;
  readonly sourceLocator: string;
  readonly sourceLocalDate: string | null;
  readonly sourceChecksum: string | null;
  readonly normalizedLocalDate: string | null;
  readonly normalizedWeightKg: number | null;
  readonly outcome: ImportOutcome;
  readonly findingCode: string;
  readonly targetMeasurementId: string | null;
}

interface SortableFinding extends SafeImportFinding {
  readonly sourceKeySort: string;
  readonly targetRecordId?: string;
}

/** Deterministic typed Weight classifier used by the shared dry-run lifecycle. */
export class WeightDryRunAdapter
  implements
    DryRunImportAdapter<
      FitnessTrackerWeightSnapshot,
      WeightImportTarget,
      WeightDryRunPrivateDetail
    >
{
  /** Classifies Weight authority, mirror evidence, and current target records. */
  public classify(
    snapshot: FitnessTrackerWeightSnapshot,
    target: readonly WeightImportTarget[]
  ): DryRunAdapterResult<WeightDryRunPrivateDetail> {
    const authorityColumns = columns(snapshot.weight.headers, ["Date", "Weight_kg"]);
    const mirrorColumns = columns(snapshot.dailyLog.headers, ["Date", "Weight"]);
    const invalid: SortableFinding[] = [];
    const candidates: WeightImportCandidate[] = [];
    const authorityRows: AuthoritativeWeightRow[] = [];
    const mirrorRows: DailyWeightMirrorRow[] = [];

    for (const row of snapshot.weight.rows) {
      const normalized = normalizeWeightRow(row, authorityColumns, snapshot, invalid);
      if (normalized) {
        candidates.push(normalized);
        authorityRows.push({
          sourceRecordId: row.locator,
          localDate: normalized.localDate,
          weightKg: normalized.weightKg
        });
      }
    }
    for (const row of snapshot.dailyLog.rows) {
      const dateValue = row.values[mirrorColumns.Date] ?? null;
      const weightValue = row.values[mirrorColumns.Weight] ?? null;
      if (isBlank(dateValue) && isBlank(weightValue)) continue;
      const localDate = normalizeDate(dateValue);
      const weightKg = isBlank(weightValue) ? null : normalizeWeight(weightValue);
      if (!localDate || (!isBlank(weightValue) && weightKg === null)) {
        invalid.push(finding("invalid", "invalid_mirror_row", row.locator, row.locator));
        continue;
      }
      mirrorRows.push({ sourceRecordId: row.locator, localDate, weightKg });
    }

    const reconciliation = reconcileWeightMirror(authorityRows, mirrorRows);
    const conflictedDates = new Set(reconciliation.findings.map((item) => item.localDate));
    const findings: SortableFinding[] = [...invalid];
    for (const item of reconciliation.findings) {
      for (const locator of [...item.authoritativeRecordIds, ...item.mirrorRecordIds]) {
        findings.push(finding("conflict", item.kind, locator, item.localDate));
      }
    }

    const targetByIdentity = new Map<string, WeightImportTarget[]>();
    for (const row of target) {
      const key = identityKey(row.sourceIdentity);
      targetByIdentity.set(key, [...(targetByIdentity.get(key) ?? []), row]);
    }
    const sourceKeys = new Set(candidates.map((candidate) => identityKey(candidate.sourceIdentity)));
    for (const candidate of candidates) {
      if (conflictedDates.has(candidate.localDate)) continue;
      const matches = targetByIdentity.get(identityKey(candidate.sourceIdentity)) ?? [];
      if (matches.length === 0) {
        findings.push(finding("created", "target_absent", candidate.locator, candidate.sourceIdentity.sourceKey));
      } else if (matches.length !== 1) {
        findings.push(finding("conflict", "duplicate_target_identity", candidate.locator, candidate.sourceIdentity.sourceKey));
      } else if (equalTarget(matches[0]!, candidate)) {
        findings.push(finding("unchanged", "semantic_match", candidate.locator, candidate.sourceIdentity.sourceKey));
      } else {
        findings.push(finding("conflict", "target_mismatch", candidate.locator, candidate.sourceIdentity.sourceKey));
      }
    }
    for (const row of target) {
      if (!sourceKeys.has(identityKey(row.sourceIdentity))) {
        findings.push(
          finding(
            "conflict",
            "target_only",
            "postgresql",
            row.sourceIdentity.sourceKey,
            row.id
          )
        );
      }
    }

    findings.sort(compareFindings);
    const safeFindings = findings.map((item) => ({
      outcome: item.outcome,
      code: item.code,
      locator: item.locator,
      sourceKeyHash: item.sourceKeyHash
    }));
    return {
      safeReport: {
        version: 1,
        mode: "dry_run",
        domain: "weight",
        sourceManifestChecksum: snapshot.manifestChecksum,
        counts: countOutcomes(safeFindings),
        findings: safeFindings
      },
      privateDetail: {
        candidates: [...candidates].sort((left, right) =>
          left.sourceIdentity.sourceKey.localeCompare(right.sourceIdentity.sourceKey)
        ),
        targetRecordIds: target.map((row) => row.id).sort(),
        records: findings.map((item) => auditRecord(item, candidates, mirrorRows, target, snapshot))
      }
    };
  }
}

function normalizeWeightRow(
  row: BoundedSheetRow,
  indexes: Readonly<Record<"Date" | "Weight_kg", number>>,
  snapshot: FitnessTrackerWeightSnapshot,
  invalid: SortableFinding[]
): WeightImportCandidate | null {
  const localDate = normalizeDate(row.values[indexes.Date] ?? null);
  const weightKg = normalizeWeight(row.values[indexes.Weight_kg] ?? null);
  if (!localDate || weightKg === null) {
    invalid.push(finding("invalid", "invalid_authority_row", row.locator, row.locator));
    return null;
  }
  const sourceIdentity = {
    spreadsheetId: snapshot.spreadsheetId,
    sheetId: snapshot.weight.sheetId,
    sourceKey: localDate
  } as const;
  return {
    locator: row.locator,
    sourceIdentity,
    checksum: hash(JSON.stringify({ localDate, weightKg })),
    localDate,
    temporalPrecision: "local_date",
    weightKg
  };
}

function columns<Header extends string>(
  headers: readonly string[],
  required: readonly Header[]
): Readonly<Record<Header, number>> {
  return Object.fromEntries(required.map((header) => {
    const index = headers.indexOf(header);
    if (index < 0) throw new Error(`Required source header ${header} is missing`);
    return [header, index];
  })) as Readonly<Record<Header, number>>;
}

function normalizeDate(value: SheetCellValue): string | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    const date = new Date(Date.UTC(1899, 11, 30 + value));
    return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(normalized);
  const candidate = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : ru
      ? `${ru[3]}-${ru[2]}-${ru[1]}`
      : null;
  if (!candidate) return null;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : null;
}

function normalizeWeight(value: SheetCellValue): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.trim().replace(",", "."))
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 0.5 || numeric > 700) return null;
  return Number(numeric.toFixed(3));
}

function isBlank(value: SheetCellValue): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function equalTarget(target: WeightImportTarget, candidate: WeightImportCandidate): boolean {
  return target.temporalPrecision === candidate.temporalPrecision &&
    target.localDate === candidate.localDate &&
    target.weightKg === candidate.weightKg &&
    target.checksum === candidate.checksum &&
    identityKey(target.sourceIdentity) === identityKey(candidate.sourceIdentity);
}

function identityKey(identity: ImportSourceIdentity): string {
  return `${identity.spreadsheetId}:${identity.sheetId}:${identity.sourceKey}`;
}

function finding(
  outcome: ImportOutcome,
  code: string,
  locator: string,
  sourceKey: string,
  targetRecordId?: string
): SortableFinding {
  return {
    outcome,
    code,
    locator,
    sourceKeyHash: hash(sourceKey).slice(0, 16),
    sourceKeySort: sourceKey,
    ...(targetRecordId ? { targetRecordId } : {})
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function compareFindings(left: SortableFinding, right: SortableFinding): number {
  const order: Record<ImportOutcome, number> = {
    created: 0,
    unchanged: 1,
    conflict: 2,
    invalid: 3
  };
  return order[left.outcome] - order[right.outcome] ||
    left.sourceKeySort.localeCompare(right.sourceKeySort) ||
    left.locator.localeCompare(right.locator) ||
    left.code.localeCompare(right.code);
}

function countOutcomes(findings: readonly SafeImportFinding[]): Record<ImportOutcome, number> {
  const counts: Record<ImportOutcome, number> = {
    created: 0,
    unchanged: 0,
    conflict: 0,
    invalid: 0
  };
  for (const finding of findings) counts[finding.outcome] += 1;
  return counts;
}

function auditRecord(
  finding: SortableFinding,
  candidates: readonly WeightImportCandidate[],
  mirrors: readonly DailyWeightMirrorRow[],
  targets: readonly WeightImportTarget[],
  snapshot: FitnessTrackerWeightSnapshot
): WeightImportAuditRecord {
  const candidate = candidates.find((item) => item.locator === finding.locator);
  if (candidate) {
    const matches = targets.filter(
      (target) => identityKey(target.sourceIdentity) === identityKey(candidate.sourceIdentity)
    );
    return {
      role: "authority",
      sourceSheetId: snapshot.weight.sheetId,
      sourceLocator: candidate.locator,
      sourceLocalDate: candidate.localDate,
      sourceChecksum: candidate.checksum,
      normalizedLocalDate: candidate.localDate,
      normalizedWeightKg: candidate.weightKg,
      outcome: finding.outcome,
      findingCode: finding.code,
      targetMeasurementId: matches.length === 1 ? matches[0]!.id : null
    };
  }
  const mirror = mirrors.find((item) => item.sourceRecordId === finding.locator);
  if (mirror) {
    return {
      role: "mirror",
      sourceSheetId: snapshot.dailyLog.sheetId,
      sourceLocator: mirror.sourceRecordId,
      sourceLocalDate: mirror.localDate,
      sourceChecksum: hash(JSON.stringify({ localDate: mirror.localDate, weightKg: mirror.weightKg })),
      normalizedLocalDate: mirror.localDate,
      normalizedWeightKg: mirror.weightKg,
      outcome: finding.outcome,
      findingCode: finding.code,
      targetMeasurementId: null
    };
  }
  if (finding.locator === "postgresql") {
    const target = targets.find(
      (item) => item.id === finding.targetRecordId
    );
    return {
      role: "target",
      sourceSheetId: null,
      sourceLocator: target ? `postgresql:${target.id}` : "postgresql:unknown",
      sourceLocalDate: target?.localDate ?? null,
      sourceChecksum: target?.checksum ?? null,
      normalizedLocalDate: target?.localDate ?? null,
      normalizedWeightKg: target?.weightKg ?? null,
      outcome: finding.outcome,
      findingCode: finding.code,
      targetMeasurementId: target?.id ?? null
    };
  }
  return {
    role: finding.locator.startsWith("Daily_Log!") ? "mirror" : "authority",
    sourceSheetId: finding.locator.startsWith("Daily_Log!")
      ? snapshot.dailyLog.sheetId
      : snapshot.weight.sheetId,
    sourceLocator: finding.locator,
    sourceLocalDate: null,
    sourceChecksum: null,
    normalizedLocalDate: null,
    normalizedWeightKg: null,
    outcome: finding.outcome,
    findingCode: finding.code,
    targetMeasurementId: null
  };
}
