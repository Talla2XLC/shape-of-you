import { createHash } from "node:crypto";
import type { CutoverRecord } from "../storage/integration-cutover-repository.js";

/** Minimal versioned external restore authority; contains local references and bounds, never secrets or health values. */
export interface IntegrationCutoverRestorePolicy {
  readonly formatVersion: 1;
  readonly id: string;
  readonly personId: string;
  readonly sourceProvider: "intervals_icu";
  readonly targetProvider: "garmin_personal";
  readonly state: CutoverRecord["state"];
  readonly version: number;
  readonly restoreSuppressed: boolean;
  readonly createdAt: string;
  readonly startsOn: string;
  readonly timezone: string;
  readonly startsAt: string;
  readonly sourceDrainsUntil: string;
  readonly activatedAt: string | null;
  readonly sourceConnectionId: string | null;
  readonly targetConnectionId: string | null;
  readonly sourceRecoveryConnectionId: string | null;
  readonly targetRecoveryConnectionId: string | null;
  readonly sourceConsentId: string | null;
  readonly targetConsentId: string | null;
  readonly capabilityVersion: string;
  readonly acceptedCoverageGaps: readonly string[];
}
const fields = ["formatVersion","id","personId","sourceProvider","targetProvider","state","version","restoreSuppressed","createdAt","startsOn","timezone","startsAt","sourceDrainsUntil","activatedAt","sourceConnectionId","targetConnectionId","sourceRecoveryConnectionId","targetRecoveryConnectionId","sourceConsentId","targetConsentId","capabilityVersion","acceptedCoverageGaps"].sort().join();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const gaps = new Set(["recovery.hrv_rmssd","recovery.sleep_score","training.normalized_load","training.device_attribution","training.original_fit"]);

/** Validates a strict bounded journal payload before it can affect restored import authority. */
export function parseIntegrationCutoverRestorePolicy(value: unknown): IntegrationCutoverRestorePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid cutover restore policy");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== fields || JSON.stringify(value).length > 4096 || record.formatVersion !== 1 || record.sourceProvider !== "intervals_icu" || record.targetProvider !== "garmin_personal") throw new Error("Invalid cutover restore policy shape");
  for (const key of ["id","personId","sourceConnectionId","targetConnectionId","sourceRecoveryConnectionId","targetRecoveryConnectionId","sourceConsentId","targetConsentId"]) {
    if (record[key] === null && key !== "id" && key !== "personId") continue;
    if (typeof record[key] !== "string" || !uuid.test(record[key] as string)) throw new Error("Invalid cutover restore reference");
  }
  if (typeof record.restoreSuppressed !== "boolean" || !["scheduled","draining","active","failed","cancelled"].includes(String(record.state)) || !Number.isSafeInteger(record.version) || Number(record.version) < 1) throw new Error("Invalid cutover restore lifecycle");
  if (typeof record.startsOn !== "string" || !/^\d{4}-\d\d-\d\d$/.test(record.startsOn)) throw new Error("Invalid cutover restore date");
  for (const key of ["startsAt","sourceDrainsUntil","activatedAt","createdAt"]) {
    if (key === "activatedAt" && record[key] === null) continue;
    if (typeof record[key] !== "string" || new Date(record[key] as string).toISOString() !== record[key]) throw new Error("Invalid cutover restore instant");
  }
  if (String(record.sourceDrainsUntil) <= String(record.startsAt) || (["draining","active"].includes(String(record.state)) !== (record.activatedAt !== null))) throw new Error("Invalid cutover restore bounds");
  if (typeof record.timezone !== "string" || !record.timezone || record.timezone.length > 64 || typeof record.capabilityVersion !== "string" || !record.capabilityVersion || record.capabilityVersion.length > 128) throw new Error("Invalid cutover restore metadata");
  try { new Intl.DateTimeFormat("en", { timeZone: record.timezone }).format(); } catch { throw new Error("Invalid cutover restore timezone"); }
  if (!Array.isArray(record.acceptedCoverageGaps) || record.acceptedCoverageGaps.length > 5 || record.acceptedCoverageGaps.some((gap) => typeof gap !== "string" || !gaps.has(gap)) || new Set(record.acceptedCoverageGaps).size !== record.acceptedCoverageGaps.length) throw new Error("Invalid cutover restore capabilities");
  return record as unknown as IntegrationCutoverRestorePolicy;
}

/** Serializes only the explicitly allowed immutable authority fields into the independent journal. */
export function integrationCutoverRestorePolicy(row: CutoverRecord): IntegrationCutoverRestorePolicy {
  return parseIntegrationCutoverRestorePolicy({ formatVersion: 1, id: row.id, personId: row.personId, sourceProvider: row.sourceProvider, targetProvider: row.targetProvider, state: row.state, version: row.version, restoreSuppressed: row.restoreSuppressed, createdAt: row.createdAt.toISOString(),
    startsOn: row.startsOn, timezone: row.timezone, startsAt: row.startsAt.toISOString(), sourceDrainsUntil: row.sourceDrainsUntil.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null, sourceConnectionId: row.sourceConnectionId, targetConnectionId: row.targetConnectionId,
    sourceRecoveryConnectionId: row.sourceRecoveryConnectionId, targetRecoveryConnectionId: row.targetRecoveryConnectionId,
    sourceConsentId: row.sourceConsentId, targetConsentId: row.targetConsentId, capabilityVersion: row.capabilityVersion, acceptedCoverageGaps: [...row.acceptedCoverageGaps].sort() });
}

/** Binds the immutable policy acknowledged by a durable seal, independently of state, CAS, or credential rotation. */
export function immutableCutoverPolicyHash(row: Pick<CutoverRecord, "id" | "personId" | "sourceProvider" | "targetProvider" | "startsOn" | "timezone" | "startsAt" | "sourceDrainsUntil" | "capabilityVersion" | "acceptedCoverageGaps">): string {
  return createHash("sha256").update(JSON.stringify({ formatVersion: 1, id: row.id, personId: row.personId,
    sourceProvider: row.sourceProvider, targetProvider: row.targetProvider, startsOn: row.startsOn,
    timezone: row.timezone, startsAt: row.startsAt.toISOString(), sourceDrainsUntil: row.sourceDrainsUntil.toISOString(),
    capabilityVersion: row.capabilityVersion, acceptedCoverageGaps: [...row.acceptedCoverageGaps].sort() })).digest("hex");
}
