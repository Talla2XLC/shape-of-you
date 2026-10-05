import { createHash } from "node:crypto";
import type { ActivityDetailsPayload, ActivityDetailsIssue, ActivityMetrics, ExternalActivityDetailsResult, GetExternalActivityDetails } from "@shape-of-you/contracts";
import type { StoredActivityDetails } from "../storage/training-repository.js";
import { DomainValidationError } from "../domain/errors.js";

type Session = ActivityDetailsPayload["sessions"][number];
type Bucket = ExternalActivityDetailsResult["buckets"][number];
type Cursor = { version: string; query: string; offset: number };

/** Projects one pinned immutable version into bounded measured records, laps, or time-weighted buckets.
 * Explicit zone bounds are analysis inputs. Gaps beyond ten seconds remain unknown; pauses are excluded.
 * Throws DomainValidationError for invalid ranges, session selection, or foreign query cursors.
 */
export function projectActivityDetails(input: GetExternalActivityDetails, stored: StoredActivityDetails | null, latestImportIssue: ActivityDetailsIssue | null = null): ExternalActivityDetailsResult {
  const sessionIndex = input.session ?? 0;
  const result: ExternalActivityDetailsResult = {
    availability: stored ? stored.payload ? "available" : "no_supported_data" : latestImportIssue ? "unavailable" : "not_imported", latestImportIssue, activityId: input.activityId,
    detailsVersion: stored?.id ?? null, sourceActivityVersion: stored?.sourceActivityVersion ?? null,
    normalizationVersion: stored?.normalizationVersion ?? null, source: "intervals_icu_original_fit",
    fileChecksum: stored?.fileChecksum ?? null, importedAt: stored?.importedAt.toISOString() ?? null,
    sessions: stored?.payload?.sessions.map((session, index) => ({ index, startTimestamp: session.startTimestamp,
      elapsedSeconds: session.elapsedSeconds, timerSeconds: session.timerSeconds, sport: session.sport,
      recordCount: session.records.length, lapCount: session.laps.length })) ?? [],
    session: sessionIndex, records: [], buckets: [], laps: [], nextCursor: null, zoneBasis: input.zoneBoundariesBpm ? "analysis_supplied" : "unavailable",
    channels: [], coveragePolicy: "previous_record_max_10s_active_only_v1", timerEventsAvailable: false
  };
  const zones = input.zoneBoundariesBpm;
  if (zones?.some((bound, index) => index > 0 && bound <= zones[index - 1]!)) invalid("Zone boundaries must be strictly increasing");
  const from = input.fromElapsedSeconds ?? 0;
  if (input.toElapsedSeconds !== undefined && input.toElapsedSeconds <= from) invalid("Detail range must have positive duration");
  const query = Object.fromEntries(Object.entries(input).filter(([key]) => key !== "cursor").sort(([a], [b]) => a.localeCompare(b)));
  const fingerprint = createHash("sha256").update(JSON.stringify(query)).digest("hex");
  let offset = 0;
  if (input.cursor) {
    let cursor: Cursor;
    try { cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")) as Cursor; } catch { return invalid("Invalid activity detail cursor"); }
    if (cursor.query !== fingerprint || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) invalid("Cursor belongs to another detail query");
    if (cursor.version !== stored?.id) return { ...result, availability: "version_changed" };
    offset = cursor.offset;
  }
  if (!stored?.payload) return result;
  const session = stored.payload.sessions[sessionIndex];
  if (!session) invalid("Activity session was not found");
  const to = Math.min(input.toElapsedSeconds ?? session.elapsedSeconds, session.elapsedSeconds);
  if (from > session.elapsedSeconds) invalid("Detail range is outside this session");
  result.timerEventsAvailable = session.timerEvents.length > 0;
  result.channels = [...new Set(session.records.flatMap((record) => Object.entries(record.metrics).filter(([, value]) => value !== null).map(([key]) => key)))];
  const mode = input.mode ?? "buckets";
  let count: number, pageSize: number;
  if (mode === "records") {
    const records = session.records.filter((record) => record.elapsedSeconds >= from && (record.elapsedSeconds < to || (to === session.elapsedSeconds && record.elapsedSeconds === to)));
    count = records.length; pageSize = 1000; result.records = records.slice(offset, offset + pageSize);
  } else if (mode === "laps") {
    const laps = session.laps.filter((lap) => lap.endElapsedSeconds > from && lap.startElapsedSeconds < to);
    count = laps.length; pageSize = 200; result.laps = laps.slice(offset, offset + pageSize);
  } else {
    const width = input.bucketSeconds ?? 60;
    count = Math.ceil((to - from) / width); pageSize = 200;
    result.buckets = buckets(session, from, to, width, offset, pageSize, zones);
  }
  if (offset > count) invalid("Cursor is outside this detail page");
  if (offset + pageSize < count) result.nextCursor = Buffer.from(JSON.stringify({ version: stored.id, query: fingerprint, offset: offset + pageSize })).toString("base64url");
  return result;
}

function buckets(session: Session, from: number, to: number, width: number, offset: number, limit: number, zones?: readonly number[]): Bucket[] {
  const result: Bucket[] = [];
  const active = activeIntervals(session);
  const stops = session.timerEvents.filter((event) => !event.active).map((event) => event.elapsedSeconds);
  for (let i = offset; i < Math.min(Math.ceil((to - from) / width), offset + limit); i++) {
    const start = from + i * width, end = Math.min(to, start + width);
    result.push({ fromElapsedSeconds: start, toElapsedSeconds: end,
      activeSeconds: active.reduce((sum, [a, b]) => sum + overlap(start, end, a, b), 0), channels: {}, zoneSeconds: zones ? Array(zones.length + 1).fill(0) as number[] : null });
  }
  if (!result.length) return result;
  const pageStart = result[0]!.fromElapsedSeconds, pageEnd = result.at(-1)!.toElapsedSeconds;
  for (let i = 0; i < session.records.length; i++) {
    const record = session.records[i]!;
    const start = record.elapsedSeconds;
    const activeAtSample = activeDuration(active, start, start + 0.000001) > 0;
    const end = activeAtSample ? Math.min(session.elapsedSeconds, session.records[i + 1]?.elapsedSeconds ?? start, start + 10, firstStop(stops, start)) : start;
    const finalEndpoint = start === session.elapsedSeconds && pageEnd === session.elapsedSeconds;
    if (end < pageStart || start > pageEnd || (start === pageEnd && !finalEndpoint)) continue;
    const firstBucket = Math.min(result.length - 1, Math.max(0, Math.floor((start - pageStart) / width)));
    const lastBucket = Math.min(result.length - 1, Math.floor((end - pageStart) / width));
    for (let bucketIndex = firstBucket; bucketIndex <= lastBucket; bucketIndex++) {
      const bucket = result[bucketIndex]!;
      if (end < bucket.fromElapsedSeconds || start > bucket.toElapsedSeconds || (start === bucket.toElapsedSeconds && !finalEndpoint)) continue;
      const seconds = activeDuration(active, Math.max(start, bucket.fromElapsedSeconds), Math.min(end, bucket.toElapsedSeconds));
      const pointInBucket = start >= bucket.fromElapsedSeconds && ((start < bucket.toElapsedSeconds && activeAtSample)
        || (finalEndpoint && start === bucket.toElapsedSeconds && active.at(-1)?.[1] === start));
      if (!seconds && !pointInBucket) continue;
      for (const [key, value] of Object.entries(record.metrics) as [keyof ActivityMetrics, number | null][]) {
        if (value === null) continue;
        const stat = bucket.channels[key] ??= { average: null, minimum: null, maximum: null, coveredSeconds: 0 };
        stat.minimum = stat.minimum === null ? value : Math.min(value, stat.minimum);
        stat.maximum = stat.maximum === null ? value : Math.max(value, stat.maximum);
        if (seconds > 0) {
          stat.average = ((stat.average ?? 0) * stat.coveredSeconds + value * seconds) / (stat.coveredSeconds + seconds);
          stat.coveredSeconds += seconds;
        }
      }
      if (bucket.zoneSeconds && zones && record.metrics.heartRateBpm !== null) {
        const zone = zones.findIndex((boundary) => record.metrics.heartRateBpm! < boundary);
        bucket.zoneSeconds[zone < 0 ? zones.length : zone]! += seconds;
      }
    }
  }
  return result;
}
function activeIntervals(session: Session): [number, number][] {
  const intervals: [number, number][] = [];
  let active = true, start = 0;
  for (const event of session.timerEvents) {
    if (active && !event.active) intervals.push([start, event.elapsedSeconds]);
    if (!active && event.active) start = event.elapsedSeconds;
    active = event.active;
  }
  if (active) intervals.push([start, session.elapsedSeconds]);
  return intervals.filter(([a, b]) => b > a);
}
function activeDuration(intervals: readonly [number, number][], from: number, to: number): number {
  let low = 0, high = intervals.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (intervals[middle]![1] <= from) low = middle + 1; else high = middle;
  }
  let seconds = 0;
  for (let i = low; i < intervals.length && intervals[i]![0] < to; i++) seconds += overlap(from, to, ...intervals[i]!);
  return seconds;
}
function firstStop(stops: readonly number[], from: number): number {
  let low = 0, high = stops.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (stops[middle]! < from) low = middle + 1; else high = middle;
  }
  return stops[low] ?? Number.POSITIVE_INFINITY;
}
function overlap(a: number, b: number, c: number, d: number): number { return Math.max(0, Math.min(b, d) - Math.max(a, c)); }
function invalid(message: string): never { throw new DomainValidationError(message); }
