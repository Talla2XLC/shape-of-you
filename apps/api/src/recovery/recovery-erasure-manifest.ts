import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";

import type { Pool } from "pg";

import type { RecoveryErasureMarker } from "../storage/recovery-repository.js";

interface RecoveryErasureManifestPayload {
  readonly version: 1;
  readonly generatedAt: string;
  readonly completeThrough: string;
  readonly markers: readonly RecoveryErasureMarker[];
}

/** Immutable, integrity-checked export stored outside restorable database snapshots. */
export interface RecoveryErasureManifest extends RecoveryErasureManifestPayload {
  readonly sha256: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/;

function checksum(payload: RecoveryErasureManifestPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function exactDate(value: unknown, name: string): string {
  if (typeof value !== "string" || Number.isNaN(new Date(value).valueOf())) {
    throw new Error(`${name} must be an ISO date-time`);
  }
  return new Date(value).toISOString();
}

function exactUuid(value: unknown, name: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }
  return value;
}

function parseMarker(value: unknown): RecoveryErasureMarker {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recovery erasure marker must be an object");
  }
  const marker = value as Record<string, unknown>;
  if (Object.keys(marker).sort().join(",") !== "connectionId,id,personId,reason,requestedAt") {
    throw new Error("Recovery erasure marker has an unexpected shape");
  }
  if (marker.reason !== "user_request" && marker.reason !== "retention_expired") {
    throw new Error("Recovery erasure marker reason is invalid");
  }
  return {
    id: exactUuid(marker.id, "marker.id"),
    personId: exactUuid(marker.personId, "marker.personId"),
    connectionId: exactUuid(marker.connectionId, "marker.connectionId"),
    reason: marker.reason,
    requestedAt: exactDate(marker.requestedAt, "marker.requestedAt")
  };
}

/** Captures every accepted erasure marker in one read-only database snapshot. */
export async function exportRecoveryErasureManifest(
  pool: Pool,
  clock: () => Date = () => new Date()
): Promise<RecoveryErasureManifest> {
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const cutoffResult = await client.query<{ cutoff: Date }>(
      "select transaction_timestamp() as cutoff"
    );
    const cutoff = cutoffResult.rows[0]?.cutoff;
    if (!cutoff) throw new Error("Could not establish erasure manifest completeness boundary");
    const result = await client.query<{
      id: string;
      person_id: string;
      connection_id: string;
      reason: "user_request" | "retention_expired";
      requested_at: Date;
    }>(
      `select id, person_id, connection_id, reason, requested_at
         from recovery_erasure_requests
        where requested_at <= $1
        order by requested_at, id`,
      [cutoff]
    );
    await client.query("commit");
    const payload: RecoveryErasureManifestPayload = {
      version: 1,
      generatedAt: clock().toISOString(),
      completeThrough: cutoff.toISOString(),
      markers: result.rows.map((row) => ({
        id: row.id,
        personId: row.person_id,
        connectionId: row.connection_id,
        reason: row.reason,
        requestedAt: row.requested_at.toISOString()
      }))
    };
    return { ...payload, sha256: checksum(payload) };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Writes a new mode-0600 manifest and refuses to replace prior evidence. */
export async function writePrivateRecoveryErasureManifest(
  path: string,
  manifest: RecoveryErasureManifest
): Promise<void> {
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
}

/** Reads, validates and integrity-checks one private erasure manifest. */
export async function readPrivateRecoveryErasureManifest(
  path: string
): Promise<RecoveryErasureManifest> {
  const metadata = await stat(path);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Recovery erasure manifest must be a regular mode-0600 file");
  }
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Recovery erasure manifest must be an object");
  }
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort().join(",") !== "completeThrough,generatedAt,markers,sha256,version") {
    throw new Error("Recovery erasure manifest has an unexpected shape");
  }
  if (root.version !== 1 || !Array.isArray(root.markers)) {
    throw new Error("Unsupported Recovery erasure manifest version or markers");
  }
  const payload: RecoveryErasureManifestPayload = {
    version: 1,
    generatedAt: exactDate(root.generatedAt, "generatedAt"),
    completeThrough: exactDate(root.completeThrough, "completeThrough"),
    markers: root.markers.map(parseMarker)
  };
  if (typeof root.sha256 !== "string" || !sha256Pattern.test(root.sha256)) {
    throw new Error("Recovery erasure manifest checksum is invalid");
  }
  if (checksum(payload) !== root.sha256) {
    throw new Error("Recovery erasure manifest checksum does not match");
  }
  for (let index = 1; index < payload.markers.length; index += 1) {
    const previous = payload.markers[index - 1]!;
    const current = payload.markers[index]!;
    if (`${previous.requestedAt}:${previous.id}` >= `${current.requestedAt}:${current.id}`) {
      throw new Error("Recovery erasure manifest markers are not uniquely ordered");
    }
  }
  return { ...payload, sha256: root.sha256 };
}

/** Rejects a restore when the independent manifest does not cover the required boundary. */
export function assertRecoveryErasureManifestComplete(
  manifest: RecoveryErasureManifest,
  requiredThrough: string
): void {
  const required = exactDate(requiredThrough, "requiredThrough");
  if (manifest.completeThrough < required) {
    throw new Error("Recovery erasure manifest is incomplete for the required restore boundary");
  }
}
