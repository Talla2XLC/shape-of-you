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
  BoundedSheetSnapshot,
  FitnessTrackerNutritionSnapshot,
  SheetCellValue
} from "./fitness-tracker-sheets-reader.js";

/** Nutrition source entity categories reconciled as one domain. */
export type NutritionImportRecordKind =
  | "brand"
  | "ingredient"
  | "food"
  | "composition"
  | "meal"
  | "day_closure";

/** Comparable current Nutrition record returned by the target reader. */
export interface NutritionImportTarget {
  readonly id: string;
  readonly kind: NutritionImportRecordKind;
  readonly sourceIdentity: ImportSourceIdentity;
  readonly checksum: string | null;
  readonly semanticChecksum?: string | null;
}

interface Nutrients {
  readonly caloriesKcal: number;
  readonly proteinG: number;
  readonly fatG: number;
  readonly carbsG: number;
}

interface PartialNutrients {
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly fatG: number | null;
  readonly carbsG: number | null;
}

interface CandidateBase {
  readonly kind: NutritionImportRecordKind;
  readonly locator: string;
  readonly sourceIdentity: ImportSourceIdentity;
  readonly checksum: string;
}

/** Normalized Brand row eligible for deterministic reconciliation. */
export interface NutritionBrandCandidate extends CandidateBase {
  readonly kind: "brand";
  readonly name: string;
  readonly type: string | null;
  readonly note: string | null;
}

/** Normalized Ingredient row with a complete per-100-gram nutrient reference. */
export interface NutritionIngredientCandidate extends CandidateBase {
  readonly kind: "ingredient";
  readonly name: string;
  readonly category: string | null;
  readonly referenceQuantity: 100;
  readonly referenceUnit: "g";
  readonly nutrients: Nutrients;
}

/** Normalized private Food row and its optional exact Brand dependency. */
export interface NutritionFoodCandidate extends CandidateBase {
  readonly kind: "food";
  readonly name: string;
  readonly type: string | null;
  readonly category: string | null;
  readonly sourceDefaultPortion: string;
  readonly referenceQuantity: 1;
  readonly referenceUnit: "serving";
  readonly nutrients: Nutrients;
  readonly brandSourceKey: string | null;
}

/** Normalized Food-to-Ingredient composition row with exact source dependencies. */
export interface NutritionCompositionCandidate extends CandidateBase {
  readonly kind: "composition";
  readonly foodSourceKey: string;
  readonly ingredientSourceKey: string;
  readonly quantity: number;
  readonly unit: "g" | "ml" | "serving" | "piece";
  readonly preparation: string | null;
  readonly required: boolean;
  readonly note: string | null;
  readonly confidence: number | null;
}

/** Normalized date-only Meal row represented as one immutable serving snapshot. */
export interface NutritionMealCandidate extends CandidateBase {
  readonly kind: "meal";
  readonly localDate: string;
  readonly temporalPrecision: "local_date";
  readonly mealKind: "breakfast" | "lunch" | "dinner" | "snack" | "other";
  readonly sourceMealKind: string;
  readonly label: string;
  readonly description: string | null;
  readonly note: string | null;
  readonly nutrients: PartialNutrients;
  readonly foodSourceKey: string | null;
  readonly sourcePhotoReference: string | null;
  readonly confidence: number | null;
}

/** Source-authoritative closed-day decision imported after same-run facts. */
export interface NutritionDayClosureCandidate extends CandidateBase {
  readonly kind: "day_closure";
  readonly localDate: string;
  readonly sourceStatus: "Closed";
}

/** Valid normalized Nutrition candidates accepted by dry-run and apply. */
export type NutritionImportCandidate =
  | NutritionBrandCandidate
  | NutritionIngredientCandidate
  | NutritionFoodCandidate
  | NutritionCompositionCandidate
  | NutritionMealCandidate
  | NutritionDayClosureCandidate;

type NutritionImportEvidence =
  | {
      readonly kind: "ingredient";
      readonly name: string | null;
      readonly category: string | null;
      readonly sourceDefaultUnit: string | null;
      readonly nutrients: PartialNutrients;
    }
  | {
      readonly kind: "food";
      readonly name: string | null;
      readonly type: string | null;
      readonly category: string | null;
      readonly sourceDefaultPortion: string | null;
      readonly nutrients: PartialNutrients;
      readonly brandSourceKey: string | null;
    }
  | {
      readonly kind: "composition";
      readonly foodSourceKey: string | null;
      readonly ingredientSourceKey: string | null;
      readonly sourceQuantity: string | null;
      readonly sourceUnit: string | null;
      readonly preparation: string | null;
      readonly required: boolean | null;
      readonly note: string | null;
      readonly confidence: number | null;
    }
  | {
      readonly kind: "meal";
      readonly localDate: string | null;
      readonly mealKind: "breakfast" | "lunch" | "dinner" | "snack" | "other" | null;
      readonly sourceMealKind: string | null;
      readonly label: string | null;
      readonly description: string | null;
      readonly note: string | null;
      readonly nutrients: PartialNutrients;
      readonly foodSourceKey: string | null;
      readonly sourcePhotoReference: string | null;
      readonly confidence: number | null;
    };

/** Typed relational evidence for one Nutrition reconciliation result. */
export interface NutritionImportAuditRecord {
  readonly kind: NutritionImportRecordKind;
  readonly sourceSheetId: number | null;
  readonly sourceLocator: string;
  readonly sourceRecordId: string | null;
  readonly sourceChecksum: string | null;
  readonly outcome: ImportOutcome;
  readonly findingCode: string;
  readonly targetId: string | null;
  readonly candidate: NutritionImportCandidate | null;
  readonly evidence: NutritionImportEvidence | null;
}

/** Private Nutrition result written only to protected files or relational audit. */
export interface NutritionDryRunPrivateDetail {
  readonly candidates: readonly NutritionImportCandidate[];
  readonly targetRecordIds: readonly string[];
  readonly records: readonly NutritionImportAuditRecord[];
}

interface Finding extends SafeImportFinding {
  readonly kind: NutritionImportRecordKind;
  readonly sourceKeySort: string;
  readonly targetId?: string;
  readonly candidate?: NutritionImportCandidate;
}

interface InvalidRow {
  readonly finding: Finding;
  readonly record: NutritionImportAuditRecord;
}

/** Deterministic Nutrition-and-closure classifier used by dry-run and apply. */
export class NutritionDryRunAdapter implements DryRunImportAdapter<
  FitnessTrackerNutritionSnapshot,
  NutritionImportTarget,
  NutritionDryRunPrivateDetail
> {
  /** Classifies the complete linked Nutrition snapshot without exposing values. */
  public classify(
    snapshot: FitnessTrackerNutritionSnapshot,
    target: readonly NutritionImportTarget[]
  ): DryRunAdapterResult<NutritionDryRunPrivateDetail> {
    const normalized = normalizeSnapshot(snapshot);
    const findings: Finding[] = [...normalized.invalid.map(({ finding }) => finding)];
    const candidates = normalized.candidates;
    const duplicateKeys = duplicateIdentityKeys(candidates);
    const candidateByKey = new Map(
      candidates.map((candidate) => [identityKey(candidate.sourceIdentity), candidate])
    );
    const sheetIds: Readonly<Record<NutritionImportRecordKind, number>> = {
      brand: snapshot.brands.sheetId,
      ingredient: snapshot.ingredients.sheetId,
      food: snapshot.foods.sheetId,
      composition: snapshot.foodIngredients.sheetId,
      meal: snapshot.meals.sheetId,
      day_closure: snapshot.dailyLog.sheetId
    };
    const invalidIdentityKeys = new Set(normalized.invalid.flatMap(({ record }) =>
      record.sourceSheetId === null || record.sourceRecordId === null
        ? []
        : [identityKey({
            spreadsheetId: snapshot.spreadsheetId,
            sheetId: record.sourceSheetId,
            sourceKey: record.sourceRecordId
          })]
    ));
    const targetByKey = new Map<string, NutritionImportTarget[]>();
    const targetByStableKey = new Map<string, NutritionImportTarget[]>();
    for (const row of target) {
      const key = identityKey(row.sourceIdentity);
      targetByKey.set(key, [...(targetByKey.get(key) ?? []), row]);
      const stableKey = stableIdentityKey(row.kind, row.sourceIdentity);
      targetByStableKey.set(
        stableKey,
        [...(targetByStableKey.get(stableKey) ?? []), row]
      );
    }
    const claimedTargetIds = new Set<string>();

    for (const candidate of candidates) {
      const key = identityKey(candidate.sourceIdentity);
      const blocker = dependencyBlocker(
        candidate,
        candidateByKey,
        invalidIdentityKeys,
        sheetIds
      );
      if (duplicateKeys.has(key)) {
        findings.push(finding(candidate, "conflict", "duplicate_source_identity"));
        continue;
      }
      if (blocker) {
        findings.push(finding(candidate, blocker.outcome, blocker.code));
        continue;
      }
      const matches = targetByKey.get(key) ?? [];
      if (matches.length === 0) {
        const drifted = targetByStableKey.get(
          stableIdentityKey(candidate.kind, candidate.sourceIdentity)
        ) ?? [];
        for (const row of drifted) claimedTargetIds.add(row.id);
        if (drifted.length === 0) {
          findings.push(finding(candidate, "created", "target_absent"));
        } else if (drifted.length === 1) {
          findings.push(finding(
            candidate,
            "conflict",
            "source_identity_mismatch",
            drifted[0]!.id
          ));
        } else {
          findings.push(finding(candidate, "conflict", "duplicate_target_identity"));
        }
      } else if (matches.length !== 1) {
        findings.push(finding(candidate, "conflict", "duplicate_target_identity"));
      } else if (matches[0]!.checksum === candidate.checksum ||
        hasSemanticMatch(matches[0]!, candidate)) {
        findings.push(finding(
          candidate,
          "unchanged",
          "semantic_match",
          matches[0]!.id
        ));
      } else {
        findings.push(finding(
          candidate,
          "conflict",
          "target_mismatch",
          matches[0]!.id
        ));
      }
    }

    const sourceKeys = new Set([
      ...candidates.map(({ sourceIdentity }) => identityKey(sourceIdentity)),
      ...invalidIdentityKeys
    ]);
    for (const row of target) {
      if (!sourceKeys.has(identityKey(row.sourceIdentity)) &&
          !claimedTargetIds.has(row.id)) {
        findings.push({
          kind: row.kind,
          outcome: "conflict",
          code: "target_only",
          locator: "postgresql",
          sourceKeyHash: digest(row.sourceIdentity.sourceKey),
          sourceKeySort: row.sourceIdentity.sourceKey,
          targetId: row.id
        });
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
        domain: "nutrition",
        sourceManifestChecksum: snapshot.manifestChecksum,
        counts: countOutcomes(safeFindings),
        findings: safeFindings
      },
      privateDetail: {
        candidates: [...candidates].sort(compareCandidates),
        targetRecordIds: target.map(({ id }) => id).sort(),
        records: [
          ...normalized.invalid.map(({ record }) => record),
          ...findings
            .filter((item) => item.outcome !== "invalid" || item.candidate !== undefined)
            .map((item) => ({
              kind: item.kind,
              sourceSheetId: item.candidate?.sourceIdentity.sheetId ?? null,
              sourceLocator: item.locator,
              sourceRecordId: item.candidate?.sourceIdentity.sourceKey ?? item.sourceKeySort,
              sourceChecksum: item.candidate?.checksum ?? null,
              outcome: item.outcome,
              findingCode: item.code,
              targetId: item.targetId ?? null,
              candidate: item.candidate ?? null,
              evidence: null
            }))
        ]
      }
    };
  }
}

/** Stable semantic checksum for a normalized Brand representation. */
export function nutritionBrandSemanticChecksum(input: {
  readonly name: string;
  readonly type: string | null;
  readonly note: string | null;
}): string {
  return digest({ kind: "brand", ...input });
}

/** Stable semantic checksum for the relational fields of an imported Meal. */
export function nutritionMealSemanticChecksum(input: {
  readonly localDate: string;
  readonly mealKind: NutritionMealCandidate["mealKind"];
  readonly label: string;
  readonly description: string | null;
  readonly note: string | null;
  readonly nutrients: PartialNutrients;
  readonly confidence: number | null;
}): string {
  return digest({ kind: "meal", ...input });
}

/** Stable semantic checksum for a source-authoritative closed local day. */
export function nutritionDayClosureSemanticChecksum(localDate: string): string {
  return digest({ kind: "day_closure", localDate, sourceStatus: "Closed" });
}

function candidateSemanticChecksum(
  candidate: NutritionImportCandidate
): string | null {
  if (candidate.kind === "brand") {
    return nutritionBrandSemanticChecksum(candidate);
  }
  if (candidate.kind === "meal") {
    return nutritionMealSemanticChecksum(candidate);
  }
  if (candidate.kind === "day_closure") {
    return nutritionDayClosureSemanticChecksum(candidate.localDate);
  }
  return null;
}

function hasSemanticMatch(
  target: NutritionImportTarget,
  candidate: NutritionImportCandidate
): boolean {
  const candidateChecksum = candidateSemanticChecksum(candidate);
  return candidateChecksum !== null && target.semanticChecksum != null &&
    target.semanticChecksum === candidateChecksum;
}

function normalizeSnapshot(snapshot: FitnessTrackerNutritionSnapshot): {
  readonly candidates: NutritionImportCandidate[];
  readonly invalid: InvalidRow[];
} {
  const candidates: NutritionImportCandidate[] = [];
  const invalid: InvalidRow[] = [];
  normalizeSheet(snapshot.brands, (row, columns) => normalizeBrand(row, columns, snapshot), candidates, invalid);
  normalizeSheet(snapshot.ingredients, (row, columns) => normalizeIngredient(row, columns, snapshot), candidates, invalid);
  normalizeSheet(snapshot.foods, (row, columns) => normalizeFood(row, columns, snapshot), candidates, invalid);
  normalizeSheet(snapshot.foodIngredients, (row, columns) => normalizeComposition(row, columns, snapshot), candidates, invalid);
  normalizeSheet(snapshot.meals, (row, columns) => normalizeMeal(row, columns, snapshot), candidates, invalid);
  normalizeClosedDays(snapshot.dailyLog, candidates, invalid);
  return { candidates, invalid };
}

function normalizeClosedDays(
  sheet: BoundedSheetSnapshot,
  candidates: NutritionImportCandidate[],
  invalid: InvalidRow[]
): void {
  const columns = Object.fromEntries(sheet.headers.map((header, index) => [header, index]));
  for (const row of sheet.rows) {
    const status = optionalText(row, columns, "DayStatus", 64);
    if (status !== "Closed") continue;
    const localDate = dateValue(value(row, columns, "Date"));
    if (!localDate) {
      invalid.push(invalidRow("day_closure", row, sheet.sheetId, null, "invalid_closed_day_row"));
      continue;
    }
    candidates.push(candidateBase("day_closure", row, sheet.sheetId, localDate, {
      localDate,
      sourceStatus: "Closed" as const
    }));
  }
}

function normalizeSheet(
  sheet: BoundedSheetSnapshot,
  normalize: (
    row: BoundedSheetRow,
    columns: Readonly<Record<string, number>>
  ) => NutritionImportCandidate | InvalidRow,
  candidates: NutritionImportCandidate[],
  invalid: InvalidRow[]
): void {
  const columns = Object.fromEntries(sheet.headers.map((header, index) => [header, index]));
  for (const row of sheet.rows) {
    const result = normalize(row, columns);
    if ("finding" in result) invalid.push(result);
    else candidates.push(result);
  }
}

function normalizeBrand(
  row: BoundedSheetRow,
  columns: Readonly<Record<string, number>>,
  snapshot: FitnessTrackerNutritionSnapshot
): NutritionBrandCandidate | InvalidRow {
  const id = text(row, columns, "Brand_ID", 512);
  const name = text(row, columns, "Name", 256);
  const type = optionalText(row, columns, "Type", 256);
  const note = optionalText(row, columns, "Notes", 4096);
  if (!id || !name || type === undefined || note === undefined) {
    return invalidRow("brand", row, snapshot.brands.sheetId, id, "invalid_brand_row");
  }
  return candidateBase("brand", row, snapshot.brands.sheetId, id, { name, type, note });
}

function normalizeIngredient(
  row: BoundedSheetRow,
  columns: Readonly<Record<string, number>>,
  snapshot: FitnessTrackerNutritionSnapshot
): NutritionIngredientCandidate | InvalidRow {
  const id = text(row, columns, "Ingredient_ID", 512);
  const name = text(row, columns, "Name", 256);
  const category = optionalText(row, columns, "Category", 256);
  const unit = optionalText(row, columns, "Default_unit", 64);
  const nutrients = nutrientColumns(row, columns, [
    "Calories_per_100g", "Protein_per_100g", "Fat_per_100g", "Carbs_per_100g"
  ]);
  if (!id || !name || category === undefined || !unit || !isGram(unit) || !nutrients) {
    return invalidRow("ingredient", row, snapshot.ingredients.sheetId, id, "invalid_ingredient_row", {
      kind: "ingredient",
      name,
      category: category ?? null,
      sourceDefaultUnit: unit ?? null,
      nutrients: partialNutrientColumns(row, columns, [
        "Calories_per_100g", "Protein_per_100g", "Fat_per_100g", "Carbs_per_100g"
      ]) ?? emptyPartialNutrients()
    });
  }
  return candidateBase("ingredient", row, snapshot.ingredients.sheetId, id, {
    name,
    category,
    referenceQuantity: 100 as const,
    referenceUnit: "g" as const,
    nutrients
  });
}

function normalizeFood(
  row: BoundedSheetRow,
  columns: Readonly<Record<string, number>>,
  snapshot: FitnessTrackerNutritionSnapshot
): NutritionFoodCandidate | InvalidRow {
  const id = text(row, columns, "Food_ID", 512);
  const name = text(row, columns, "Name", 256);
  const type = optionalText(row, columns, "Type", 256);
  const category = optionalText(row, columns, "Category", 256);
  const sourceDefaultPortion = optionalText(row, columns, "Default_portion", 256);
  const nutrients = nutrientColumns(row, columns, ["Calories", "Protein", "Fat", "Carbs"]);
  const brandSourceKey = optionalText(row, columns, "Brand_ID", 512);
  if (!id || !name || type === undefined || category === undefined ||
      !sourceDefaultPortion ||
      !nutrients || brandSourceKey === undefined) {
    return invalidRow("food", row, snapshot.foods.sheetId, id, "invalid_food_row", {
      kind: "food",
      name,
      type: type ?? null,
      category: category ?? null,
      sourceDefaultPortion: evidenceText(value(row, columns, "Default_portion")),
      nutrients: partialNutrientColumns(row, columns, ["Calories", "Protein", "Fat", "Carbs"])
        ?? emptyPartialNutrients(),
      brandSourceKey: brandSourceKey ?? null
    });
  }
  return candidateBase("food", row, snapshot.foods.sheetId, id, {
    name,
    type,
    category,
    sourceDefaultPortion,
    referenceQuantity: 1 as const,
    referenceUnit: "serving" as const,
    nutrients,
    brandSourceKey
  });
}

function normalizeComposition(
  row: BoundedSheetRow,
  columns: Readonly<Record<string, number>>,
  snapshot: FitnessTrackerNutritionSnapshot
): NutritionCompositionCandidate | InvalidRow {
  const foodSourceKey = text(row, columns, "Food_ID", 512);
  const ingredientSourceKey = text(row, columns, "Ingredient_ID", 512);
  const quantity = positiveNumber(value(row, columns, "Quantity"));
  const unit = nutritionUnit(optionalText(row, columns, "Unit", 64));
  const preparation = optionalText(row, columns, "Preparation", 256);
  const note = optionalText(row, columns, "Notes", 4096);
  const required = booleanValue(value(row, columns, "Required"));
  const confidence = confidenceValue(value(row, columns, "Confidence"));
  const sourceKey = foodSourceKey && ingredientSourceKey
    ? `${foodSourceKey}:${ingredientSourceKey}`
    : null;
  if (!foodSourceKey || !ingredientSourceKey || !quantity || !unit ||
      preparation === undefined || note === undefined || required === null ||
      confidence === undefined) {
    return invalidRow("composition", row, snapshot.foodIngredients.sheetId, sourceKey, "invalid_composition_row", {
      kind: "composition",
      foodSourceKey,
      ingredientSourceKey,
      sourceQuantity: evidenceText(value(row, columns, "Quantity")),
      sourceUnit: optionalText(row, columns, "Unit", 64) ?? null,
      preparation: preparation ?? null,
      required,
      note: note ?? null,
      confidence: confidence ?? null
    });
  }
  return candidateBase(
    "composition",
    row,
    snapshot.foodIngredients.sheetId,
    `${foodSourceKey}:${ingredientSourceKey}`,
    {
    foodSourceKey,
    ingredientSourceKey,
    quantity,
    unit,
    preparation,
    required,
    note,
    confidence
    }
  );
}

function normalizeMeal(
  row: BoundedSheetRow,
  columns: Readonly<Record<string, number>>,
  snapshot: FitnessTrackerNutritionSnapshot
): NutritionMealCandidate | InvalidRow {
  const id = text(row, columns, "Meal_ID", 512);
  const localDate = dateValue(value(row, columns, "Date"));
  const sourceMealKind = optionalText(row, columns, "Meal", 128);
  const mealKind = mealKindValue(sourceMealKind);
  const label = text(row, columns, "Description", 256);
  const description = optionalText(row, columns, "Description", 4096);
  const note = optionalText(row, columns, "Notes", 4096);
  const nutrients = partialNutrientColumns(row, columns, ["Calories", "Protein", "Fat", "Carbs"]);
  const photo = optionalText(row, columns, "Photo", 4096);
  const foodSourceKey = optionalText(row, columns, "Food_ID", 512);
  const confidence = confidenceValue(value(row, columns, "Confidence"));
  if (!id || !uuid(id) || !localDate || !mealKind || !label ||
      description === undefined || note === undefined || nutrients === undefined ||
      photo === undefined || foodSourceKey === undefined || confidence === undefined) {
    return invalidRow("meal", row, snapshot.meals.sheetId, id, "invalid_meal_row", {
      kind: "meal",
      localDate,
      mealKind,
      sourceMealKind: sourceMealKind ?? null,
      label,
      description: description ?? null,
      note: note ?? null,
      nutrients: nutrients ?? emptyPartialNutrients(),
      foodSourceKey: foodSourceKey ?? null,
      sourcePhotoReference: photo ?? null,
      confidence: confidence ?? null
    });
  }
  return candidateBase("meal", row, snapshot.meals.sheetId, id, {
    localDate,
    temporalPrecision: "local_date" as const,
    mealKind,
    sourceMealKind: sourceMealKind!,
    label,
    description,
    note,
    nutrients,
    foodSourceKey,
    sourcePhotoReference: photo,
    confidence
  });
}

function dependencyBlocker(
  candidate: NutritionImportCandidate,
  candidates: ReadonlyMap<string, NutritionImportCandidate>,
  invalidKeys: ReadonlySet<string>,
  sheetIds: Readonly<Record<NutritionImportRecordKind, number>>
): { readonly outcome: "conflict" | "invalid"; readonly code: string } | null {
  const dependencyKey = (kind: NutritionImportRecordKind, key: string) =>
    identityKey({
      spreadsheetId: candidate.sourceIdentity.spreadsheetId,
      sheetId: sheetIds[kind],
      sourceKey: key
    });
  const find = (kind: NutritionImportRecordKind, key: string) =>
    candidates.get(dependencyKey(kind, key));
  if (candidate.kind === "food" && candidate.brandSourceKey) {
    if (invalidKeys.has(dependencyKey("brand", candidate.brandSourceKey))) {
      return { outcome: "invalid", code: "invalid_catalog_dependency" };
    }
    if (!find("brand", candidate.brandSourceKey)) {
      return { outcome: "conflict", code: "unresolved_brand_reference" };
    }
  }
  if (candidate.kind === "composition") {
    if (invalidKeys.has(dependencyKey("food", candidate.foodSourceKey))) {
      return { outcome: "invalid", code: "invalid_catalog_dependency" };
    }
    if (!find("food", candidate.foodSourceKey)) {
      return { outcome: "conflict", code: "unresolved_food_reference" };
    }
    if (invalidKeys.has(dependencyKey("ingredient", candidate.ingredientSourceKey))) {
      return { outcome: "invalid", code: "invalid_catalog_dependency" };
    }
    if (!find("ingredient", candidate.ingredientSourceKey)) {
      return { outcome: "conflict", code: "unresolved_ingredient_reference" };
    }
  }
  return null;
}

function candidateBase<K extends NutritionImportRecordKind, T extends object>(
  kind: K,
  row: BoundedSheetRow,
  sheetId: number,
  sourceKey: string,
  fields: T
): CandidateBase & { readonly kind: K } & T {
  return {
    kind,
    locator: row.locator,
    sourceIdentity: {
      spreadsheetId: "1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik",
      sheetId,
      sourceKey
    },
    checksum: digest(row.values),
    ...fields
  };
}

function invalidRow(
  kind: NutritionImportRecordKind,
  row: BoundedSheetRow,
  sheetId: number,
  sourceKey: string | null,
  code: string,
  evidence: NutritionImportEvidence | null = null
): InvalidRow {
  const safeKey = sourceKey ?? row.locator;
  return {
    finding: {
      kind,
      outcome: "invalid",
      code,
      locator: row.locator,
      sourceKeyHash: digest(safeKey),
      sourceKeySort: safeKey
    },
    record: {
      kind,
      sourceSheetId: sheetId,
      sourceLocator: row.locator,
      sourceRecordId: sourceKey,
      sourceChecksum: digest(row.values),
      outcome: "invalid",
      findingCode: code,
      targetId: null,
      candidate: null,
      evidence
    }
  };
}

function finding(
  candidate: NutritionImportCandidate,
  outcome: ImportOutcome,
  code: string,
  targetId?: string
): Finding {
  return {
    kind: candidate.kind,
    outcome,
    code,
    locator: candidate.locator,
    sourceKeyHash: digest(candidate.sourceIdentity.sourceKey),
    sourceKeySort: candidate.sourceIdentity.sourceKey,
    ...(targetId === undefined ? {} : { targetId }),
    candidate
  };
}

function duplicateIdentityKeys(candidates: readonly NutritionImportCandidate[]): Set<string> {
  const keys = candidates.map(({ sourceIdentity }) => identityKey(sourceIdentity));
  return new Set(keys.filter((key, index) => keys.indexOf(key) !== index));
}

function identityKey(identity: ImportSourceIdentity): string {
  return `${identity.spreadsheetId}:${identity.sheetId}:${identity.sourceKey}`;
}

function stableIdentityKey(
  kind: NutritionImportRecordKind,
  identity: ImportSourceIdentity
): string {
  return `${kind}:${identity.spreadsheetId}:${identity.sourceKey}`;
}

function compareCandidates(left: NutritionImportCandidate, right: NutritionImportCandidate): number {
  return left.kind.localeCompare(right.kind) ||
    left.sourceIdentity.sourceKey.localeCompare(right.sourceIdentity.sourceKey);
}

function compareFindings(left: Finding, right: Finding): number {
  return left.kind.localeCompare(right.kind) ||
    left.sourceKeySort.localeCompare(right.sourceKeySort) ||
    left.code.localeCompare(right.code) || left.locator.localeCompare(right.locator);
}

function countOutcomes(findings: readonly SafeImportFinding[]) {
  const counts = { created: 0, unchanged: 0, conflict: 0, invalid: 0 };
  for (const finding of findings) counts[finding.outcome]++;
  return counts;
}

function value(
  row: BoundedSheetRow,
  columns: Readonly<Record<string, number>>,
  header: string
): SheetCellValue {
  return row.values[columns[header]!] ?? null;
}

function text(
  row: BoundedSheetRow,
  columns: Readonly<Record<string, number>>,
  header: string,
  max: number
): string | null {
  const normalized = optionalText(row, columns, header, max);
  return normalized === undefined ? null : normalized;
}

function optionalText(
  row: BoundedSheetRow,
  columns: Readonly<Record<string, number>>,
  header: string,
  max: number
): string | null | undefined {
  const raw = value(row, columns, header);
  if (raw === null || raw === "") return null;
  const normalized = String(raw).trim();
  if (!normalized) return null;
  return normalized.length <= max ? normalized : undefined;
}

function positiveNumber(raw: SheetCellValue): number | null {
  const number = numeric(raw);
  return number !== null && number > 0 && number <= 100_000 ? number : null;
}

function numeric(raw: SheetCellValue): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const number = Number(raw.trim().replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function nutrientColumns(
  row: BoundedSheetRow,
  columns: Readonly<Record<string, number>>,
  headers: readonly [string, string, string, string]
): Nutrients | null {
  const values = headers.map((header) => numeric(value(row, columns, header)));
  if (values.some((item) => item === null || item < 0)) return null;
  return {
    caloriesKcal: values[0]!,
    proteinG: values[1]!,
    fatG: values[2]!,
    carbsG: values[3]!
  };
}

function partialNutrientColumns(
  row: BoundedSheetRow,
  columns: Readonly<Record<string, number>>,
  headers: readonly [string, string, string, string]
): PartialNutrients | undefined {
  const values = headers.map((header) => {
    const raw = value(row, columns, header);
    if (raw === null || raw === "") return null;
    return numeric(raw) ?? undefined;
  });
  if (values.some((item) => item === undefined || (item !== null && item < 0))) {
    return undefined;
  }
  return {
    caloriesKcal: values[0]!,
    proteinG: values[1]!,
    fatG: values[2]!,
    carbsG: values[3]!
  };
}

function emptyPartialNutrients(): PartialNutrients {
  return { caloriesKcal: null, proteinG: null, fatG: null, carbsG: null };
}

function evidenceText(value: SheetCellValue): string | null {
  if (value === null || value === "") return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 256) : null;
}

function isGram(value: string): boolean {
  return ["g", "г", "gram", "grams"].includes(value.trim().toLowerCase());
}

function nutritionUnit(value: string | null | undefined):
  "g" | "ml" | "serving" | "piece" | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["g", "г"].includes(normalized)) return "g";
  if (["ml", "мл"].includes(normalized)) return "ml";
  if (["serving", "порция"].includes(normalized)) return "serving";
  if (["piece", "шт", "шт."].includes(normalized)) return "piece";
  return null;
}

function booleanValue(value: SheetCellValue): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "да", "1"].includes(normalized)) return true;
  if (["false", "no", "нет", "0"].includes(normalized)) return false;
  return null;
}

function confidenceValue(value: SheetCellValue): number | null | undefined {
  if (value === null || value === "") return null;
  const number = numeric(value);
  if (number !== null) return number >= 0 && number <= 1 ? number : undefined;
  const normalized = String(value).trim().toLowerCase();
  const values: Readonly<Record<string, number>> = {
    high: 0.9,
    "высокая": 0.9,
    medium: 0.6,
    "средняя": 0.6,
    low: 0.3,
    "низкая": 0.3
  };
  return values[normalized];
}

function mealKindValue(value: string | null | undefined):
  "breakfast" | "lunch" | "dinner" | "snack" | "other" | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "breakfast") return "breakfast";
  if (normalized === "lunch") return "lunch";
  if (normalized === "dinner") return "dinner";
  if (normalized === "snack") return "snack";
  if (["all day", "evening drink", "evening drinks", "lunch add-on", "lunch-dinner"].includes(normalized)) return "other";
  return null;
}

function dateValue(value: SheetCellValue): string | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return date.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(value.trim());
  if (!match) return null;
  const result = `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(`${result}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === result ? result : null;
}

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
