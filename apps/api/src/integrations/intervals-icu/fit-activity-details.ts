import { Decoder, Stream } from "@garmin/fitsdk";
import type { ActivityDetailsPayload, ActivityMetrics } from "@shape-of-you/contracts";
import { ActivityDetailsReadError } from "../provider.js";

/** Stable interpretation of standard FIT channels; independent of Recovery Time private mapping. */
export const activityDetailsNormalizationVersion = "standard-fit-details-v1";

type Message = Record<string, unknown>;
const channels: Record<keyof ActivityMetrics, readonly [string, number, number]> = {
  heartRateBpm: ["heartRate", 1, 300], speedMps: ["speed", 0, 150], distanceM: ["distance", 0, 10000000],
  cadenceRpm: ["cadence", 0, 500], powerW: ["power", 0, 10000], altitudeM: ["altitude", -1000, 20000],
  temperatureC: ["temperature", -100, 100], respirationPerMinute: ["respirationRate", 0, 200],
  verticalOscillationMm: ["verticalOscillation", 0, 1000], stanceTimeMs: ["stanceTime", 0, 5000], stepLengthMm: ["stepLength", 0, 10000]
};

/** Validates a bounded activity FIT and projects only supported measurements, never routes or raw fields.
 * Throws a sanitized provider error for invalid CRC, malformed sessions, or exceeded limits.
 */
export function parseFitActivityDetails(file: Uint8Array): ActivityDetailsPayload {
  try {
    if (file.length > 2000000) limit();
    const decoder = new Decoder(Stream.fromByteArray(file));
    if (!decoder.isFIT() || !decoder.checkIntegrity()) invalid();
    let count = 0;
    const decoded = decoder.read({ includeUnknownData: false, mesgListener: () => { if (++count > 240000) limit(); } });
    if (decoded.errors.some((error) => error.message.includes("compressed timestamp"))) throw new ActivityDetailsReadError("unsupported_fit");
    if (count > 240000) limit();
    if (decoded.errors.length) invalid();
    const messages = decoded.messages as unknown as Record<string, Message[]>;
    // SDK component expansion can replace explicit enhanced values with legacy fields.
    // Preserve explicitly recorded precision while retaining SDK component/HR merging.
    const explicit = new Decoder(Stream.fromByteArray(file)).read({ expandComponents: false, mergeHeartRates: false, includeUnknownData: false });
    if (explicit.errors.length) invalid();
    const explicitMessages = explicit.messages as unknown as Record<string, Message[]>;
    for (const key of ["recordMesgs", "lapMesgs", "sessionMesgs"]) {
      const originals = explicitMessages[key] ?? [];
      for (const [index, message] of (messages[key] ?? []).entries()) {
        const original = originals[index];
        if (!original || time(message.timestamp) !== time(original.timestamp)) invalid();
        for (const field of ["enhancedSpeed", "enhancedAltitude", "enhancedAvgSpeed", "enhancedMaxSpeed", "enhancedRespirationRate"])
          if (typeof original[field] === "number") message[field] = original[field];
      }
    }
    if (messages.fileIdMesgs?.[0]?.type !== "activity") invalid();
    const records = messages.recordMesgs ?? [];
    const laps = messages.lapMesgs ?? [];
    const events = (messages.eventMesgs ?? []).filter((event) => event.event === "timer");
    if (records.length > 200000 || laps.length > 10000 || events.length > 10000) limit();
    const dated = records.map((record) => ({ record, at: time(record.timestamp) }))
      .filter((item): item is { record: Message; at: number } => item.at !== null).sort((a, b) => a.at - b.at);
    let sessions = messages.sessionMesgs ?? [];
    if (!sessions.length && dated.length) sessions = [{ startTime: new Date(dated[0]!.at), timestamp: new Date(dated.at(-1)!.at) }];
    if (sessions.length > 100) limit();
    const ranges = sessions.map((session) => {
      const start = time(session.startTime);
      if (start === null) invalid();
      const elapsed = number(session.totalElapsedTime, 0, 604800);
      const end = elapsed === null ? time(session.timestamp) : start + elapsed * 1000;
      if (end === null || end < start || end - start > 604800000) invalid();
      return { session, start, end };
    }).sort((a, b) => a.start - b.start);
    for (let i = 1; i < ranges.length; i++) if (ranges[i]!.start < ranges[i - 1]!.end) invalid();
    return { sessions: ranges.map(({ session, start, end }, index) => {
      const include = (at: number) => at >= start && (at < end || (at === end && ranges[index + 1]?.start !== end));
      return {
        startTimestamp: new Date(start).toISOString(), elapsedSeconds: (end - start) / 1000,
        timerSeconds: number(session.totalTimerTime, 0, 604800), sport: typeof session.sport === "string" ? session.sport.slice(0, 64) : null,
        records: dated.filter(({ at }) => include(at)).map(({ record, at }) => ({
          timestamp: new Date(at).toISOString(), elapsedSeconds: (at - start) / 1000, metrics: metrics(record)
        })),
        laps: laps.flatMap((lap) => {
          const lapStart = time(lap.startTime), lapEnd = time(lap.timestamp);
          if (lapStart === null || lapEnd === null || lapStart < start || lapEnd > end || lapEnd < lapStart) return [];
          return [{ startElapsedSeconds: (lapStart - start) / 1000, endElapsedSeconds: (lapEnd - start) / 1000,
            timerSeconds: number(lap.totalTimerTime, 0, 604800), distanceM: number(lap.totalDistance, 0, 10000000),
            averageHeartRateBpm: number(lap.avgHeartRate, 1, 300), maximumHeartRateBpm: number(lap.maxHeartRate, 1, 300),
            averageSpeedMps: number(lap.enhancedAvgSpeed ?? lap.avgSpeed, 0, 150), averagePowerW: number(lap.avgPower, 0, 10000) }];
        }),
        timerEvents: events.flatMap((event) => {
          const at = time(event.timestamp);
          if (at === null || at < start || at > end) return [];
          if (event.eventType === "start") return [{ elapsedSeconds: (at - start) / 1000, active: true }];
          if (["stop", "stopAll", "stopDisable", "stopDisableAll"].includes(String(event.eventType)))
            return [{ elapsedSeconds: (at - start) / 1000, active: false }];
          return [];
        }).sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)
      };
    }) };
  } catch (error) { if (error instanceof ActivityDetailsReadError) throw error; return invalid(); }
}

function metrics(record: Message): ActivityMetrics {
  return Object.fromEntries(Object.entries(channels).map(([key, [field, minimum, maximum]]) => {
    const value = key === "speedMps" ? record.enhancedSpeed ?? record.speed
      : key === "altitudeM" ? record.enhancedAltitude ?? record.altitude
      : key === "respirationPerMinute" ? record.enhancedRespirationRate ?? record.respirationRate
      : key === "cadenceRpm" && typeof record.cadence === "number" ? record.cadence + (number(record.fractionalCadence, 0, 1) ?? 0)
      : record[field];
    return [key, number(value, minimum, maximum)];
  })) as ActivityMetrics;
}
function number(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}
function time(value: unknown): number | null {
  return value instanceof Date && Number.isFinite(value.valueOf()) ? value.valueOf() : null;
}
function invalid(): never { throw new ActivityDetailsReadError("invalid_fit"); }
function limit(): never { throw new ActivityDetailsReadError("limit_exceeded"); }
