/** One authoritative Weight row prepared for migration reconciliation. */
export interface AuthoritativeWeightRow {
  readonly sourceRecordId: string;
  readonly localDate: string;
  readonly weightKg: number;
}

/** One Daily_Log mirror row prepared for migration reconciliation. */
export interface DailyWeightMirrorRow {
  readonly sourceRecordId: string;
  readonly localDate: string;
  readonly weightKg: number | null;
}

/** Explicit non-authoritative finding produced before weight import. */
export interface WeightReconciliationFinding {
  readonly localDate: string;
  readonly kind:
    | "duplicate_authority"
    | "missing_mirror"
    | "orphan_mirror"
    | "value_mismatch";
  readonly authoritativeRecordIds: readonly string[];
  readonly mirrorRecordIds: readonly string[];
}

/** Deterministic reconciliation output; it never creates domain facts. */
export interface WeightReconciliationResult {
  readonly readyForAutomaticImport: boolean;
  readonly matchedDates: readonly string[];
  readonly findings: readonly WeightReconciliationFinding[];
}

/**
 * Compares authoritative Weight rows with the Daily_Log legacy mirror.
 *
 * `Weight` remains the only import authority. Any duplicate, missing, orphan
 * or mismatching mirror value becomes an explicit finding instead of a second
 * WeightMeasurement or a last-write-wins choice.
 *
 * @param authoritativeRows - Rows from the authoritative Weight sheet.
 * @param mirrorRows - Rows from Daily_Log.Weight.
 * @returns Stable reconciliation result ordered by local date.
 */
export function reconcileWeightMirror(
  authoritativeRows: readonly AuthoritativeWeightRow[],
  mirrorRows: readonly DailyWeightMirrorRow[]
): WeightReconciliationResult {
  const authority = groupByDate(authoritativeRows);
  const mirrors = groupByDate(
    mirrorRows.filter(
      (row): row is DailyWeightMirrorRow & { weightKg: number } =>
        row.weightKg !== null
    )
  );
  const dates = [...new Set([...authority.keys(), ...mirrors.keys()])].sort();
  const findings: WeightReconciliationFinding[] = [];
  const matchedDates: string[] = [];

  for (const localDate of dates) {
    const authoritative = authority.get(localDate) ?? [];
    const mirror = mirrors.get(localDate) ?? [];
    const base = {
      localDate,
      authoritativeRecordIds: authoritative.map(
        (row) => row.sourceRecordId
      ),
      mirrorRecordIds: mirror.map((row) => row.sourceRecordId)
    };
    if (authoritative.length > 1) {
      findings.push({ ...base, kind: "duplicate_authority" });
      continue;
    }
    if (authoritative.length === 0) {
      findings.push({ ...base, kind: "orphan_mirror" });
      continue;
    }
    if (mirror.length === 0) {
      findings.push({ ...base, kind: "missing_mirror" });
      continue;
    }
    if (
      mirror.length !== 1 ||
      mirror[0]!.weightKg !== authoritative[0]!.weightKg
    ) {
      findings.push({ ...base, kind: "value_mismatch" });
      continue;
    }
    matchedDates.push(localDate);
  }

  return {
    readyForAutomaticImport: findings.length === 0,
    matchedDates,
    findings
  };
}

function groupByDate<
  Row extends { readonly localDate: string }
>(rows: readonly Row[]): Map<string, Row[]> {
  const result = new Map<string, Row[]>();
  for (const row of rows) {
    const group = result.get(row.localDate) ?? [];
    group.push(row);
    result.set(row.localDate, group);
  }
  return result;
}
