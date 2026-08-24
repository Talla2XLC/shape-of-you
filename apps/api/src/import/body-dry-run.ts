import { createHash } from "node:crypto";

import type { BodyMeasurementValueInput } from "@shape-of-you/contracts";

import type {
  DryRunAdapterResult,
  DryRunImportAdapter,
  ImportOutcome,
  ImportSourceIdentity,
  SafeImportFinding
} from "./contracts.js";
import type {
  BoundedSheetRow,
  FitnessTrackerBodySnapshot,
  SheetCellValue
} from "./fitness-tracker-sheets-reader.js";

/** Comparable current Body aggregate returned by a typed target reader. */
export interface BodyImportTarget {
  readonly id: string;
  readonly sourceIdentity: ImportSourceIdentity;
  readonly checksum: string | null;
  readonly localDate: string;
  readonly temporalPrecision: "instant" | "local_date";
  readonly values: readonly BodyMeasurementValueInput[];
  readonly note: string | null;
}

/** Date-only Body candidate preserving the exact source identity and precision. */
export interface BodyImportCandidate {
  readonly locator: string;
  readonly sourceIdentity: ImportSourceIdentity;
  readonly checksum: string;
  readonly localDate: string;
  readonly temporalPrecision: "local_date";
  readonly values: readonly BodyMeasurementValueInput[];
  readonly note: string | null;
  readonly sourceLabel: string | null;
  readonly hasPhotoReference: boolean;
}

/** Typed private audit evidence for one Body reconciliation result. */
export interface BodyImportAuditRecord {
  readonly sourceSheetId: number | null;
  readonly sourceLocator: string;
  readonly sourceMeasurementId: string | null;
  readonly sourceLocalDate: string | null;
  readonly sourceChecksum: string | null;
  readonly normalizedLocalDate: string | null;
  readonly normalizedNote: string | null;
  readonly normalizedSource: string | null;
  readonly values: readonly BodyMeasurementValueInput[];
  readonly outcome: ImportOutcome;
  readonly findingCode: string;
  readonly targetSessionId: string | null;
}

/** Private Body result written only to protected files or relational audit. */
export interface BodyDryRunPrivateDetail {
  readonly candidates: readonly BodyImportCandidate[];
  readonly targetRecordIds: readonly string[];
  readonly records: readonly BodyImportAuditRecord[];
}

interface Finding extends SafeImportFinding {
  readonly sourceKeySort: string;
  readonly targetSessionId?: string;
}

const metricColumns = [
  ["Waist_cm", "waist"],
  ["Chest_cm", "chest"],
  ["Hips_cm", "hips"],
  ["Thigh_cm", "thigh"],
  ["Biceps_cm", "biceps"]
] as const;

/** Deterministic Body classifier used by both dry-run and apply. */
export class BodyDryRunAdapter
  implements DryRunImportAdapter<
    FitnessTrackerBodySnapshot,
    BodyImportTarget,
    BodyDryRunPrivateDetail
  >
{
  /** Classifies every Body source row without exposing private values. */
  public classify(
    snapshot: FitnessTrackerBodySnapshot,
    target: readonly BodyImportTarget[]
  ): DryRunAdapterResult<BodyDryRunPrivateDetail> {
    const indexes = columns(snapshot.body.headers, [
      "Date",
      "Waist_cm",
      "Chest_cm",
      "Hips_cm",
      "Thigh_cm",
      "Biceps_cm",
      "Photo",
      "Notes",
      "Measurement_ID",
      "Source"
    ] as const);
    const candidates: BodyImportCandidate[] = [];
    const findings: Finding[] = [];
    const invalidRecords: BodyImportAuditRecord[] = [];

    for (const row of snapshot.body.rows) {
      const normalized = normalizeBodyRow(row, indexes, snapshot);
      if (normalized.candidate) candidates.push(normalized.candidate);
      if (normalized.finding) {
        findings.push(normalized.finding);
        if (!normalized.candidate) {
          invalidRecords.push(normalized.invalidRecord!);
        }
      }
    }

    const duplicateKeys = new Set(
      candidates
        .map((candidate) => candidate.sourceIdentity.sourceKey)
        .filter((key, index, all) => all.indexOf(key) !== index)
    );
    const targetByIdentity = new Map<string, BodyImportTarget[]>();
    for (const row of target) {
      const key = identityKey(row.sourceIdentity);
      targetByIdentity.set(key, [...(targetByIdentity.get(key) ?? []), row]);
    }
    const sourceKeys = new Set(candidates.map((candidate) =>
      identityKey(candidate.sourceIdentity)
    ));

    for (const candidate of candidates) {
      if (candidate.hasPhotoReference) {
        findings.push(finding(
          "conflict",
          "unsupported_photo_reference",
          candidate.locator,
          candidate.sourceIdentity.sourceKey
        ));
        continue;
      }
      if (duplicateKeys.has(candidate.sourceIdentity.sourceKey)) {
        findings.push(finding(
          "conflict",
          "duplicate_source_identity",
          candidate.locator,
          candidate.sourceIdentity.sourceKey
        ));
        continue;
      }
      const matches = targetByIdentity.get(identityKey(candidate.sourceIdentity)) ?? [];
      if (matches.length === 0) {
        findings.push(finding(
          "created",
          "target_absent",
          candidate.locator,
          candidate.sourceIdentity.sourceKey
        ));
      } else if (matches.length !== 1) {
        findings.push(finding(
          "conflict",
          "duplicate_target_identity",
          candidate.locator,
          candidate.sourceIdentity.sourceKey
        ));
      } else if (equalTarget(matches[0]!, candidate)) {
        findings.push(finding(
          "unchanged",
          "semantic_match",
          candidate.locator,
          candidate.sourceIdentity.sourceKey,
          matches[0]!.id
        ));
      } else {
        findings.push(finding(
          "conflict",
          "target_mismatch",
          candidate.locator,
          candidate.sourceIdentity.sourceKey,
          matches[0]!.id
        ));
      }
    }
    for (const row of target) {
      if (!sourceKeys.has(identityKey(row.sourceIdentity))) {
        findings.push(finding(
          "conflict",
          "target_only",
          "postgresql",
          row.sourceIdentity.sourceKey,
          row.id
        ));
      }
    }

    findings.sort(compareFindings);
    const safeFindings = findings.map(({ outcome, code, locator, sourceKeyHash }) => ({
      outcome,
      code,
      locator,
      sourceKeyHash
    }));
    return {
      safeReport: {
        version: 1,
        mode: "dry_run",
        domain: "body",
        sourceManifestChecksum: snapshot.manifestChecksum,
        counts: countOutcomes(safeFindings),
        findings: safeFindings
      },
      privateDetail: {
        candidates: [...candidates].sort((left, right) =>
          left.sourceIdentity.sourceKey.localeCompare(right.sourceIdentity.sourceKey)
        ),
        targetRecordIds: target.map(({ id }) => id).sort(),
        records: [
          ...invalidRecords,
          ...findings
            .filter((item) => item.outcome !== "invalid")
            .map((item) => auditRecord(item, candidates, target, snapshot))
        ]
      }
    };
  }
}

function normalizeBodyRow(
  row: BoundedSheetRow,
  indexes: Readonly<Record<string, number>>,
  snapshot: FitnessTrackerBodySnapshot
): {
  readonly candidate?: BodyImportCandidate;
  readonly finding?: Finding;
  readonly invalidRecord?: BodyImportAuditRecord;
} {
  const measurementId = normalizeText(
    row.values[indexes.Measurement_ID!] ?? null,
    512
  );
  const localDate = normalizeDate(row.values[indexes.Date!] ?? null);
  const note = normalizeOptionalText(row.values[indexes.Notes!] ?? null, 4_096);
  const sourceLabel = normalizeOptionalText(row.values[indexes.Source!] ?? null, 256);
  if (!measurementId || !localDate || note === undefined || sourceLabel === undefined) {
    return invalidResult(
      row,
      snapshot.body.sheetId,
      "invalid_body_row",
      measurementId,
      localDate,
      note === undefined ? null : note,
      sourceLabel === undefined ? null : sourceLabel
    );
  }
  const values: BodyMeasurementValueInput[] = [];
  for (const [header, metric] of metricColumns) {
    const raw = row.values[indexes[header]!] ?? null;
    if (isBlank(raw)) continue;
    const value = normalizeMetric(raw);
    if (value === null) {
      return invalidResult(
        row,
        snapshot.body.sheetId,
        "invalid_body_row",
        measurementId,
        localDate,
        note,
        sourceLabel
      );
    }
    values.push({ metric, value, unit: "cm" });
  }
  if (values.length === 0) {
    return invalidResult(
      row,
      snapshot.body.sheetId,
      "missing_body_values",
      measurementId,
      localDate,
      note,
      sourceLabel
    );
  }
  const photoReference = normalizeOptionalText(
    row.values[indexes.Photo!] ?? null,
    4_096
  );
  if (photoReference === undefined) {
    return invalidResult(
      row,
      snapshot.body.sheetId,
      "invalid_body_row",
      measurementId,
      localDate,
      note,
      sourceLabel
    );
  }
  const hasPhotoReference = photoReference !== null;
  const sourceIdentity = {
    spreadsheetId: snapshot.spreadsheetId,
    sheetId: snapshot.body.sheetId,
    sourceKey: measurementId
  } as const;
  const candidate: BodyImportCandidate = {
    locator: row.locator,
    sourceIdentity,
    checksum: digest({ localDate, values, note, sourceLabel, photoReference }),
    localDate,
    temporalPrecision: "local_date",
    values,
    note,
    sourceLabel,
    hasPhotoReference
  };
  return { candidate };
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

function normalizeMetric(value: SheetCellValue): number | null {
  const numeric = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value.trim().replace(",", "."))
      : Number.NaN;
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 500) return null;
  const normalized = Number(numeric.toFixed(2));
  return Math.abs(normalized - numeric) < 0.000_001 ? normalized : null;
}

function normalizeText(value: SheetCellValue, max: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}

function normalizeOptionalText(
  value: SheetCellValue,
  max: number
): string | null | undefined {
  if (isBlank(value)) return null;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return normalized.length <= max ? normalized : undefined;
}

function isBlank(value: SheetCellValue): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function equalTarget(target: BodyImportTarget, candidate: BodyImportCandidate): boolean {
  return target.temporalPrecision === candidate.temporalPrecision &&
    target.localDate === candidate.localDate &&
    target.note === candidate.note &&
    target.checksum === candidate.checksum &&
    JSON.stringify(sortedValues(target.values)) === JSON.stringify(sortedValues(candidate.values)) &&
    identityKey(target.sourceIdentity) === identityKey(candidate.sourceIdentity);
}

function sortedValues(values: readonly BodyMeasurementValueInput[]) {
  return [...values].sort((left, right) => left.metric.localeCompare(right.metric));
}

function identityKey(identity: ImportSourceIdentity): string {
  return `${identity.spreadsheetId}:${identity.sheetId}:${identity.sourceKey}`;
}

function finding(
  outcome: ImportOutcome,
  code: string,
  locator: string,
  sourceKey: string,
  targetSessionId?: string
): Finding {
  return {
    outcome,
    code,
    locator,
    sourceKeyHash: digest(sourceKey).slice(0, 16),
    sourceKeySort: sourceKey,
    ...(targetSessionId ? { targetSessionId } : {})
  };
}

function compareFindings(left: Finding, right: Finding): number {
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
  for (const item of findings) counts[item.outcome] += 1;
  return counts;
}

function auditRecord(
  item: Finding,
  candidates: readonly BodyImportCandidate[],
  targets: readonly BodyImportTarget[],
  snapshot: FitnessTrackerBodySnapshot
): BodyImportAuditRecord {
  const candidate = candidates.find(({ locator }) => locator === item.locator);
  if (candidate) {
    const matches = targets.filter((target) =>
      identityKey(target.sourceIdentity) === identityKey(candidate.sourceIdentity)
    );
    return {
      sourceSheetId: snapshot.body.sheetId,
      sourceLocator: candidate.locator,
      sourceMeasurementId: candidate.sourceIdentity.sourceKey,
      sourceLocalDate: candidate.localDate,
      sourceChecksum: candidate.checksum,
      normalizedLocalDate: candidate.localDate,
      normalizedNote: candidate.note,
      normalizedSource: candidate.sourceLabel,
      values: candidate.values,
      outcome: item.outcome,
      findingCode: item.code,
      targetSessionId: matches.length === 1 ? matches[0]!.id : null
    };
  }
  const target = targets.find(({ id }) => id === item.targetSessionId);
  return {
    sourceSheetId: null,
    sourceLocator: target ? `postgresql:${target.id}` : "postgresql:unknown",
    sourceMeasurementId: target?.sourceIdentity.sourceKey ?? null,
    sourceLocalDate: target?.localDate ?? null,
    sourceChecksum: target?.checksum ?? null,
    normalizedLocalDate: target?.localDate ?? null,
    normalizedNote: target?.note ?? null,
    normalizedSource: null,
    values: target?.values ?? [],
    outcome: item.outcome,
    findingCode: item.code,
    targetSessionId: target?.id ?? null
  };
}

function invalidResult(
  row: BoundedSheetRow,
  sheetId: number,
  code: string,
  measurementId: string | null,
  localDate: string | null,
  note: string | null,
  sourceLabel: string | null
): { readonly finding: Finding; readonly invalidRecord: BodyImportAuditRecord } {
  const item = finding(
    "invalid",
    code,
    row.locator,
    measurementId ?? row.locator
  );
  return { finding: item, invalidRecord: {
    sourceSheetId: sheetId,
    sourceLocator: row.locator,
    sourceMeasurementId: measurementId,
    sourceLocalDate: localDate,
    sourceChecksum: digest(row.values),
    normalizedLocalDate: localDate,
    normalizedNote: note,
    normalizedSource: sourceLabel,
    values: [],
    outcome: item.outcome,
    findingCode: item.code,
    targetSessionId: null
  } };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
