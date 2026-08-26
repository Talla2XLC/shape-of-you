import { createHash } from "node:crypto";

import type {
  DryRunAdapterResult,
  DryRunImportAdapter,
  ImportOutcome,
  ImportSourceIdentity,
  SafeImportFinding
} from "./contracts.js";
import type {
  BoundedSheetRow,
  FitnessTrackerTrainingSnapshot,
  SheetCellValue
} from "./fitness-tracker-sheets-reader.js";

export interface TrainingImportSet {
  readonly weightKg: number | null;
  readonly reps: number | null;
  readonly durationSeconds: number | null;
  readonly distanceMeters: number | null;
  readonly rir: number | null;
}

export interface TrainingImportExercise {
  readonly locator: string;
  readonly sourceExerciseId: string;
  readonly sourceName: string;
  readonly sourceReps: string;
  readonly loadBasis: "external_weight" | "body_weight";
  readonly feeling: string | null;
  readonly note: string | null;
  readonly sets: readonly TrainingImportSet[];
}

export interface TrainingImportCandidate {
  readonly locator: string;
  readonly sourceIdentity: ImportSourceIdentity;
  readonly checksum: string;
  readonly localDate: string;
  readonly workoutName: string;
  readonly exercises: readonly TrainingImportExercise[];
}

export interface TrainingImportSessionTarget {
  readonly kind: "session";
  readonly id: string;
  readonly sourceIdentity: ImportSourceIdentity;
  readonly checksum: string | null;
}

export interface TrainingImportExerciseMappingTarget {
  readonly kind: "exercise_mapping";
  readonly id: string;
  readonly sourceExerciseId: string;
  readonly sourceName: string;
  readonly checksum: string;
}

export type TrainingImportTarget =
  | TrainingImportSessionTarget
  | TrainingImportExerciseMappingTarget;

export interface TrainingImportAuditRecord {
  readonly sourceSheetId: number | null;
  readonly sourceLocator: string;
  readonly sourceSessionId: string | null;
  readonly sourceLocalDate: string | null;
  readonly sourceChecksum: string | null;
  readonly normalizedWorkoutName: string | null;
  readonly exercises: readonly TrainingImportExercise[];
  readonly outcome: ImportOutcome;
  readonly findingCode: string;
  readonly targetSessionId: string | null;
}

export interface TrainingDryRunPrivateDetail {
  readonly candidates: readonly TrainingImportCandidate[];
  readonly records: readonly TrainingImportAuditRecord[];
}

interface Finding extends SafeImportFinding {
  readonly sourceKey: string;
  readonly targetSessionId: string | null;
}

/** Deterministic Training classifier used by dry-run and transactional apply. */
export class TrainingDryRunAdapter implements DryRunImportAdapter<
  FitnessTrackerTrainingSnapshot,
  TrainingImportTarget,
  TrainingDryRunPrivateDetail
> {
  public classify(
    snapshot: FitnessTrackerTrainingSnapshot,
    target: readonly TrainingImportTarget[]
  ): DryRunAdapterResult<TrainingDryRunPrivateDetail> {
    const indexes = columns(snapshot.training.headers);
    const grouped = new Map<string, BoundedSheetRow[]>();
    const invalid: TrainingImportAuditRecord[] = [];
    for (const row of snapshot.training.rows) {
      const sessionId = text(row.values[indexes.Session_ID!] ?? null, 512);
      if (!sessionId) {
        invalid.push(invalidRecord(row, snapshot.training.sheetId, "missing_session_identity"));
        continue;
      }
      grouped.set(sessionId, [...(grouped.get(sessionId) ?? []), row]);
    }

    const candidates: TrainingImportCandidate[] = [];
    for (const [sessionId, rows] of grouped) {
      const normalized = normalizeSession(snapshot, sessionId, rows, indexes);
      if ("candidate" in normalized) candidates.push(normalized.candidate);
      else invalid.push(normalized.record);
    }

    const duplicateKeys = new Set(
      candidates.map((item) => item.sourceIdentity.sourceKey)
        .filter((key, index, all) => all.indexOf(key) !== index)
    );
    const sessionTargets = target.filter((item): item is TrainingImportSessionTarget => item.kind === "session");
    const mappingByExerciseId = new Map(
      target.filter((item): item is TrainingImportExerciseMappingTarget => item.kind === "exercise_mapping")
        .map((item) => [item.sourceExerciseId, item])
    );
    const targetByKey = new Map<string, TrainingImportSessionTarget[]>();
    for (const item of sessionTargets) {
      const key = identityKey(item.sourceIdentity);
      targetByKey.set(key, [...(targetByKey.get(key) ?? []), item]);
    }
    const findings: Finding[] = [];
    for (const candidate of candidates) {
      const matches = targetByKey.get(identityKey(candidate.sourceIdentity)) ?? [];
      const mappingConflict = candidate.exercises.some((exercise) => {
        const mapping = mappingByExerciseId.get(exercise.sourceExerciseId);
        return mapping !== undefined && mapping.checksum !== hash({
          sourceExerciseId: mapping.sourceExerciseId,
          sourceName: mapping.sourceName
        });
      });
      if (mappingConflict) {
        findings.push(finding(candidate, "conflict", "exercise_mapping_mismatch", null));
      } else if (duplicateKeys.has(candidate.sourceIdentity.sourceKey)) {
        findings.push(finding(candidate, "conflict", "duplicate_source_identity", null));
      } else if (matches.length === 0) {
        findings.push(finding(candidate, "created", "target_absent", null));
      } else if (matches.length !== 1) {
        findings.push(finding(candidate, "conflict", "duplicate_target_identity", null));
      } else if (matches[0]!.checksum === candidate.checksum) {
        findings.push(finding(candidate, "unchanged", "semantic_match", matches[0]!.id));
      } else {
        findings.push(finding(candidate, "conflict", "target_mismatch", matches[0]!.id));
      }
    }
    const sourceKeys = new Set(candidates.map(({ sourceIdentity }) => identityKey(sourceIdentity)));
    for (const item of sessionTargets) {
      if (!sourceKeys.has(identityKey(item.sourceIdentity))) {
        findings.push({
          outcome: "conflict",
          code: "target_only",
          locator: "postgresql",
          sourceKey: item.sourceIdentity.sourceKey,
          sourceKeyHash: hash(item.sourceIdentity.sourceKey),
          targetSessionId: item.id
        });
      }
    }
    findings.sort((left, right) =>
      left.sourceKey.localeCompare(right.sourceKey) || left.code.localeCompare(right.code)
    );
    const safe = [
      ...invalid.map((record) => ({
        outcome: record.outcome,
        code: record.findingCode,
        locator: record.sourceLocator,
        sourceKeyHash: hash(record.sourceSessionId ?? record.sourceLocator)
      })),
      ...findings.map(({ outcome, code, locator, sourceKeyHash }) => ({
        outcome, code, locator, sourceKeyHash
      }))
    ].sort((left, right) => left.locator.localeCompare(right.locator) || left.code.localeCompare(right.code));
    return {
      safeReport: {
        version: 1,
        mode: "dry_run",
        domain: "training",
        sourceManifestChecksum: snapshot.manifestChecksum,
        counts: count(safe),
        findings: safe
      },
      privateDetail: {
        candidates,
        records: [
          ...invalid,
          ...findings.map((item) => audit(item, candidates))
        ]
      }
    };
  }
}

function normalizeSession(
  snapshot: FitnessTrackerTrainingSnapshot,
  sessionId: string,
  rows: readonly BoundedSheetRow[],
  indexes: Record<string, number>
): { readonly candidate: TrainingImportCandidate } | { readonly record: TrainingImportAuditRecord } {
  const dates = new Set(rows.map((row) => date(row.values[indexes.Date!] ?? null)).filter(Boolean));
  const names = new Set(rows.map((row) => text(row.values[indexes.Workout!] ?? null, 256)).filter(Boolean));
  if (dates.size !== 1 || names.size !== 1) {
    return { record: invalidGroup(rows, snapshot.training.sheetId, sessionId, "inconsistent_session_group") };
  }
  const exercises: TrainingImportExercise[] = [];
  for (const row of rows) {
    const exercise = normalizeExercise(row, indexes);
    if (!exercise) {
      return { record: invalidGroup(rows, snapshot.training.sheetId, sessionId, "invalid_training_row") };
    }
    exercises.push(exercise);
  }
  const localDate = [...dates][0]!;
  const workoutName = [...names][0]!;
  const sourceIdentity = {
    spreadsheetId: snapshot.spreadsheetId,
    sheetId: snapshot.training.sheetId,
    sourceKey: sessionId
  };
  const candidate = {
    locator: groupLocator(rows),
    sourceIdentity,
    checksum: hash({ localDate, workoutName, exercises }),
    localDate,
    workoutName,
    exercises
  };
  return { candidate };
}

function normalizeExercise(
  row: BoundedSheetRow,
  indexes: Record<string, number>
): TrainingImportExercise | null {
  const sourceExerciseId = text(row.values[indexes.Exercise_ID!] ?? null, 512);
  const sourceName = text(row.values[indexes.Exercise!] ?? null, 256);
  const sourceReps = text(row.values[indexes.Reps!] ?? null, 128);
  const setCount = integer(row.values[indexes.Sets!] ?? null, 1, 100);
  const feeling = optionalText(row.values[indexes.Feeling!] ?? null, 256);
  const note = optionalText(row.values[indexes.Notes!] ?? null, 4096);
  const weight = weightValue(row.values[indexes.Weight_kg!] ?? null);
  const rir = optionalNumber(row.values[indexes.RIR!] ?? null, 0, 20);
  const work = sourceReps ? workValue(sourceReps) : null;
  if (
    !sourceExerciseId || !sourceName || !sourceReps || !setCount ||
    feeling === undefined || note === undefined || weight === undefined ||
    rir === undefined || !work
  ) return null;
  const set = { weightKg: weight, ...work, rir };
  return {
    locator: row.locator,
    sourceExerciseId,
    sourceName,
    sourceReps,
    loadBasis: weight === null ? "body_weight" : "external_weight",
    feeling,
    note,
    sets: Array.from({ length: setCount }, () => set)
  };
}

function workValue(value: string): Omit<TrainingImportSet, "weightKg" | "rir"> | null {
  const run = /^(\d+(?:[.,]\d+)?)\s*км\s*\/\s*(\d{1,2}):(\d{2})$/u.exec(value);
  if (run) return {
    reps: null,
    durationSeconds: Number(run[2]) * 60 + Number(run[3]),
    distanceMeters: Number(run[1]!.replace(",", ".")) * 1000
  };
  const timed = /^(\d+)\s*сек(?:\/[^\s]+)?$/u.exec(value);
  if (timed) return { reps: null, durationSeconds: Number(timed[1]), distanceMeters: null };
  const reps = /^(\d+)(?:\/[^\s]+)?$/u.exec(value);
  if (reps) return { reps: Number(reps[1]), durationSeconds: null, distanceMeters: null };
  return null;
}

function columns(headers: readonly string[]): Record<string, number> {
  const required = [
    "Date", "Workout", "Exercise", "Weight_kg", "Sets", "Reps", "RIR",
    "Feeling", "Notes", "Exercise_ID", "Session_ID"
  ];
  return Object.fromEntries(required.map((name) => {
    const index = headers.indexOf(name);
    if (index < 0) throw new Error(`Training header ${name} is missing`);
    return [name, index];
  }));
}

function text(value: SheetCellValue, max: number): string | null {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.length <= max ? normalized : null;
}
function optionalText(value: SheetCellValue, max: number): string | null | undefined {
  if (value === null || String(value).trim() === "") return null;
  return text(value, max) ?? undefined;
}
function decimal(value: SheetCellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
function integer(value: SheetCellValue, min: number, max: number): number | null {
  const parsed = decimal(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
function optionalNumber(value: SheetCellValue, min: number, max: number): number | null | undefined {
  if (value === null || String(value).trim() === "") return null;
  const parsed = decimal(value);
  return parsed !== null && parsed >= min && parsed <= max ? parsed : undefined;
}
function weightValue(value: SheetCellValue): number | null | undefined {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("ru-RU");
  if (!normalized || normalized === "собственный вес") return null;
  const parsed = decimal(value);
  return parsed !== null && parsed >= 0 && parsed <= 100000 ? parsed : undefined;
}
function date(value: SheetCellValue): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.trunc(value) * 86_400_000)
      .toISOString().slice(0, 10);
  }
  const normalized = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return normalized;
  const match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/u.exec(normalized);
  return match ? `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}` : null;
}
function finding(candidate: TrainingImportCandidate, outcome: ImportOutcome, code: string, targetSessionId: string | null): Finding {
  return { outcome, code, locator: candidate.locator, sourceKey: candidate.sourceIdentity.sourceKey, sourceKeyHash: hash(candidate.sourceIdentity.sourceKey), targetSessionId };
}
function audit(item: Finding, candidates: readonly TrainingImportCandidate[]): TrainingImportAuditRecord {
  const candidate = candidates.find(({ sourceIdentity }) => sourceIdentity.sourceKey === item.sourceKey);
  return {
    sourceSheetId: candidate?.sourceIdentity.sheetId ?? null,
    sourceLocator: item.locator,
    sourceSessionId: candidate?.sourceIdentity.sourceKey ?? item.sourceKey,
    sourceLocalDate: candidate?.localDate ?? null,
    sourceChecksum: candidate?.checksum ?? null,
    normalizedWorkoutName: candidate?.workoutName ?? null,
    exercises: candidate?.exercises ?? [],
    outcome: item.outcome,
    findingCode: item.code,
    targetSessionId: item.targetSessionId
  };
}
function invalidRecord(row: BoundedSheetRow, sheetId: number, code: string): TrainingImportAuditRecord {
  return { sourceSheetId: sheetId, sourceLocator: row.locator, sourceSessionId: null, sourceLocalDate: null, sourceChecksum: null, normalizedWorkoutName: null, exercises: [], outcome: "invalid", findingCode: code, targetSessionId: null };
}
function invalidGroup(rows: readonly BoundedSheetRow[], sheetId: number, sessionId: string, code: string): TrainingImportAuditRecord {
  return { ...invalidRecord(rows[0]!, sheetId, code), sourceLocator: groupLocator(rows), sourceSessionId: sessionId };
}
function groupLocator(rows: readonly BoundedSheetRow[]): string {
  return rows.length === 1 ? rows[0]!.locator : `${rows[0]!.locator}+${rows.length - 1}`;
}
function identityKey(value: ImportSourceIdentity): string { return `${value.spreadsheetId}:${value.sheetId}:${value.sourceKey}`; }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function count(findings: readonly SafeImportFinding[]): Record<ImportOutcome, number> {
  const counts = { created: 0, unchanged: 0, conflict: 0, invalid: 0 };
  for (const item of findings) counts[item.outcome] += 1;
  return counts;
}
