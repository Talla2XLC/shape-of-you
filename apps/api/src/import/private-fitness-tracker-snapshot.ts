import { constants } from "node:fs";
import { open, writeFile } from "node:fs/promises";

import type { ImportSourceReader } from "./contracts.js";
import {
  computeFitnessTrackerManifestChecksum,
  FITNESS_TRACKER_SPREADSHEET_ID,
  type BoundedSheetRow,
  type BoundedSheetSnapshot,
  type FitnessTrackerWeightSnapshot,
  type SheetCellValue
} from "./fitness-tracker-sheets-reader.js";

/** Current private snapshot envelope emitted by connector orchestration. */
export const FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION = 1;

const maxSnapshotBytes = 16 * 1024 * 1024;
const workbookTitle = "Fitness Tracker";

/** Connector-owned capture before the canonical manifest checksum is attached. */
export interface FitnessTrackerSnapshotCapture {
  readonly schemaVersion: typeof FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION;
  readonly spreadsheetId: typeof FITNESS_TRACKER_SPREADSHEET_ID;
  readonly workbookTitle: typeof workbookTitle;
  readonly locale: "ru_RU";
  readonly timeZone: "Europe/Moscow";
  readonly weight: BoundedSheetSnapshot;
  readonly dailyLog: BoundedSheetSnapshot;
}

interface FitnessTrackerSnapshotFile extends FitnessTrackerSnapshotCapture {
  readonly manifestChecksum: string;
}

/** Reads a bounded private snapshot without following symlinks or permissive files. */
export class PrivateFitnessTrackerSnapshotReader
  implements ImportSourceReader<FitnessTrackerWeightSnapshot>
{
  public constructor(private readonly path: string) {}

  /** Validates file safety, schema, source metadata, bounds, and checksum. */
  public async readSnapshot(): Promise<FitnessTrackerWeightSnapshot> {
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
  exactKeys(root, [
    "schemaVersion",
    "spreadsheetId",
    "workbookTitle",
    "locale",
    "timeZone",
    "weight",
    "dailyLog"
  ]);
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
  const weight = sheet(root.weight, "Weight", 2);
  const dailyLog = sheet(root.dailyLog, "Daily_Log", 52);
  if (weight.sheetId === dailyLog.sheetId) {
    throw new Error("Fitness Tracker snapshot sheet ids must be distinct");
  }
  return {
    schemaVersion: FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION,
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
    workbookTitle,
    locale: "ru_RU",
    timeZone: "Europe/Moscow",
    weight,
    dailyLog
  };
}

function parseFitnessTrackerSnapshotFile(raw: string): FitnessTrackerWeightSnapshot {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("Fitness Tracker snapshot is not valid JSON");
  }
  const root = record(decoded, "snapshot file");
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
): FitnessTrackerWeightSnapshot {
  const withoutChecksum = {
    spreadsheetId: capture.spreadsheetId,
    locale: capture.locale,
    timeZone: capture.timeZone,
    weight: capture.weight,
    dailyLog: capture.dailyLog
  } as const;
  return {
    ...withoutChecksum,
    manifestChecksum: computeFitnessTrackerManifestChecksum(withoutChecksum)
  };
}

function sheet(input: unknown, title: "Weight" | "Daily_Log", columns: number) {
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
  const required = title === "Weight" ? ["Date", "Weight_kg"] : ["Date", "Weight"];
  if (!required.every((header) => headers.includes(header))) {
    throw new Error(`${title} required headers are missing`);
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
  title: "Weight" | "Daily_Log",
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
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error("Fitness Tracker snapshot contains unknown or missing fields");
  }
}
