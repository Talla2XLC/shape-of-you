import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runDryRun } from "../src/import/contracts.js";
import {
  FITNESS_TRACKER_SPREADSHEET_ID,
  FitnessTrackerSheetsReader,
  computeFitnessTrackerManifestChecksum,
  type FitnessTrackerWeightSnapshot
} from "../src/import/fitness-tracker-sheets-reader.js";
import { createFitnessTrackerSource } from "../src/import/fitness-tracker-source.js";
import {
  FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION,
  PrivateFitnessTrackerSnapshotReader,
  type FitnessTrackerBodySnapshotCapture,
  type FitnessTrackerNutritionSnapshotCapture,
  type FitnessTrackerWeightSnapshotCapture,
  writePrivateFitnessTrackerSnapshot
} from "../src/import/private-fitness-tracker-snapshot.js";
import {
  WeightDryRunAdapter,
  type WeightImportTarget
} from "../src/import/weight-dry-run.js";
import { PrivateJsonFileReportSink } from "../src/import/private-report-sink.js";

const snapshot = (
  weightRows: FitnessTrackerWeightSnapshot["weight"]["rows"],
  mirrorRows: FitnessTrackerWeightSnapshot["dailyLog"]["rows"]
): FitnessTrackerWeightSnapshot => ({
  spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
  locale: "ru_RU",
  timeZone: "Europe/Moscow",
  manifestChecksum: "fixture-manifest",
  weight: {
    sheetId: 101,
    title: "Weight",
    headers: ["Date", "Weight_kg"],
    rows: weightRows
  },
  dailyLog: {
    sheetId: 202,
    title: "Daily_Log",
    headers: ["Date", "Weight", "Calories"],
    rows: mirrorRows
  }
});

describe("Weight import dry-run", () => {
  it("classifies all four outcomes without a writer port", async () => {
    const source = snapshot(
      [
        { locator: "Weight!2", values: ["21.08.2026", "82,125"] },
        { locator: "Weight!3", values: ["2026-08-22", 81.5] },
        { locator: "Weight!4", values: ["bad date", 80] }
      ],
      [
        { locator: "Daily_Log!2", values: ["2026-08-21", 82.125] },
        { locator: "Daily_Log!3", values: ["2026-08-22", 81.5] }
      ]
    );
    const adapter = new WeightDryRunAdapter();
    const first = adapter.classify(source, []);
    const candidate = first.privateDetail.candidates[0]!;
    const unchanged: WeightImportTarget = {
      id: "target-1",
      sourceIdentity: candidate.sourceIdentity,
      checksum: candidate.checksum,
      localDate: candidate.localDate,
      temporalPrecision: "local_date",
      weightKg: candidate.weightKg
    };
    const mismatchCandidate = first.privateDetail.candidates[1]!;
    const mismatch: WeightImportTarget = {
      id: "target-2",
      sourceIdentity: mismatchCandidate.sourceIdentity,
      checksum: "different",
      localDate: mismatchCandidate.localDate,
      temporalPrecision: "local_date",
      weightKg: mismatchCandidate.weightKg
    };

    const result = await runDryRun(
      "00000000-0000-4000-8000-000000000001",
      { readSnapshot: async () => source },
      { readTarget: async () => [unchanged, mismatch] },
      adapter
    );

    expect(result.safeReport.counts).toEqual({
      created: 0,
      unchanged: 1,
      conflict: 1,
      invalid: 1
    });
    expect(result.safeReport.findings.map((item) => item.code)).toEqual([
      "semantic_match",
      "target_mismatch",
      "invalid_authority_row"
    ]);
    expect(JSON.stringify(result.safeReport)).not.toContain("82.125");
    expect(JSON.stringify(result.safeReport)).not.toContain("2026-08-21");
  });

  it("keeps identity stable when a row moves and produces byte-stable output", () => {
    const adapter = new WeightDryRunAdapter();
    const first = adapter.classify(
      snapshot(
        [{ locator: "Weight!2", values: [45525, 80] }],
        [{ locator: "Daily_Log!2", values: [45525, 80] }]
      ),
      []
    );
    const movedSnapshot = snapshot(
      [{ locator: "Weight!200", values: [45525, 80] }],
      [{ locator: "Daily_Log!300", values: [45525, 80] }]
    );
    const moved = adapter.classify(movedSnapshot, []);
    const repeated = adapter.classify(movedSnapshot, []);

    expect(first.privateDetail.candidates[0]?.sourceIdentity).toEqual(
      moved.privateDetail.candidates[0]?.sourceIdentity
    );
    expect(first.privateDetail.candidates[0]?.checksum).toBe(
      moved.privateDetail.candidates[0]?.checksum
    );
    expect(JSON.stringify(moved.safeReport)).toBe(JSON.stringify(repeated.safeReport));
  });

  it("turns duplicates, mirror gaps/mismatches and target-only facts into conflicts", () => {
    const adapter = new WeightDryRunAdapter();
    const source = snapshot(
      [
        { locator: "Weight!2", values: ["2026-08-20", 82] },
        { locator: "Weight!3", values: ["2026-08-20", 81] },
        { locator: "Weight!4", values: ["2026-08-21", 80] },
        { locator: "Weight!5", values: ["2026-08-23", 77] },
        { locator: "Weight!6", values: ["2026-08-24", "not-a-weight"] }
      ],
      [
        { locator: "Daily_Log!2", values: ["2026-08-20", 82] },
        { locator: "Daily_Log!3", values: ["2026-08-21", 79] },
        { locator: "Daily_Log!4", values: ["2026-08-22", 78] }
      ]
    );
    const targetOnly: WeightImportTarget = {
      id: "target-only",
      sourceIdentity: {
        spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
        sheetId: 101,
        sourceKey: "2026-08-19"
      },
      checksum: "checksum",
      localDate: "2026-08-19",
      temporalPrecision: "instant",
      weightKg: 83
    };

    const result = adapter.classify(source, [targetOnly]);
    const codes = result.safeReport.findings.map((item) => item.code);
    expect(codes).toContain("duplicate_authority");
    expect(codes).toContain("value_mismatch");
    expect(codes).toContain("orphan_mirror");
    expect(codes).toContain("missing_mirror");
    expect(codes).toContain("target_only");
    expect(codes).toContain("invalid_authority_row");
    expect(result.safeReport.counts.created).toBe(0);
    expect(result.privateDetail.records).toContainEqual(
      expect.objectContaining({
        role: "target",
        sourceLocator: "postgresql:target-only",
        targetMeasurementId: "target-only"
      })
    );
  });

  it("does not overwrite changed values or invent a link for a changed date", () => {
    const adapter = new WeightDryRunAdapter();
    const original = adapter.classify(
      snapshot(
        [{ locator: "Weight!2", values: ["2026-08-20", 82] }],
        [{ locator: "Daily_Log!2", values: ["2026-08-20", 82] }]
      ),
      []
    ).privateDetail.candidates[0]!;
    const target: WeightImportTarget = {
      id: "original",
      sourceIdentity: original.sourceIdentity,
      checksum: original.checksum,
      localDate: original.localDate,
      temporalPrecision: "local_date",
      weightKg: original.weightKg
    };
    const valueChanged = adapter.classify(
      snapshot(
        [{ locator: "Weight!9", values: ["2026-08-20", 81] }],
        [{ locator: "Daily_Log!9", values: ["2026-08-20", 81] }]
      ),
      [target]
    );
    const dateChanged = adapter.classify(
      snapshot(
        [{ locator: "Weight!9", values: ["2026-08-21", 82] }],
        [{ locator: "Daily_Log!9", values: ["2026-08-21", 82] }]
      ),
      [target]
    );

    expect(valueChanged.safeReport.findings.map((item) => item.code)).toEqual([
      "target_mismatch"
    ]);
    expect(dateChanged.safeReport.findings.map((item) => item.code).sort()).toEqual([
      "target_absent",
      "target_only"
    ]);
  });
});

describe("Fitness Tracker read-only Sheets adapter", () => {
  it("uses read-only scope, exact workbook, bounded ranges and metadata sheet ids", async () => {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const pkcs8 = await exportPKCS8(privateKey);
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" || init?.body instanceof URLSearchParams
          ? { body: String(init.body) }
          : {})
      });
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "test-access-token" });
      }
      return Response.json({
        spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
        properties: {
          title: "Fitness Tracker",
          locale: "ru_RU",
          timeZone: "Europe/Moscow"
        },
        sheets: [
          {
            properties: { sheetId: 901, title: "Weight" },
            data: [{ rowData: [
              { values: [
                { effectiveValue: { stringValue: "Date" } },
                { effectiveValue: { stringValue: "Weight_kg" } }
              ] },
              { values: [
                { effectiveValue: { stringValue: "2026-08-21" } },
                { effectiveValue: { numberValue: 82 } }
              ] }
            ] }]
          },
          {
            properties: { sheetId: 902, title: "Daily_Log" },
            data: [{ rowData: [
              { values: [
                { effectiveValue: { stringValue: "Date" } },
                { effectiveValue: { stringValue: "Weight" } }
              ] },
              { values: [
                { effectiveValue: { stringValue: "2026-08-21" } },
                { effectiveValue: { numberValue: 82 } }
              ] }
            ] }]
          },
          {
            properties: { sheetId: 903, title: "Body" },
            data: [{ rowData: [{ values: [
              { effectiveValue: { stringValue: "Date" } },
              { effectiveValue: { stringValue: "Waist_cm" } },
              { effectiveValue: { stringValue: "Chest_cm" } },
              { effectiveValue: { stringValue: "Hips_cm" } },
              { effectiveValue: { stringValue: "Thigh_cm" } },
              { effectiveValue: { stringValue: "Biceps_cm" } },
              { effectiveValue: { stringValue: "Photo" } },
              { effectiveValue: { stringValue: "Notes" } },
              { effectiveValue: { stringValue: "Measurement_ID" } },
              { effectiveValue: { stringValue: "Source" } }
            ] }] }]
          }
        ]
      });
    };
    const reader = new FitnessTrackerSheetsReader(
      { clientEmail: "api-reader@example.test", privateKey: pkcs8 },
      "weight",
      fetcher
    );
    const result = await reader.readSnapshot();
    const assertion = new URLSearchParams(requests[0]?.body).get("assertion")!;
    const payload = decodeJwt(assertion);
    const readUrl = new URL(requests[1]!.url);

    expect(payload.scope).toBe("https://www.googleapis.com/auth/spreadsheets.readonly");
    expect(payload.sub).toBeUndefined();
    expect(requests.map((request) => request.method)).toEqual(["POST", "GET"]);
    expect(readUrl.pathname).toBe(
      `/v4/spreadsheets/${FITNESS_TRACKER_SPREADSHEET_ID}`
    );
    expect(readUrl.searchParams.getAll("ranges")).toEqual([
      "Weight!A1:B5000",
      "Daily_Log!A1:AZ5000"
    ]);
    if (!("weight" in result)) throw new Error("Expected Weight snapshot");
    expect(result.weight.sheetId).toBe(901);
    expect(result.dailyLog.sheetId).toBe(902);
  });

  it("reads only Body when the shared reader selects the Body domain", async () => {
    const { privateKey } = await generateKeyPair("RS256", { extractable: true });
    const pkcs8 = await exportPKCS8(privateKey);
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "test-access-token" });
      }
      return Response.json({
        spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
        properties: {
          title: "Fitness Tracker",
          locale: "ru_RU",
          timeZone: "Europe/Moscow"
        },
        sheets: [{
          properties: { sheetId: 903, title: "Body" },
          data: [{ rowData: [{ values: bodyHeaders.map((header) => ({
            effectiveValue: { stringValue: header }
          })) }] }]
        }]
      });
    };
    const result = await new FitnessTrackerSheetsReader(
      { clientEmail: "api-reader@example.test", privateKey: pkcs8 },
      "body",
      fetcher
    ).readSnapshot();
    const readUrl = new URL(requests[1]!);

    expect(readUrl.searchParams.getAll("ranges")).toEqual(["Body!A1:J5000"]);
    if (!("body" in result)) throw new Error("Expected Body snapshot");
    expect(result.body.sheetId).toBe(903);
  });
});

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

const snapshotCapture = (): FitnessTrackerWeightSnapshotCapture => ({
  schemaVersion: FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION,
  spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
  workbookTitle: "Fitness Tracker",
  locale: "ru_RU",
  timeZone: "Europe/Moscow",
  weight: {
    sheetId: 101,
    title: "Weight",
    headers: ["Date", "Weight_kg"],
    rows: [{ locator: "Weight!2", values: ["2026-08-21", 82] }]
  },
  dailyLog: {
    sheetId: 202,
    title: "Daily_Log",
    headers: ["Date", "Weight"],
    rows: [{ locator: "Daily_Log!2", values: ["2026-08-21", 82] }]
  }
});

const bodySnapshotCapture = (): FitnessTrackerBodySnapshotCapture => ({
  schemaVersion: FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION,
  spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
  workbookTitle: "Fitness Tracker",
  locale: "ru_RU",
  timeZone: "Europe/Moscow",
  body: {
    sheetId: 303,
    title: "Body",
    headers: bodyHeaders,
    rows: []
  }
});

const nutritionSnapshotCapture = (): FitnessTrackerNutritionSnapshotCapture => ({
  schemaVersion: FITNESS_TRACKER_SNAPSHOT_SCHEMA_VERSION,
  spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
  workbookTitle: "Fitness Tracker",
  locale: "ru_RU",
  timeZone: "Europe/Moscow",
  brands: { sheetId: 401, title: "Brands", headers: ["Brand_ID", "Name", "Type", "Notes", "Active", "Source"], rows: [] },
  ingredients: { sheetId: 402, title: "Ingredients", headers: ["Ingredient_ID", "Name", "Category", "Default_unit", "Calories_per_100g", "Protein_per_100g", "Fat_per_100g", "Carbs_per_100g", "Source", "Active"], rows: [] },
  foods: { sheetId: 403, title: "Foods", headers: ["Food_ID", "Name", "Type", "Category", "Default_portion", "Calories", "Protein", "Fat", "Carbs", "Source", "Confidence", "Active", "Brand_ID"], rows: [] },
  foodIngredients: { sheetId: 404, title: "Food_Ingredients", headers: ["Food_ID", "Ingredient_ID", "Quantity", "Unit", "Preparation", "Required", "Notes", "Confidence"], rows: [] },
  meals: { sheetId: 405, title: "Meals", headers: ["Date", "Meal", "Description", "Calories", "Protein", "Fat", "Carbs", "Photo", "Notes", "Food_ID", "Confidence", "Meal_ID"], rows: [] },
  dailyLog: { sheetId: 406, title: "Daily_Log", headers: ["Date", "DayStatus"], rows: [] }
});

describe("Private Fitness Tracker snapshot", () => {
  it("keeps schema v1 Weight snapshots readable", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fitness-tracker-snapshot-"));
    const snapshotPath = path.join(directory, "legacy.json");
    const capture = snapshotCapture();
    const legacyFields = {
      spreadsheetId: capture.spreadsheetId,
      locale: capture.locale,
      timeZone: capture.timeZone,
      weight: capture.weight,
      dailyLog: capture.dailyLog
    };
    try {
      await writeFile(snapshotPath, `${JSON.stringify({
        schemaVersion: 1,
        spreadsheetId: capture.spreadsheetId,
        workbookTitle: capture.workbookTitle,
        locale: capture.locale,
        timeZone: capture.timeZone,
        weight: capture.weight,
        dailyLog: capture.dailyLog,
        manifestChecksum: computeFitnessTrackerManifestChecksum(legacyFields)
      })}\n`, { mode: 0o600 });

      const result = await new PrivateFitnessTrackerSnapshotReader(snapshotPath).readSnapshot();
      if (!("weight" in result)) throw new Error("Expected Weight snapshot");
      expect(result.weight.rows).toEqual(capture.weight.rows);
      expect("body" in result).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("round-trips a bounded capture with private permissions and stable checksum", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fitness-tracker-snapshot-"));
    const firstPath = path.join(directory, "first.json");
    const secondPath = path.join(directory, "second.json");
    try {
      await writePrivateFitnessTrackerSnapshot(firstPath, snapshotCapture());
      await writePrivateFitnessTrackerSnapshot(secondPath, snapshotCapture());
      const first = await new PrivateFitnessTrackerSnapshotReader(firstPath).readSnapshot();
      const second = await new PrivateFitnessTrackerSnapshotReader(secondPath).readSnapshot();

      expect((await stat(firstPath)).mode & 0o777).toBe(0o600);
      expect(first.manifestChecksum).toMatch(/^[0-9a-f]{64}$/);
      expect(first.manifestChecksum).toBe(second.manifestChecksum);
      if (!("weight" in first)) throw new Error("Expected Weight snapshot");
      expect(first.weight.rows).toEqual(snapshotCapture().weight.rows);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("round-trips a Body-only current-schema capture", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fitness-tracker-snapshot-"));
    const snapshotPath = path.join(directory, "body.json");
    try {
      await writePrivateFitnessTrackerSnapshot(snapshotPath, bodySnapshotCapture());
      const result = await new PrivateFitnessTrackerSnapshotReader(snapshotPath).readSnapshot();

      if (!("body" in result)) throw new Error("Expected Body snapshot");
      expect(result.body.headers).toEqual(bodyHeaders);
      expect("weight" in result).toBe(false);
      expect("dailyLog" in result).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("round-trips one linked Nutrition-only capture", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fitness-tracker-snapshot-"));
    const snapshotPath = path.join(directory, "nutrition.json");
    try {
      await writePrivateFitnessTrackerSnapshot(snapshotPath, nutritionSnapshotCapture());
      const result = await new PrivateFitnessTrackerSnapshotReader(snapshotPath).readSnapshot();

      if (!("meals" in result)) throw new Error("Expected Nutrition snapshot");
      expect(result.meals.sheetId).toBe(405);
      expect("weight" in result).toBe(false);
      expect("body" in result).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("normalizes empty connector rows exactly like the live Sheets reader", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fitness-tracker-snapshot-"));
    const snapshotPath = path.join(directory, "snapshot.json");
    const capture = snapshotCapture();
    try {
      await writePrivateFitnessTrackerSnapshot(snapshotPath, {
        ...capture,
        weight: {
          ...capture.weight,
          rows: [
            { locator: "Weight!4", values: [] },
            ...capture.weight.rows,
            { locator: "Weight!5", values: [null, ""] }
          ]
        }
      });
      const result = await new PrivateFitnessTrackerSnapshotReader(
        snapshotPath
      ).readSnapshot();

      if (!("weight" in result)) throw new Error("Expected Weight snapshot");
      expect(result.weight.rows).toEqual(capture.weight.rows);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("refuses overwrite, permissive files, symlinks and tampered checksums", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fitness-tracker-snapshot-"));
    const snapshotPath = path.join(directory, "snapshot.json");
    const linkPath = path.join(directory, "snapshot-link.json");
    try {
      await writePrivateFitnessTrackerSnapshot(snapshotPath, snapshotCapture());
      await expect(
        writePrivateFitnessTrackerSnapshot(snapshotPath, snapshotCapture())
      ).rejects.toThrow();

      const encoded = await readFile(snapshotPath, "utf8");
      await writeFile(snapshotPath, encoded.replace("2026-08-21", "2026-08-22"), {
        mode: 0o600
      });
      await expect(
        new PrivateFitnessTrackerSnapshotReader(snapshotPath).readSnapshot()
      ).rejects.toThrow("checksum does not match");

      await chmod(snapshotPath, 0o644);
      await expect(
        new PrivateFitnessTrackerSnapshotReader(snapshotPath).readSnapshot()
      ).rejects.toThrow("mode 0600");
      await chmod(snapshotPath, 0o600);
      await symlink(snapshotPath, linkPath);
      await expect(
        new PrivateFitnessTrackerSnapshotReader(linkPath).readSnapshot()
      ).rejects.toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects unknown structure, duplicate locators and reused sheet ids", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fitness-tracker-snapshot-"));
    try {
      await expect(
        writePrivateFitnessTrackerSnapshot(path.join(directory, "unknown.json"), {
          ...snapshotCapture(),
          unexpected: true
        })
      ).rejects.toThrow("unknown or missing fields");
      const completeWeight = snapshotCapture();
      const incomplete = {
        schemaVersion: completeWeight.schemaVersion,
        spreadsheetId: completeWeight.spreadsheetId,
        workbookTitle: completeWeight.workbookTitle,
        locale: completeWeight.locale,
        timeZone: completeWeight.timeZone,
        weight: completeWeight.weight
      };
      await expect(
        writePrivateFitnessTrackerSnapshot(
          path.join(directory, "incomplete.json"),
          incomplete
        )
      ).rejects.toThrow("unknown or missing fields");
      await expect(
        writePrivateFitnessTrackerSnapshot(path.join(directory, "all-domains.json"), {
          ...snapshotCapture(),
          body: bodySnapshotCapture().body
        })
      ).rejects.toThrow("unknown or missing fields");
      const duplicate = snapshotCapture();
      await expect(
        writePrivateFitnessTrackerSnapshot(path.join(directory, "duplicate.json"), {
          ...duplicate,
          weight: {
            ...duplicate.weight,
            rows: [...duplicate.weight.rows, duplicate.weight.rows[0]]
          }
        })
      ).rejects.toThrow("locators must be unique");
      const reusedId = snapshotCapture();
      await expect(
        writePrivateFitnessTrackerSnapshot(path.join(directory, "sheet-id.json"), {
          ...reusedId,
          dailyLog: { ...reusedId.dailyLog, sheetId: reusedId.weight.sheetId }
        })
      ).rejects.toThrow("sheet ids must be distinct");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects invalid version, metadata, locators, cells and bounds", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "fitness-tracker-snapshot-"));
    const cases: Array<[string, unknown, string]> = [
      ["version", { ...snapshotCapture(), schemaVersion: 5 }, "schema version"],
      ["metadata", { ...snapshotCapture(), workbookTitle: "Another book" }, "metadata"],
      [
        "locator",
        {
          ...snapshotCapture(),
          weight: {
            ...snapshotCapture().weight,
            rows: [{ locator: "Weight!5001", values: ["2026-08-21", 82] }]
          }
        },
        "locator"
      ],
      [
        "cell",
        {
          ...snapshotCapture(),
          weight: {
            ...snapshotCapture().weight,
            rows: [{ locator: "Weight!2", values: ["2026-08-21", { kg: 82 }] }]
          }
        },
        "cell value"
      ],
      [
        "rows",
        {
          ...snapshotCapture(),
          weight: {
            ...snapshotCapture().weight,
            rows: Array.from({ length: 5_000 }, (_, index) => ({
              locator: `Weight!${index + 2}`,
              values: []
            }))
          }
        },
        "allowed bound"
      ]
    ];
    try {
      for (const [name, input, message] of cases) {
        await expect(
          writePrivateFitnessTrackerSnapshot(path.join(directory, `${name}.json`), input)
        ).rejects.toThrow(message);
      }

      const oversizedPath = path.join(directory, "oversized.json");
      await writeFile(oversizedPath, " ".repeat(16 * 1024 * 1024 + 1), {
        mode: 0o600
      });
      await expect(
        new PrivateFitnessTrackerSnapshotReader(oversizedPath).readSnapshot()
      ).rejects.toThrow("size is outside");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("selects exactly one source and needs no Google credential for a snapshot", () => {
    expect(
      createFitnessTrackerSource(" /private/tmp/snapshot.json ", {}, "weight")
    ).toBeInstanceOf(PrivateFitnessTrackerSnapshotReader);
    expect(() =>
      createFitnessTrackerSource("/private/tmp/snapshot.json", {
        GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL: "reader@example.test"
      }, "weight")
    ).toThrow("cannot be combined");
    expect(() => createFitnessTrackerSource(undefined, {}, "weight")).toThrow(
      "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL"
    );
  });
});

describe("Private import report sink", () => {
  it("uses private permissions and refuses to overwrite an existing report", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "weight-import-report-"));
    const reportPath = path.join(directory, "detail.json");
    const sink = new PrivateJsonFileReportSink(reportPath);
    try {
      await sink.write({ weightKg: 82.125 });

      expect((await stat(reportPath)).mode & 0o777).toBe(0o600);
      expect(await readFile(reportPath, "utf8")).toContain("82.125");
      await expect(sink.write({ weightKg: 80 })).rejects.toThrow();

      const existingPath = path.join(directory, "existing.json");
      await writeFile(existingPath, "operator-owned");
      await expect(
        new PrivateJsonFileReportSink(existingPath).write({ weightKg: 79 })
      ).rejects.toThrow();
      expect(await readFile(existingPath, "utf8")).toBe("operator-owned");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
