import { activityFit, compressedActivityFit } from "./fixtures/activity-fit.js";
import { describe, expect, it } from "vitest";
import { ActivityDetailsPayloadSchema, ExternalActivityDetailsResultSchema } from "@shape-of-you/contracts";
import { JsonSchemaPipe } from "../src/http/json-schema.js";
import { parseFitActivityDetails } from "../src/integrations/intervals-icu/fit-activity-details.js";
import { projectActivityDetails } from "../src/training/activity-details.js";

const activityId = "00000000-0000-4000-8000-000000000111";
const detailsId = "00000000-0000-4000-8000-000000000112";

function stored(file = activityFit()) {
  return { id: detailsId, sourceActivityVersion: activityId, normalizationVersion: "standard-fit-details-v1", payload: parseFitActivityDetails(file), fileChecksum: "a".repeat(64), importedAt: new Date("2026-10-04T15:00:00Z") };
}

describe("Measured activity details", () => {
  it("decodes actual samples, enhanced channels and recorded laps without location or identifiers", () => {
    const payload = stored().payload;
    new JsonSchemaPipe(ActivityDetailsPayloadSchema).transform(payload);
    expect(payload.sessions[0]?.records[1]?.metrics).toMatchObject({ heartRateBpm: 180, speedMps: 3, altitudeM: 100, cadenceRpm: 90, powerW: 150 });
    expect(payload.sessions[0]?.laps[0]).toMatchObject({ timerSeconds: 22, maximumHeartRateBpm: 180 });
    expect(JSON.stringify(payload)).not.toMatch(/position|serialNumber|manufacturer/);
  });

  it("weights irregular samples by covered active seconds, keeps the one-second peak and excludes gaps and pauses", () => {
    const result = projectActivityDetails({ activityId, bucketSeconds: 30, zoneBoundariesBpm: [130, 160] }, stored());
    new JsonSchemaPipe(ExternalActivityDetailsResultSchema).transform(result);
    const bucket = result.buckets[0]!;
    expect(bucket.activeSeconds).toBe(22);
    // 0–2 @100; 2–3 @180; 3–13 @120; 15–16 @140; 24–25 unknown after pause; 25–30 @160.
    expect(bucket.channels.heartRateBpm).toMatchObject({ minimum: 100, maximum: 180, coveredSeconds: 19 });
    expect(bucket.channels.heartRateBpm?.average).toBeCloseTo(2520 / 19);
    expect(bucket.zoneSeconds).toEqual([12, 1, 6]);
    expect(result.timerEventsAvailable).toBe(true);
  });

  it("distinguishes actual records and recorded laps from computed windows", () => {
    expect(projectActivityDetails({ activityId, mode: "records", fromElapsedSeconds: 2, toElapsedSeconds: 4 }, stored()).records.map((record) => record.metrics.heartRateBpm)).toEqual([180, 120]);
    expect(projectActivityDetails({ activityId, mode: "laps" }, stored()).laps[0]?.averageHeartRateBpm).toBe(130);
    expect(projectActivityDetails({ activityId }, stored()).zoneBasis).toBe("unavailable");
  });

  it("rejects corrupted FIT and invalid range or zone assumptions", () => {
    const damaged = activityFit(); damaged[damaged.length - 1]! ^= 1;
    expect(() => parseFitActivityDetails(damaged)).toThrow();
    expect(() => parseFitActivityDetails(new Uint8Array(2000001))).toThrow();
    expect(() => projectActivityDetails({ activityId, fromElapsedSeconds: 5, toElapsedSeconds: 4 }, stored())).toThrow();
    expect(() => projectActivityDetails({ activityId, zoneBoundariesBpm: [160, 130] }, stored())).toThrow();
    expect(projectActivityDetails({ activityId }, null).availability).toBe("not_imported");
    expect(projectActivityDetails({ activityId }, { ...stored(), payload: null }).availability).toBe("no_supported_data");
  });

  it("reports closed diagnosable reasons without raw decoder errors", () => {
    expect(() => parseFitActivityDetails(new Uint8Array(2000001))).toThrow(expect.objectContaining({ issue: "limit_exceeded" }));
    expect(() => parseFitActivityDetails(compressedActivityFit())).toThrow(expect.objectContaining({ issue: "unsupported_fit" }));
    expect(projectActivityDetails({ activityId }, null, "unsupported_fit")).toMatchObject({ availability: "unavailable", latestImportIssue: "unsupported_fit" });
    expect(projectActivityDetails({ activityId }, stored(), "invalid_fit")).toMatchObject({ availability: "available", latestImportIssue: "invalid_fit", detailsVersion: detailsId });
  });

  it("pins pagination to a version and query instead of silently mixing changed samples", () => {
    const version = stored(); version.payload.sessions[0]!.elapsedSeconds = 1000;
    const input = { activityId, bucketSeconds: 1 };
    const page = projectActivityDetails(input, version);
    expect(page.buckets).toHaveLength(200);
    expect(page.nextCursor).not.toBeNull();
    const next = projectActivityDetails({ ...input, cursor: page.nextCursor! }, version);
    expect(next.buckets[0]?.fromElapsedSeconds).toBe(200);
    expect(projectActivityDetails({ ...input, cursor: page.nextCursor! }, { ...version, id: activityId }).availability).toBe("version_changed");
    expect(() => projectActivityDetails({ ...input, mode: "records", cursor: page.nextCursor! }, version)).toThrow();
  });

  it("keeps sessions separate, retains zero-valued speed and does not fabricate missing HR or timer events", () => {
    const version = stored();
    const session = version.payload.sessions[0]!;
    const second = structuredClone(session);
    second.startTimestamp = "2026-10-04T15:00:00Z";
    second.sport = "cycling";
    second.timerEvents = [];
    for (const record of second.records) { record.metrics.heartRateBpm = null; record.metrics.speedMps = 0; }
    version.payload.sessions.push(second);
    const result = projectActivityDetails({ activityId, session: 1 }, version);
    expect(result.sessions.map((item) => item.sport)).toEqual(["running", "cycling"]);
    expect(result.timerEventsAvailable).toBe(false);
    expect(result.channels).not.toContain("heartRateBpm");
    expect(result.buckets[0]?.channels.heartRateBpm).toBeUndefined();
    expect(result.buckets[0]?.channels.speedMps?.average).toBe(0);
    expect(() => projectActivityDetails({ activityId, session: 2 }, version)).toThrow();
  });

  it("paginates exact records and recorded laps independently", () => {
    const version = stored();
    const session = version.payload.sessions[0]!;
    session.elapsedSeconds = 2000;
    const original = session.records[0]!;
    session.records = Array.from({ length: 1001 }, (_, elapsedSeconds) => ({ ...original, elapsedSeconds }));
    const query = { activityId, mode: "records" as const };
    const page = projectActivityDetails(query, version);
    expect(page.records).toHaveLength(1000);
    expect(projectActivityDetails({ ...query, cursor: page.nextCursor! }, version).records[0]?.elapsedSeconds).toBe(1000);
    session.laps = Array.from({ length: 201 }, (_, index) => ({ ...session.laps[0]!, startElapsedSeconds: index, endElapsedSeconds: index + 1 }));
    const lapQuery = { activityId, mode: "laps" as const };
    const laps = projectActivityDetails(lapQuery, version);
    expect(laps.laps).toHaveLength(200);
    expect(projectActivityDetails({ ...lapQuery, cursor: laps.nextCursor! }, version).laps).toHaveLength(1);
  });

  it("does not carry a pre-pause or paused sample into resumed activity before a new measurement", () => {
    const version = stored();
    const session = version.payload.sessions[0]!;
    session.elapsedSeconds = 20;
    const original = session.records[0]!;
    session.records = [0, 3, 10, 20].map((elapsedSeconds) => ({ ...original, elapsedSeconds }));
    session.timerEvents = [{ elapsedSeconds: 2, active: false }, { elapsedSeconds: 4, active: true }];
    const result = projectActivityDetails({ activityId, bucketSeconds: 10 }, version);
    expect(result.buckets[0]?.activeSeconds).toBe(8);
    expect(result.buckets[0]?.channels.heartRateBpm?.coveredSeconds).toBe(2);
    expect(result.buckets[1]?.channels.heartRateBpm?.coveredSeconds).toBe(10);
  });

  it("retains an exact final measured peak without extrapolating its duration or average", () => {
    const version = stored();
    version.payload.sessions[0]!.records.at(-1)!.metrics.heartRateBpm = 220;
    const result = projectActivityDetails({ activityId, bucketSeconds: 30 }, version);
    expect(result.buckets[0]?.channels.heartRateBpm).toMatchObject({ maximum: 220, coveredSeconds: 19, average: 2520 / 19 });
  });
});
