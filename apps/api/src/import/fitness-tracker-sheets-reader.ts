import { createHash } from "node:crypto";

import { importPKCS8, SignJWT } from "jose";

import type { ImportSourceReader } from "./contracts.js";

/** Exact authoritative workbook; runtime configuration cannot redirect the importer. */
export const FITNESS_TRACKER_SPREADSHEET_ID =
  "1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik";

const sheetsReadScope = "https://www.googleapis.com/auth/spreadsheets.readonly";
const tokenAudience = "https://oauth2.googleapis.com/token";

/** Scalar source cell preserved for deterministic normalization. */
export type SheetCellValue = string | number | boolean | null;

/** Bounded source row with locator evidence that is not part of identity. */
export interface BoundedSheetRow {
  readonly locator: string;
  readonly values: readonly SheetCellValue[];
}

/** One bounded sheet projection returned in a workbook snapshot. */
export interface BoundedSheetSnapshot {
  readonly sheetId: number;
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly BoundedSheetRow[];
}

/** Source snapshot required by the Weight dry-run adapter. */
export interface FitnessTrackerWeightSnapshot {
  readonly spreadsheetId: typeof FITNESS_TRACKER_SPREADSHEET_ID;
  readonly locale: "ru_RU";
  readonly timeZone: "Europe/Moscow";
  readonly manifestChecksum: string;
  readonly weight: BoundedSheetSnapshot;
  readonly dailyLog: BoundedSheetSnapshot;
}

/** Source snapshot required by the Body import adapter. */
export interface FitnessTrackerBodySnapshot {
  readonly spreadsheetId: typeof FITNESS_TRACKER_SPREADSHEET_ID;
  readonly locale: "ru_RU";
  readonly timeZone: "Europe/Moscow";
  readonly manifestChecksum: string;
  readonly body: BoundedSheetSnapshot;
}

/** Source snapshot required by the Nutrition import adapter. */
export interface FitnessTrackerNutritionSnapshot {
  readonly spreadsheetId: typeof FITNESS_TRACKER_SPREADSHEET_ID;
  readonly locale: "ru_RU";
  readonly timeZone: "Europe/Moscow";
  readonly manifestChecksum: string;
  readonly brands: BoundedSheetSnapshot;
  readonly ingredients: BoundedSheetSnapshot;
  readonly foods: BoundedSheetSnapshot;
  readonly foodIngredients: BoundedSheetSnapshot;
  readonly meals: BoundedSheetSnapshot;
  readonly dailyLog: BoundedSheetSnapshot;
}

/** Source snapshot required by the Training import adapter. */
export interface FitnessTrackerTrainingSnapshot {
  readonly spreadsheetId: typeof FITNESS_TRACKER_SPREADSHEET_ID;
  readonly locale: "ru_RU";
  readonly timeZone: "Europe/Moscow";
  readonly manifestChecksum: string;
  readonly training: BoundedSheetSnapshot;
}

/** Source snapshot required by the raw Recovery import adapter. */
export interface FitnessTrackerRecoverySnapshot {
  readonly spreadsheetId: typeof FITNESS_TRACKER_SPREADSHEET_ID;
  readonly locale: "ru_RU";
  readonly timeZone: "Europe/Moscow";
  readonly manifestChecksum: string;
  readonly dailyLog: BoundedSheetSnapshot;
}

/** Workbook snapshot accepted by the shared domain router. */
export type FitnessTrackerSnapshot =
  | FitnessTrackerWeightSnapshot
  | FitnessTrackerBodySnapshot
  | FitnessTrackerNutritionSnapshot
  | FitnessTrackerTrainingSnapshot
  | FitnessTrackerRecoverySnapshot;

/** Concrete source shape selected by the shared domain router. */
export type FitnessTrackerSourceSnapshot = FitnessTrackerSnapshot;

/** Domain selector that bounds every live source read. */
export type FitnessTrackerImportDomain =
  | "weight"
  | "body"
  | "nutrition"
  | "training"
  | "recovery";

/** Runtime identity values delivered by the existing environment mechanism. */
export interface GoogleServiceIdentityCredential {
  readonly clientEmail: string;
  readonly privateKey: string;
}

interface GoogleTokenResponse {
  readonly access_token?: string;
}

interface GoogleCellData {
  readonly effectiveValue?: {
    readonly boolValue?: boolean;
    readonly numberValue?: number;
    readonly stringValue?: string;
  };
  readonly formattedValue?: string;
}

interface GoogleSheetData {
  readonly rowData?: readonly { readonly values?: readonly GoogleCellData[] }[];
}

interface GoogleSheet {
  readonly properties?: { readonly sheetId?: number; readonly title?: string };
  readonly data?: readonly GoogleSheetData[];
}

interface GoogleSpreadsheetResponse {
  readonly spreadsheetId?: string;
  readonly properties?: {
    readonly locale?: string;
    readonly timeZone?: string;
    readonly title?: string;
  };
  readonly sheets?: readonly GoogleSheet[];
}

type Fetch = typeof globalThis.fetch;

/**
 * Read-only Google Sheets v4 adapter for the exact Fitness Tracker workbook.
 *
 * It requests only the spreadsheets read scope, reads bounded ranges, derives
 * numeric sheet ids from metadata, and never exposes a Sheets write method.
 */
export class FitnessTrackerSheetsReader
  implements ImportSourceReader<FitnessTrackerSourceSnapshot>
{
  public constructor(
    private readonly credential: GoogleServiceIdentityCredential,
    private readonly domain: FitnessTrackerImportDomain,
    private readonly fetcher: Fetch = globalThis.fetch
  ) {}

  /** Reads and validates only the bounded sheets required by the selected domain. */
  public async readSnapshot(): Promise<FitnessTrackerSourceSnapshot> {
    const accessToken = await this.accessToken();
    const url = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${FITNESS_TRACKER_SPREADSHEET_ID}`
    );
    url.searchParams.set("includeGridData", "true");
    if (this.domain === "weight") {
      url.searchParams.append("ranges", "Weight!A1:B5000");
      url.searchParams.append("ranges", "Daily_Log!A1:AZ5000");
    } else if (this.domain === "body") {
      url.searchParams.append("ranges", "Body!A1:J5000");
    } else if (this.domain === "nutrition") {
      url.searchParams.append("ranges", "Brands!A1:F5000");
      url.searchParams.append("ranges", "Ingredients!A1:J5000");
      url.searchParams.append("ranges", "Foods!A1:M5000");
      url.searchParams.append("ranges", "Food_Ingredients!A1:H5000");
      url.searchParams.append("ranges", "Meals!A1:L5000");
      url.searchParams.append("ranges", "Daily_Log!A1:AZ5000");
    } else if (this.domain === "training") {
      url.searchParams.append("ranges", "Training!A1:K5000");
    } else {
      url.searchParams.append("ranges", "Daily_Log!A1:AJ5000");
    }
    const workbook = await this.fetchWorkbook(url, accessToken);

    if (this.domain === "weight") {
      const weight = parseSheet(workbook, "Weight", 2);
      const dailyLog = parseSheet(workbook, "Daily_Log", 52);
      requireHeader(weight, "Date");
      requireHeader(weight, "Weight_kg");
      requireHeader(dailyLog, "Date");
      requireHeader(dailyLog, "Weight");
      const fields = {
        spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
        locale: "ru_RU" as const,
        timeZone: "Europe/Moscow" as const,
        weight,
        dailyLog
      } as const;
      return {
        ...fields,
        manifestChecksum: computeFitnessTrackerManifestChecksum(fields)
      };
    }

    if (this.domain === "body") {
      const body = parseSheet(workbook, "Body", 10);
      for (const header of bodyHeaders) requireHeader(body, header);
      const fields = {
        spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
        locale: "ru_RU" as const,
        timeZone: "Europe/Moscow" as const,
        body
      } as const;
      return {
        ...fields,
        manifestChecksum: computeFitnessTrackerManifestChecksum(fields)
      };
    }

    if (this.domain === "training") {
      const training = parseSheet(workbook, "Training", 11);
      requireHeaders(training, trainingHeaders);
      const fields = {
        spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
        locale: "ru_RU" as const,
        timeZone: "Europe/Moscow" as const,
        training
      } as const;
      return { ...fields, manifestChecksum: computeFitnessTrackerManifestChecksum(fields) };
    }

    if (this.domain === "recovery") {
      const dailyLog = parseSheet(workbook, "Daily_Log", 36);
      requireHeaders(dailyLog, recoveryHeaders);
      const fields = {
        spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
        locale: "ru_RU" as const,
        timeZone: "Europe/Moscow" as const,
        dailyLog
      } as const;
      return { ...fields, manifestChecksum: computeFitnessTrackerManifestChecksum(fields) };
    }

    const brands = parseSheet(workbook, "Brands", 6);
    const ingredients = parseSheet(workbook, "Ingredients", 10);
    const foods = parseSheet(workbook, "Foods", 13);
    const foodIngredients = parseSheet(workbook, "Food_Ingredients", 8);
    const meals = parseSheet(workbook, "Meals", 12);
    const dailyLog = parseSheet(workbook, "Daily_Log", 52);
    requireHeaders(brands, nutritionHeaders.Brands);
    requireHeaders(ingredients, nutritionHeaders.Ingredients);
    requireHeaders(foods, nutritionHeaders.Foods);
    requireHeaders(foodIngredients, nutritionHeaders.Food_Ingredients);
    requireHeaders(meals, nutritionHeaders.Meals);
    requireHeader(dailyLog, "Date");
    const fields = {
      spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
      locale: "ru_RU" as const,
      timeZone: "Europe/Moscow" as const,
      brands,
      ingredients,
      foods,
      foodIngredients,
      meals,
      dailyLog
    } as const;
    const result = {
      ...fields,
      manifestChecksum: computeFitnessTrackerManifestChecksum(fields)
    };
    const verificationWorkbook = await this.fetchWorkbook(url, accessToken);
    const verificationFields = {
      spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
      locale: "ru_RU" as const,
      timeZone: "Europe/Moscow" as const,
      brands: parseSheet(verificationWorkbook, "Brands", 6),
      ingredients: parseSheet(verificationWorkbook, "Ingredients", 10),
      foods: parseSheet(verificationWorkbook, "Foods", 13),
      foodIngredients: parseSheet(verificationWorkbook, "Food_Ingredients", 8),
      meals: parseSheet(verificationWorkbook, "Meals", 12),
      dailyLog: parseSheet(verificationWorkbook, "Daily_Log", 52)
    } as const;
    if (computeFitnessTrackerManifestChecksum(verificationFields) !== result.manifestChecksum) {
      throw new Error("Google Sheets Nutrition source changed during snapshot read");
    }
    return result;
  }

  private async fetchWorkbook(
    url: URL,
    accessToken: string
  ): Promise<GoogleSpreadsheetResponse> {
    const response = await this.fetcher(url, {
      headers: { authorization: `Bearer ${accessToken}` },
      method: "GET"
    });
    if (!response.ok) {
      throw new Error(`Google Sheets snapshot read failed (${response.status})`);
    }
    const workbook = (await response.json()) as GoogleSpreadsheetResponse;
    if (
      workbook.spreadsheetId !== FITNESS_TRACKER_SPREADSHEET_ID ||
      workbook.properties?.title !== "Fitness Tracker" ||
      workbook.properties.locale !== "ru_RU" ||
      workbook.properties.timeZone !== "Europe/Moscow"
    ) {
      throw new Error("Google Sheets workbook metadata does not match the approved source");
    }
    return workbook;
  }

  private async accessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const privateKey = await importPKCS8(
      this.credential.privateKey.replaceAll("\\n", "\n"),
      "RS256"
    );
    const assertion = await new SignJWT({ scope: sheetsReadScope })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(this.credential.clientEmail)
      .setAudience(tokenAudience)
      .setIssuedAt(now)
      .setExpirationTime(now + 3_600)
      .sign(privateKey);
    const response = await this.fetcher(tokenAudience, {
      body: new URLSearchParams({
        assertion,
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer"
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST"
    });
    if (!response.ok) {
      throw new Error(`Google service identity authentication failed (${response.status})`);
    }
    const payload = (await response.json()) as GoogleTokenResponse;
    if (!payload.access_token) {
      throw new Error("Google service identity authentication returned no access token");
    }
    return payload.access_token;
  }
}

const bodyHeaders = [
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
] as const;

const nutritionHeaders = {
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

const trainingHeaders = [
  "Date", "Workout", "Exercise", "Weight_kg", "Sets", "Reps", "RIR",
  "Feeling", "Notes", "Exercise_ID", "Session_ID"
] as const;

const recoveryHeaders = [
  "Date", "Sleep", "HRV", "RHR", "NightHR", "SpO₂", "Temp",
  "BodyBattery", "MinSpO₂", "Respiration", "DeepSleep", "REMSleep",
  "LightSleep"
] as const;

function requireHeaders(
  sheet: BoundedSheetSnapshot,
  headers: readonly string[]
): void {
  for (const header of headers) requireHeader(sheet, header);
}

function parseSheet(
  workbook: GoogleSpreadsheetResponse,
  title: string,
  columnLimit: number
): BoundedSheetSnapshot {
  const sheet = workbook.sheets?.find(
    (candidate) => candidate.properties?.title === title
  );
  const sheetId = sheet?.properties?.sheetId;
  if (!sheet || sheetId === undefined) {
    throw new Error(`Required Google Sheet ${title} is missing`);
  }
  const rows = sheet.data?.[0]?.rowData ?? [];
  const headers = cellValues(rows[0]?.values, columnLimit).map((value) =>
    value === null ? "" : String(value).trim()
  );
  const dataRows = rows.slice(1).flatMap((row, index) => {
    const values = cellValues(row.values, columnLimit);
    return values.every((value) => value === null || value === "")
      ? []
      : [{ locator: `${title}!${index + 2}`, values }];
  });
  return { sheetId, title, headers, rows: dataRows };
}

function cellValues(
  cells: readonly GoogleCellData[] | undefined,
  limit: number
): SheetCellValue[] {
  return Array.from({ length: Math.min(cells?.length ?? 0, limit) }, (_, index) => {
    const cell = cells?.[index];
    const value = cell?.effectiveValue;
    if (value?.numberValue !== undefined) return value.numberValue;
    if (value?.stringValue !== undefined) return value.stringValue;
    if (value?.boolValue !== undefined) return value.boolValue;
    return cell?.formattedValue ?? null;
  });
}

function requireHeader(sheet: BoundedSheetSnapshot, header: string): void {
  if (!sheet.headers.includes(header)) {
    throw new Error(`Required header ${header} is missing from ${sheet.title}`);
  }
}

/** Computes the canonical checksum shared by live and private-file snapshots. */
export function computeFitnessTrackerManifestChecksum(
  snapshot: {
    readonly spreadsheetId: typeof FITNESS_TRACKER_SPREADSHEET_ID;
    readonly locale: "ru_RU";
    readonly timeZone: "Europe/Moscow";
    readonly weight?: BoundedSheetSnapshot;
    readonly dailyLog?: BoundedSheetSnapshot;
    readonly body?: BoundedSheetSnapshot;
    readonly brands?: BoundedSheetSnapshot;
    readonly ingredients?: BoundedSheetSnapshot;
    readonly foods?: BoundedSheetSnapshot;
    readonly foodIngredients?: BoundedSheetSnapshot;
    readonly meals?: BoundedSheetSnapshot;
  }
): string {
  const sheets = [
    snapshot.weight,
    snapshot.dailyLog,
    snapshot.body,
    snapshot.brands,
    snapshot.ingredients,
    snapshot.foods,
    snapshot.foodIngredients,
    snapshot.meals
  ]
    .filter((sheet): sheet is BoundedSheetSnapshot => sheet !== undefined);
  return digest({
    spreadsheetId: snapshot.spreadsheetId,
    locale: snapshot.locale,
    timeZone: snapshot.timeZone,
    sheets
  });
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
