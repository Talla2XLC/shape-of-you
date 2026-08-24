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
  implements ImportSourceReader<FitnessTrackerWeightSnapshot>
{
  public constructor(
    private readonly credential: GoogleServiceIdentityCredential,
    private readonly fetcher: Fetch = globalThis.fetch
  ) {}

  /** Reads and validates the bounded Weight/Daily_Log snapshot. */
  public async readSnapshot(): Promise<FitnessTrackerWeightSnapshot> {
    const accessToken = await this.accessToken();
    const url = new URL(
      `https://sheets.googleapis.com/v4/spreadsheets/${FITNESS_TRACKER_SPREADSHEET_ID}`
    );
    url.searchParams.set("includeGridData", "true");
    url.searchParams.append("ranges", "Weight!A1:B5000");
    url.searchParams.append("ranges", "Daily_Log!A1:AZ5000");
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

    const weight = parseSheet(workbook, "Weight", 2);
    const dailyLog = parseSheet(workbook, "Daily_Log", 52);
    requireHeader(weight, "Date");
    requireHeader(weight, "Weight_kg");
    requireHeader(dailyLog, "Date");
    requireHeader(dailyLog, "Weight");
    const manifestChecksum = computeFitnessTrackerManifestChecksum({
      spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
      locale: "ru_RU",
      timeZone: "Europe/Moscow",
      weight,
      dailyLog
    });
    return {
      spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
      locale: "ru_RU",
      timeZone: "Europe/Moscow",
      manifestChecksum,
      weight,
      dailyLog
    };
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
  snapshot: Omit<FitnessTrackerWeightSnapshot, "manifestChecksum">
): string {
  return digest({
    spreadsheetId: snapshot.spreadsheetId,
    locale: snapshot.locale,
    timeZone: snapshot.timeZone,
    sheets: [snapshot.weight, snapshot.dailyLog]
  });
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
