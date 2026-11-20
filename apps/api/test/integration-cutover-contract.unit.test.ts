import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  GarminCutoverPreviewSchema,
  GarminCutoverCoverageChangedSchema,
  GarminCutoverStatusSchema,
  PreviewGarminCutoverSchema,
  ScheduleGarminCutoverSchema,
  RetryGarminCutoverSchema,
  CancelGarminCutoverSchema,
  IntegrationHistoricalImportSchema
} from "@shape-of-you/contracts";

function validator(schema: object) {
  const ajv = new Ajv({ strict: false, allErrors: true });
  (addFormats as unknown as (instance: Ajv) => Ajv)(ajv);
  return ajv.compile(schema);
}

const preview = {
  expectedRevision: "revision-a", startsOn: "2026-11-21", timezone: "Europe/Moscow",
  startsAt: "2026-11-20T21:00:00.000Z", sourceDrainsUntil: "2026-12-04T21:00:00.000Z",
  sourceTailFromDate: "2026-11-07", capabilityVersion: "garmin-capabilities-v1",
  gaps: [{ capability: "recovery.hrv_rmssd", status: "unsupported", description: "Not imported by this mapping." }]
};

describe("Garmin cutover public contracts", () => {
  it("validates optional preview date and rejects invalid calendar dates or unknown inputs", () => {
    const check = validator(PreviewGarminCutoverSchema);
    expect(check({})).toBe(true);
    expect(check({ startsOn: "2026-11-21" })).toBe(true);
    expect(check({ startsOn: "2026-02-30" })).toBe(false);
    expect(check({ apiKey: "synthetic" })).toBe(false);
    expect(validator(GarminCutoverPreviewSchema)(preview)).toBe(true);
  });

  it("requires schedule consent, a bounded key and unique known waiver names", () => {
    const check = validator(ScheduleGarminCutoverSchema);
    const command = { startsOn: preview.startsOn, expectedRevision: preview.expectedRevision, apiKey: "synthetic-local-key", consent: true, acceptedCoverageGaps: ["recovery.hrv_rmssd"], dedupeKey: "schedule-a" };
    expect(check(command)).toBe(true);
    expect(check({ ...command, consent: false })).toBe(false);
    expect(check({ ...command, acceptedCoverageGaps: ["recovery.hrv_rmssd", "recovery.hrv_rmssd"] })).toBe(false);
    expect(check({ ...command, acceptedCoverageGaps: ["unknown"] })).toBe(false);
    expect(check({ ...command, apiKey: "key with spaces" })).toBe(false);
    expect(check({ ...command, dedupeKey: "" })).toBe(false);
  });

  it("publishes a closed coverage_changed conflict without keys or external identities", () => {
    const check = validator(GarminCutoverCoverageChangedSchema);
    const conflict = { statusCode: 409, error: "coverage_changed", message: "Coverage confirmation changed", details: { preview } };
    expect(check(conflict)).toBe(true);
    expect(check({ ...conflict, statusCode: 400 })).toBe(false);
    expect(check({ ...conflict, error: "CONFLICT" })).toBe(false);
    expect(check({ ...conflict, message: "x".repeat(257) })).toBe(false);
    expect(check({ ...conflict, apiKey: "synthetic-key" })).toBe(false);
    expect(check({ ...conflict, details: { ...conflict.details, apiKey: "synthetic-key" } })).toBe(false);
    expect(check({ ...conflict, details: { preview: { ...preview, externalAccountId: "private" } } })).toBe(false);
    expect(check({ ...conflict, details: { preview: { ...preview, apiKey: "synthetic-key" } } })).toBe(false);
    expect(check({ ...conflict, details: { ...conflict.details, externalAccountId: "private" } })).toBe(false);
  });

  it("permits saved-key retry while requiring exact CAS and future-preview fields", () => {
    const check = validator(RetryGarminCutoverSchema);
    const command = { startsOn: preview.startsOn, expectedRevision: preview.expectedRevision, expectedVersion: 3, acceptedCoverageGaps: [], dedupeKey: "retry-a" };
    expect(check(command)).toBe(true);
    expect(check({ ...command, apiKey: "replacement-key" })).toBe(true);
    expect(check({ ...command, expectedVersion: 0 })).toBe(false);
    expect(check({ ...command, consent: true })).toBe(false);
    const cancel = validator(CancelGarminCutoverSchema);
    expect(cancel({ expectedVersion: 3, reason: "user request" })).toBe(true);
    expect(cancel({ expectedVersion: 3 })).toBe(false);
  });

  it("keeps status closed and credential-free", () => {
    const check = validator(GarminCutoverStatusSchema);
    expect(check({ cutover: null })).toBe(true);
    const record = {
      id: "90000000-0000-4000-8000-000000000001", version: 1, state: "scheduled",
      startsOn: preview.startsOn, timezone: preview.timezone, startsAt: preview.startsAt,
      sourceDrainsUntil: preview.sourceDrainsUntil, capabilityVersion: preview.capabilityVersion,
      acceptedCoverageGaps: ["recovery.hrv_rmssd"], failureCode: null,
      sourceRevocationUnconfirmed: false, lastAttemptAt: null
    };
    expect(check({ cutover: record })).toBe(true);
    expect(check({ cutover: { ...record, state: "failed", failureCode: "restore_suppressed" } })).toBe(true);
    expect(check({ cutover: { ...record, state: "failed", failureCode: "journal_not_ready" } })).toBe(true);
    expect(check({ cutover: { ...record, apiKey: "synthetic-key" } })).toBe(false);
    expect(check({ cutover: { ...record, failureCode: "raw exception" } })).toBe(false);
    expect(check({ cutover: { ...record, externalAccountId: "private" } })).toBe(false);
  });

  it("keeps legacy history compatible and exposes scoped completion or stopped history", () => {
    const check = validator(IntegrationHistoricalImportSchema);
    const history = { status: "not_requested", processedThroughDate: null, requestedAt: null, lastAttemptAt: null, completedAt: null, failureCode: null };
    expect(check(history)).toBe(true);
    expect(check({ ...history, scopeFromDate: "2026-11-21" })).toBe(true);
    expect(check({ ...history, status: "failed", failureCode: "cutover_source_stopped" })).toBe(true);
    expect(check({ ...history, scopeFromDate: "2026-02-30" })).toBe(false);
  });
});
