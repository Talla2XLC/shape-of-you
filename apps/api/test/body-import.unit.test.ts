import { describe, expect, it } from "vitest";

import { BodyDryRunAdapter, type BodyImportTarget } from "../src/import/body-dry-run.js";
import {
  FITNESS_TRACKER_SPREADSHEET_ID,
  type FitnessTrackerBodySnapshot
} from "../src/import/fitness-tracker-sheets-reader.js";

const headers = [
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

function snapshot(
  rows: FitnessTrackerBodySnapshot["body"]["rows"]
): FitnessTrackerBodySnapshot {
  return {
    spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
    locale: "ru_RU",
    timeZone: "Europe/Moscow",
    manifestChecksum: "body-fixture-manifest",
    body: { sheetId: 303, title: "Body", headers, rows }
  };
}

describe("Body import dry-run", () => {
  it("classifies created, unchanged, conflict and invalid without leaking values", () => {
    const adapter = new BodyDryRunAdapter();
    const source = snapshot([
      { locator: "Body!2", values: ["2026-08-20", 81.25, "", "", "", "", "", "private note", "body-1", "manual"] },
      { locator: "Body!3", values: ["21.08.2026", 81, 101.5, "", "", "", "", "", "body-2", "chatgpt"] },
      { locator: "Body!4", values: ["2026-08-22", 80, "", "", "", "", "", "", "body-3", "manual"] },
      { locator: "Body!5", values: ["bad", 79, "", "", "", "", "", "", "body-4", "manual"] }
    ]);
    const first = adapter.classify(source, []);
    const unchangedCandidate = first.privateDetail.candidates[1]!;
    const mismatchCandidate = first.privateDetail.candidates[2]!;
    const targets: BodyImportTarget[] = [
      {
        id: "target-2",
        sourceIdentity: unchangedCandidate.sourceIdentity,
        checksum: unchangedCandidate.checksum,
        localDate: unchangedCandidate.localDate,
        temporalPrecision: "local_date",
        values: unchangedCandidate.values,
        note: unchangedCandidate.note
      },
      {
        id: "target-3",
        sourceIdentity: mismatchCandidate.sourceIdentity,
        checksum: "different",
        localDate: mismatchCandidate.localDate,
        temporalPrecision: "local_date",
        values: mismatchCandidate.values,
        note: mismatchCandidate.note
      }
    ];

    const result = adapter.classify(source, targets);

    expect(result.safeReport.counts).toEqual({
      created: 1,
      unchanged: 1,
      conflict: 1,
      invalid: 1
    });
    expect(result.safeReport.findings.map(({ code }) => code)).toEqual([
      "target_absent",
      "semantic_match",
      "target_mismatch",
      "invalid_body_row"
    ]);
    const safe = JSON.stringify(result.safeReport);
    expect(safe).not.toContain("81.25");
    expect(safe).not.toContain("private note");
    expect(safe).not.toContain("2026-08-20");
    expect(safe).not.toContain("body-1");
  });

  it("uses Measurement_ID across row moves and accepts partial metric sessions", () => {
    const adapter = new BodyDryRunAdapter();
    const first = adapter.classify(snapshot([
      { locator: "Body!2", values: [45525, "", 101.25, "", "", "", "", "", "stable-id", "manual"] }
    ]), []);
    const moved = adapter.classify(snapshot([
      { locator: "Body!400", values: [45525, "", 101.25, "", "", "", "", "", "stable-id", "manual"] }
    ]), []);

    expect(first.privateDetail.candidates[0]?.sourceIdentity).toEqual(
      moved.privateDetail.candidates[0]?.sourceIdentity
    );
    expect(first.privateDetail.candidates[0]?.values).toEqual([
      { metric: "chest", value: 101.25, unit: "cm" }
    ]);
    expect(first.privateDetail.candidates[0]?.checksum).toBe(
      moved.privateDetail.candidates[0]?.checksum
    );
  });

  it("blocks duplicate ids, photo references, missing values and invalid metrics", () => {
    const result = new BodyDryRunAdapter().classify(snapshot([
      { locator: "Body!2", values: ["2026-08-20", 81, "", "", "", "", "", "", "duplicate", "manual"] },
      { locator: "Body!3", values: ["2026-08-21", 80, "", "", "", "", "", "", "duplicate", "manual"] },
      { locator: "Body!4", values: ["2026-08-22", 79, "", "", "", "", "https://private.example/photo", "", "photo", "manual"] },
      { locator: "Body!5", values: ["2026-08-23", "", "", "", "", "", "", "", "empty", "manual"] },
      { locator: "Body!6", values: ["2026-08-24", 80.001, "", "", "", "", "", "", "precision", "manual"] }
    ]), []);

    expect(result.safeReport.counts).toEqual({
      created: 0,
      unchanged: 0,
      conflict: 3,
      invalid: 2
    });
    expect(result.safeReport.findings.map(({ code }) => code).sort()).toEqual([
      "duplicate_source_identity",
      "duplicate_source_identity",
      "invalid_body_row",
      "missing_body_values",
      "unsupported_photo_reference"
    ]);
  });

  it("reports target-only facts as conflicts", () => {
    const target: BodyImportTarget = {
      id: "target-only",
      sourceIdentity: {
        spreadsheetId: FITNESS_TRACKER_SPREADSHEET_ID,
        sheetId: 303,
        sourceKey: "missing-source"
      },
      checksum: "checksum",
      localDate: "2026-08-20",
      temporalPrecision: "local_date",
      values: [{ metric: "waist", value: 81, unit: "cm" }],
      note: null
    };
    const result = new BodyDryRunAdapter().classify(snapshot([]), [target]);

    expect(result.safeReport.counts).toEqual({
      created: 0,
      unchanged: 0,
      conflict: 1,
      invalid: 0
    });
    expect(result.privateDetail.records[0]).toEqual(expect.objectContaining({
      sourceLocator: "postgresql:target-only",
      targetSessionId: "target-only"
    }));
  });
});
