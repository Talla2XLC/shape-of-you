import { createHash } from "node:crypto";

import type {
  RecoveryMetric,
  RecoveryMetricUnit,
  RecoveryObservationDetail
} from "@shape-of-you/contracts";

import type {
  DryRunAdapterResult,
  DryRunImportAdapter,
  ImportOutcome,
  ImportSourceIdentity,
  SafeImportFinding
} from "./contracts.js";
import type {
  FitnessTrackerRecoverySnapshot,
  SheetCellValue
} from "./fitness-tracker-sheets-reader.js";

export interface RecoveryImportCandidate {
  readonly locator: string;
  readonly sourceIdentity: ImportSourceIdentity;
  readonly checksum: string;
  readonly localDate: string;
  readonly detail: RecoveryObservationDetail;
}

export interface RecoveryImportTarget {
  readonly id: string;
  readonly sourceIdentity: ImportSourceIdentity;
  readonly checksum: string | null;
}

export interface RecoveryImportAuditRecord {
  readonly sourceSheetId: number | null;
  readonly sourceLocator: string;
  readonly sourceKey: string | null;
  readonly sourceLocalDate: string | null;
  readonly sourceChecksum: string | null;
  readonly detail: RecoveryObservationDetail | null;
  readonly outcome: ImportOutcome;
  readonly findingCode: string;
  readonly targetObservationId: string | null;
}

export interface RecoveryDryRunPrivateDetail {
  readonly candidates: readonly RecoveryImportCandidate[];
  readonly records: readonly RecoveryImportAuditRecord[];
}

interface Finding extends SafeImportFinding {
  readonly sourceKey: string;
  readonly targetObservationId: string | null;
}

const metricColumns: readonly [string, RecoveryMetric, RecoveryMetricUnit, number, number][] = [
  ["HRV", "hrv_rmssd", "ms", 0.001, 1000],
  ["RHR", "resting_heart_rate", "bpm", 0.001, 1000],
  ["NightHR", "night_heart_rate", "bpm", 0.001, 1000],
  ["SpO₂", "oxygen_saturation", "percent", 0, 100],
  ["MinSpO₂", "minimum_oxygen_saturation", "percent", 0, 100],
  ["Temp", "temperature_deviation", "celsius", -20, 20],
  ["Respiration", "respiration_rate", "breaths_per_minute", 0.001, 100],
  ["BodyBattery", "body_battery", "score", 0, 100]
];

/** Deterministic raw Recovery classifier used by dry-run and apply. */
export class RecoveryDryRunAdapter implements DryRunImportAdapter<
  FitnessTrackerRecoverySnapshot,
  RecoveryImportTarget,
  RecoveryDryRunPrivateDetail
> {
  public classify(
    snapshot: FitnessTrackerRecoverySnapshot,
    target: readonly RecoveryImportTarget[]
  ): DryRunAdapterResult<RecoveryDryRunPrivateDetail> {
    const indexes = columns(snapshot.dailyLog.headers);
    const candidates: RecoveryImportCandidate[] = [];
    const invalid: RecoveryImportAuditRecord[] = [];
    for (const row of snapshot.dailyLog.rows) {
      const localDate = date(row.values[indexes.Date!] ?? null);
      if (!localDate) {
        invalid.push(invalidRecord(snapshot.dailyLog.sheetId, row.locator, null, null, "invalid_recovery_date"));
        continue;
      }
      const sleepRaw = row.values[indexes.Sleep!] ?? null;
      if (!blank(sleepRaw)) {
        const totalSleepMinutes = durationMinutes(sleepRaw);
        if (totalSleepMinutes === null) {
          invalid.push(invalidRecord(snapshot.dailyLog.sheetId, row.locator, `${localDate}:sleep`, localDate, "invalid_sleep_value"));
        } else {
          const detail = {
            type: "sleep" as const,
            totalSleepMinutes,
            deepSleepMinutes: optionalDuration(row.values[indexes.DeepSleep!] ?? null),
            remSleepMinutes: optionalDuration(row.values[indexes.REMSleep!] ?? null),
            lightSleepMinutes: optionalDuration(row.values[indexes.LightSleep!] ?? null),
            sleepQuality: null
          };
          candidates.push(candidate(snapshot, row.locator, localDate, "sleep", detail));
        }
      }
      for (const [column, metric, unit, minimum, maximum] of metricColumns) {
        const raw = row.values[indexes[column] ?? -1] ?? null;
        if (blank(raw)) continue;
        const value = number(raw);
        const sourceKey = `${localDate}:${metric}`;
        if (value === null || value < minimum || value > maximum) {
          invalid.push(invalidRecord(snapshot.dailyLog.sheetId, row.locator, sourceKey, localDate, "invalid_recovery_metric"));
          continue;
        }
        candidates.push(candidate(snapshot, row.locator, localDate, metric, {
          type: "metric",
          metric,
          value,
          unit
        }));
      }
    }

    const duplicate = new Set(candidates.map(({ sourceIdentity }) => sourceIdentity.sourceKey)
      .filter((key, index, all) => all.indexOf(key) !== index));
    const targetByKey = new Map<string, RecoveryImportTarget[]>();
    for (const item of target) {
      const key = identityKey(item.sourceIdentity);
      targetByKey.set(key, [...(targetByKey.get(key) ?? []), item]);
    }
    const findings: Finding[] = [];
    for (const item of candidates) {
      const matches = targetByKey.get(identityKey(item.sourceIdentity)) ?? [];
      if (duplicate.has(item.sourceIdentity.sourceKey)) findings.push(finding(item, "conflict", "duplicate_source_identity", null));
      else if (matches.length === 0) findings.push(finding(item, "created", "target_absent", null));
      else if (matches.length !== 1) findings.push(finding(item, "conflict", "duplicate_target_identity", null));
      else if (matches[0]!.checksum === item.checksum) findings.push(finding(item, "unchanged", "semantic_match", matches[0]!.id));
      else findings.push(finding(item, "conflict", "target_mismatch", matches[0]!.id));
    }
    const sourceKeys = new Set(candidates.map(({ sourceIdentity }) => identityKey(sourceIdentity)));
    for (const item of target) {
      if (!sourceKeys.has(identityKey(item.sourceIdentity))) {
        findings.push({ outcome: "conflict", code: "target_only", locator: "postgresql", sourceKey: item.sourceIdentity.sourceKey, sourceKeyHash: hash(item.sourceIdentity.sourceKey), targetObservationId: item.id });
      }
    }
    const safe = [
      ...invalid.map((item) => ({ outcome: item.outcome, code: item.findingCode, locator: item.sourceLocator, sourceKeyHash: hash(item.sourceKey ?? item.sourceLocator) })),
      ...findings.map(({ outcome, code, locator, sourceKeyHash }) => ({ outcome, code, locator, sourceKeyHash }))
    ].sort((left, right) => left.locator.localeCompare(right.locator) || left.code.localeCompare(right.code));
    return {
      safeReport: { version: 1, mode: "dry_run", domain: "recovery", sourceManifestChecksum: snapshot.manifestChecksum, counts: count(safe), findings: safe },
      privateDetail: {
        candidates,
        records: [...invalid, ...findings.map((item) => audit(item, candidates))]
      }
    };
  }
}

function candidate(
  snapshot: FitnessTrackerRecoverySnapshot,
  locator: string,
  localDate: string,
  key: string,
  detail: RecoveryObservationDetail
): RecoveryImportCandidate {
  const sourceIdentity = { spreadsheetId: snapshot.spreadsheetId, sheetId: snapshot.dailyLog.sheetId, sourceKey: `${localDate}:${key}` };
  return { locator: `${locator}:${key}`, sourceIdentity, checksum: hash({ localDate, detail }), localDate, detail };
}
function columns(headers: readonly string[]): Record<string, number> {
  const required = ["Date", "Sleep", "HRV", "RHR", "NightHR", "SpO₂", "Temp", "BodyBattery", "MinSpO₂", "Respiration", "DeepSleep", "REMSleep", "LightSleep"];
  return Object.fromEntries(required.map((name) => {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error(`Daily_Log header ${name} is missing`);
    return [name, index];
  }));
}
function blank(value: SheetCellValue): boolean { return value === null || String(value).trim() === ""; }
function number(value: SheetCellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function durationMinutes(value: SheetCellValue): number | null {
  if (typeof value === "number" && value >= 0 && value <= 1) return Math.round(value * 1440);
  const match = /^(\d{1,2}):(\d{2})$/u.exec(String(value ?? "").trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes <= 1440 ? minutes : null;
}
function optionalDuration(value: SheetCellValue): number | null {
  return blank(value) ? null : durationMinutes(value);
}
function date(value: SheetCellValue): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + Math.trunc(value) * 86_400_000).toISOString().slice(0, 10);
  const normalized = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return normalized;
  const match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/u.exec(normalized);
  return match ? `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}` : null;
}
function finding(candidate: RecoveryImportCandidate, outcome: ImportOutcome, code: string, targetObservationId: string | null): Finding {
  return { outcome, code, locator: candidate.locator, sourceKey: candidate.sourceIdentity.sourceKey, sourceKeyHash: hash(candidate.sourceIdentity.sourceKey), targetObservationId };
}
function audit(item: Finding, candidates: readonly RecoveryImportCandidate[]): RecoveryImportAuditRecord {
  const candidate = candidates.find(({ sourceIdentity }) => sourceIdentity.sourceKey === item.sourceKey);
  return { sourceSheetId: candidate?.sourceIdentity.sheetId ?? null, sourceLocator: item.locator, sourceKey: item.sourceKey, sourceLocalDate: candidate?.localDate ?? null, sourceChecksum: candidate?.checksum ?? null, detail: candidate?.detail ?? null, outcome: item.outcome, findingCode: item.code, targetObservationId: item.targetObservationId };
}
function invalidRecord(sheetId: number, locator: string, sourceKey: string | null, localDate: string | null, code: string): RecoveryImportAuditRecord {
  return { sourceSheetId: sheetId, sourceLocator: locator, sourceKey, sourceLocalDate: localDate, sourceChecksum: null, detail: null, outcome: "invalid", findingCode: code, targetObservationId: null };
}
function identityKey(value: ImportSourceIdentity): string { return `${value.spreadsheetId}:${value.sheetId}:${value.sourceKey}`; }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function count(findings: readonly SafeImportFinding[]): Record<ImportOutcome, number> { const result = { created: 0, unchanged: 0, conflict: 0, invalid: 0 }; for (const item of findings) result[item.outcome] += 1; return result; }
