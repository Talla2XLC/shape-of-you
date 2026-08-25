import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";

import type { ImportSourceReader } from "./contracts.js";
import {
  computeFitnessTrackerManifestChecksum,
  FITNESS_TRACKER_SPREADSHEET_ID,
  type BoundedSheetRow,
  type BoundedSheetSnapshot,
  type FitnessTrackerSourceSnapshot,
  type FitnessTrackerWeightSnapshot,
  type SheetCellValue
} from "./fitness-tracker-sheets-reader.js";

/** Current private snapshot envelope emitted by connector orchestration. */
export const FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION = 3;
const legacySnapshotSchemaVersion = 1;

const maxSnapshotBytes = 16 * 1024 * 1024;
const workbookTitle = "Fitness Tracker";

interface FitnessTrackerSnapshotCaptureBase {
  readonly schemaVersion: typeof FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION;
  readonly spreadsheetId: typeof FITNESS_TRACKER_SPREADSHEET_ID;
  readonly workbookTitle: typeof workbookTitle;
  readonly locale: "ru_RU";
  readonly timeZone: "Europe/Moscow";
}

/** Connector-owned Weight capture before the canonical checksum is attached. */
export interface FitnessTrackerWeightSnapshotCapture
  extends FitnessTrackerSnapshotCaptureBase {
  readonly weight: BoundedSheetSnapshot;
  readonly dailyLog: BoundedSheetSnapshot;
}

/** Connector-owned Body capture before the canonical checksum is attached. */
export interface FitnessTrackerBodySnapshotCapture
  extends FitnessTrackerSnapshotCaptureBase {
  readonly body: BoundedSheetSnapshot;
}

/** Connector-owned Nutrition capture before the canonical checksum is attached. */
export interface FitnessTrackerNutritionSnapshotCapture
  extends FitnessTrackerSnapshotCaptureBase {
  readonly brands: BoundedSheetSnapshot;
  readonly ingredients: BoundedSheetSnapshot;
  readonly foods: BoundedSheetSnapshot;
  readonly foodIngredients: BoundedSheetSnapshot;
  readonly meals: BoundedSheetSnapshot;
  readonly dailyLog: BoundedSheetSnapshot;
}

/** Exactly one typed domain subset captured from the authoritative workbook. */
export type FitnessTrackerSnapshotCapture =
  | FitnessTrackerWeightSnapshotCapture
  | FitnessTrackerBodySnapshotCapture
  | FitnessTrackerNutritionSnapshotCapture;

type FitnessTrackerSnapshotFile = FitnessTrackerSnapshotCapture & {
  readonly manifestChecksum: string;
};

/** Reads a bounded private snapshot without following symlinks or permissive files. */
export class PrivateFitnessTrackerSnapshotReader
  implements ImportSourceReader<FitnessTrackerSourceSnapshot>
{
  public constructor(private readonly path: string) {}

  /** Validates file safety, schema, source metadata, bounds, and checksum. */
  public async readSnapshot(): Promise<FitnessTrackerSourceSnapshot> {
    const handle = await open(
      this.path,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      const file = await handle.stat();
      if (!file.isFile()) throw new Error("Fitness Tracker snapshot must be a file");
      if ((file.mode & 0o777) !== 0o600) {
        throw new Error("Fitness Tracker snapshot must have mode 0600");
      }
      if (file.size === 0 || file.size > maxSnapshotBytes) {
        throw new Error("Fitness Tracker snapshot size is outside the allowed bound");
      }
      const raw = await handle.readFile({ encoding: "utf8" });
      return parseFitnessTrackerSnapshotFile(raw);
    } finally {
      await handle.close();
    }
  }
}

/** Creates one validated private snapshot without replacing an existing file. */
export async function writePrivateFitnessTrackerSnapshot(
  path: string,
  input: unknown
): Promise<void> {
  const capture = parseFitnessTrackerSnapshotCapture(input);
  const snapshot = toSnapshot(capture);
  const file: FitnessTrackerSnapshotFile = {
    ...capture,
    manifestChecksum: snapshot.manifestChecksum
  };
  const encoded = `${JSON.stringify(file)}\n`;
  if (Buffer.byteLength(encoded) > maxSnapshotBytes) {
    throw new Error("Fitness Tracker snapshot size exceeds the allowed bound");
  }
  await writeFile(path, encoded, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
}

/** Parses connector capture input and rejects unknown or unbounded structure. */
export function parseFitnessTrackerSnapshotCapture(
  input: unknown
): FitnessTrackerSnapshotCapture {
  const root = record(input, "snapshot capture");
  const commonKeys = [
    "schemaVersion", "spreadsheetId", "workbookTitle", "locale", "timeZone"
  ] as const;
  const hasWeightShape = hasExactKeys(root, [...commonKeys, "weight", "dailyLog"]);
  const hasBodyShape = hasExactKeys(root, [...commonKeys, "body"]);
  const hasNutritionShape = hasExactKeys(root, [
    ...commonKeys,
    "brands",
    "ingredients",
    "foods",
    "foodIngredients",
    "meals",
    "dailyLog"
  ]);
  if (!hasWeightShape && !hasBodyShape && !hasNutritionShape) {
    throw new Error("Fitness Tracker snapshot contains unknown or missing fields");
  }
  if (root.schemaVersion !== FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("Unsupported Fitness Tracker snapshot schema version");
  }
  if (
    root.spreadsheetId !== FITNESS_TRACKER_SPREADSHEET_ID ||
    root.workbookTitle !== workbookTitle ||
    root.locale !== "ru_RU" ||
    root.timeZone !== "Europe/Moscow"
  ) {
    throw new Error("Fitness Tracker snapshot metadata does not match the approved source");
  }
  const base = {
    schemaVersion: FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION,
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
    workbookTitle,
    locale: "ru_RU" as const,
    timeZone: "Europe/Moscow" as const
  } as const;
  if (hasWeightShape) {
    const weight = sheet(root.weight, "Weight", 2);
    const dailyLog = sheet(root.dailyLog, "Daily_Log", 52);
    if (weight.sheetId === dailyLog.sheetId) {
      throw new Error("Fitness Tracker snapshot sheet ids must be distinct");
    }
    return { ...base, weight, dailyLog };
  }
  if (hasBodyShape) {
    return { ...base, body: sheet(root.body, "Body", 10) };
  }
  const brands = sheet(root.brands, "Brands", 6);
  const ingredients = sheet(root.ingredients, "Ingredients", 10);
  const foods = sheet(root.foods, "Foods", 13);
  const foodIngredients = sheet(root.foodIngredients, "Food_Ingredients", 8);
  const meals = sheet(root.meals, "Meals", 12);
  const dailyLog = sheet(root.dailyLog, "Daily_Log", 52);
  const ids = [brands, ingredients, foods, foodIngredients, meals, dailyLog]
    .map(({ sheetId }) => sheetId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Fitness Tracker snapshot sheet ids must be distinct");
  }
  return { ...base, brands, ingredients, foods, foodIngredients, meals, dailyLog };
}

function parseFitnessTrackerSnapshotFile(raw: string): FitnessTrackerSourceSnapshot {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("Fitness Tracker snapshot is not valid JSON");
  }
  const root = record(decoded, "snapshot file");
  if (root.schemaVersion === legacySnapshotSchemaVersion) {
    return parseLegacySnapshotFile(root);
  }
  const { manifestChecksum, ...captureFields } = root;
  if (
    typeof manifestChecksum !== "string" ||
    !/^[0-9a-f]{64}$/.test(manifestChecksum)
  ) {
    throw new Error("Fitness Tracker snapshot manifest checksum is invalid");
  }
  const snapshot = toSnapshot(parseFitnessTrackerSnapshotCapture(captureFields));
  if (snapshot.manifestChecksum !== manifestChecksum) {
    throw new Error("Fitness Tracker snapshot manifest checksum does not match");
  }
  return snapshot;
}

function toSnapshot(
  capture: FitnessTrackerSnapshotCapture
): FitnessTrackerSourceSnapshot {
  const base = {
    spreadsheetId: capture.spreadsheetId,
    locale: capture.locale,
    timeZone: capture.timeZone
  } as const;
  const withoutChecksum = "body" in capture
    ? { ...base, body: capture.body }
    : "weight" in capture
      ? { ...base, weight: capture.weight, dailyLog: capture.dailyLog }
      : {
          ...base,
          brands: capture.brands,
          ingredients: capture.ingredients,
          foods: capture.foods,
          foodIngredients: capture.foodIngredients,
          meals: capture.meals,
          dailyLog: capture.dailyLog
        };
  return {
    ...withoutChecksum,
    manifestChecksum: computeFitnessTrackerManifestChecksum(withoutChecksum)
  };
}

function sheet(
  input: unknown,
  title: "Weight" | "Daily_Log" | "Body" | "Brands" | "Ingredients" |
    "Foods" | "Food_Ingredients" | "Meals",
  columns: number
) {
  const value = record(input, `${title} sheet`);
  exactKeys(value, ["sheetId", "title", "headers", "rows"]);
  if (!Number.isSafeInteger(value.sheetId) || Number(value.sheetId) < 0) {
    throw new Error(`${title} sheet id is invalid`);
  }
  if (value.title !== title) throw new Error(`${title} sheet title is invalid`);
  if (!Array.isArray(value.headers) || value.headers.length > columns) {
    throw new Error(`${title} headers are invalid`);
  }
  const headers = value.headers.map((header) => {
    if (typeof header !== "string") throw new Error(`${title} header is invalid`);
    return header;
  });
  const required = title === "Weight"
    ? ["Date", "Weight_kg"]
    : title === "Daily_Log"
      ? ["Date"]
      : title === "Body"
        ? [
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
        ]
        : nutritionRequiredHeaders[title];
  if (!required.every((header) => headers.includes(header))) {
    throw new Error(`${title} required headers are missing`);
  }
  if (title === "Daily_Log" && !headers.includes("Weight") && !headers.includes("DayStatus")) {
    throw new Error("Daily_Log required headers are missing");
  }
  if (!Array.isArray(value.rows) || value.rows.length > 4_999) {
    throw new Error(`${title} rows are outside the allowed bound`);
  }
  const parsedRows = value.rows.map((item) => row(item, title, columns));
  if (new Set(parsedRows.map(({ locator }) => locator)).size !== parsedRows.length) {
    throw new Error(`${title} row locators must be unique`);
  }
  const rows = parsedRows.filter(({ values }) =>
      values.some((cellValue) => cellValue !== null && cellValue !== "")
    );
  return { sheetId: Number(value.sheetId), title, headers, rows };
}

function row(
  input: unknown,
  title: "Weight" | "Daily_Log" | "Body" | "Brands" | "Ingredients" |
    "Foods" | "Food_Ingredients" | "Meals",
  columns: number
): BoundedSheetRow {
  const value = record(input, `${title} row`);
  exactKeys(value, ["locator", "values"]);
  if (
    typeof value.locator !== "string" ||
    !new RegExp(`^${title}!(?:[2-9]|[1-9][0-9]{1,3})$`).test(value.locator) ||
    Number(value.locator.split("!")[1]) > 5_000
  ) {
    throw new Error(`${title} row locator is invalid`);
  }
  if (!Array.isArray(value.values) || value.values.length > columns) {
    throw new Error(`${title} row cells are outside the allowed bound`);
  }
  return { locator: value.locator, values: value.values.map(cell) };
}

const nutritionRequiredHeaders = {
  Brands: ["Brand_ID", "Name", "Type", "Notes", "Active", "Source"],
  Ingredients: [
    "Ingredient_ID", "Name", "Category", "Default_unit", "Calories_per_100g",
    "Protein_per_100g", "Fat_per_100g", "Carbs_per_100g", "Source", "Active"
  ],
  Foods: [
    "Food_ID", "Name", "Type", "Category", "Default_portion", "Calories",
    "Protein", "Fat", "Carbs", "Source", "Confidence", "Active", "Brand_ID"
  ],
  Food_Ingredients: [
    "Food_ID", "Ingredient_ID", "Quantity", "Unit", "Preparation", "Required",
    "Notes", "Confidence"
  ],
  Meals: [
    "Date", "Meal", "Description", "Calories", "Protein", "Fat", "Carbs",
    "Photo", "Notes", "Food_ID", "Confidence", "Meal_ID"
  ]
} as const;

function parseLegacySnapshotFile(
  root: Record<string, unknown>
): FitnessTrackerWeightSnapshot {
  exactKeys(root, [
    "schemaVersion",
    "spreadsheetId",
    "workbookTitle",
    "locale",
    "timeZone",
    "weight",
    "dailyLog",
    "manifestChecksum"
  ]);
  if (
    root.spreadsheetId !== FITNESS_TRACKER_SPREADSHEET_ID ||
    root.workbookTitle !== workbookTitle ||
    root.locale !== "ru_RU" ||
    root.timeZone !== "Europe/Moscow"
  ) {
    throw new Error("Fitness Tracker snapshot metadata does not match the approved source");
  }
  const manifestChecksum = root.manifestChecksum;
  if (typeof manifestChecksum !== "string" || !/^[0-9a-f]{64}$/.test(manifestChecksum)) {
    throw new Error("Fitness Tracker snapshot manifest checksum is invalid");
  }
  const weight = sheet(root.weight, "Weight", 2);
  const dailyLog = sheet(root.dailyLog, "Daily_Log", 52);
  if (weight.sheetId === dailyLog.sheetId) {
    throw new Error("Fitness Tracker snapshot sheet ids must be distinct");
  }
  const fields = {
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
    locale: "ru_RU" as const,
    timeZone: "Europe/Moscow" as const,
    weight,
    dailyLog
  } as const;
  const snapshot = {
    ...fields,
    manifestChecksum: computeFitnessTrackerManifestChecksum(fields)
  };
  if (snapshot.manifestChecksum !== manifestChecksum) {
    throw new Error("Fitness Tracker snapshot manifest checksum does not match");
  }
  return snapshot;
}

function cell(value: unknown): SheetCellValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new Error("Fitness Tracker snapshot contains an invalid cell value");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Fitness Tracker ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  if (!hasExactKeys(value, expected)) {
    throw new Error("Fitness Tracker snapshot contains unknown or missing fields");
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index]);
}
