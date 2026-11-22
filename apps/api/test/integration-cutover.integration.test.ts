import { exportRecoveryErasureManifest } from "../src/recovery/recovery-erasure-manifest.js";
import { RecoveryErasureJournal } from "../src/recovery/recovery-erasure-journal.js";
import { synchronizeRecoveryErasureJournal, applyRecoveryErasureJournal } from "../src/recovery/recovery-erasure-journal-sync.js";
import { immutableCutoverPolicyHash, integrationCutoverRestorePolicy } from "../src/recovery/integration-cutover-restore-policy.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@shape-of-you/config";
import type { CreateRecoveryObservation, GarminPersonalConnection } from "@shape-of-you/contracts";
import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { IntegrationRepository } from "../src/storage/integration-repository.js";
import { IntegrationCutoverRepository, CutoverJournalProofRequiredError, type CutoverRecord, type ScheduleCutoverInput } from "../src/storage/integration-cutover-repository.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";
import { TrainingRepository, type ImportExternalActivity } from "../src/storage/training-repository.js";
import { ConnectionCredentialCipher } from "../src/integrations/credential-cipher.js";

const directories: string[] = [];
import { trackPoolShutdown } from "./support/pool-shutdown.js";

let closePool: (() => Promise<void>) | undefined;
let database: DatabaseContext;
let container: StartedPostgreSqlContainer | undefined;
const cipher = new ConnectionCredentialCipher("synthetic", new Map([["synthetic", randomBytes(32)]]));
beforeAll(async () => {
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = randomUUID();
  let url = process.env.TASK0181_TEST_DATABASE_URL;
  if (url) {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" || parsed.port !== "55481" || !parsed.pathname.startsWith("/soy_task0181_")) throw new Error("Only isolated TASK-0181 PostgreSQL is allowed");
  } else {
    container = await new PostgreSqlContainer("postgres:17-alpine").withDatabase("soy_task0181_policy").start();
    url = container.getConnectionUri();
  }
  await runMigrations(url);
  await runMigrations(url);
  database = createDatabase(loadConfig({ NODE_ENV: "test", PERSON_CONTEXT_MODE: "synthetic", SYNTHETIC_PERSON_ID: randomUUID(), DATABASE_URL: url }));
  closePool = trackPoolShutdown(database.pool);
});
afterAll(async () => { await closePool?.(); await container?.stop(); await Promise.all(directories.map(path => rm(path, {recursive:true,force:true}))); });
beforeEach(async () => { await database.pool.query("update integration_connections set next_attempt_at=now()+interval '1 day'"); });

async function fixture(zone = "UTC") {
  const personId = randomUUID();
  await database.pool.query("insert into persons(id,kind,timezone) values($1,'synthetic',$2)", [personId, zone]);
  const sourceStore = new IntegrationRepository(database);
  const sourceId = randomUUID(), sourceRecoveryId = randomUUID(), sourceConsentId = randomUUID();
  await sourceStore.activate({ id: sourceId, personId, recoveryConnectionId: sourceRecoveryId, consentId: sourceConsentId, externalUserId: "synthetic-athlete", credential: cipher.encrypt("synthetic-source-token", `intervals_icu:${personId}:${sourceId}`), authorizationStartedAt: new Date() });
  const cutovers = new IntegrationCutoverRepository(database);
  const preview = await cutovers.preview(personId);
  const targetConnectionId = randomUUID(), targetRecoveryConnectionId = randomUUID(), targetConsentId = randomUUID();
  const input: ScheduleCutoverInput = { startsOn: preview.startsOn, expectedRevision: preview.expectedRevision, dedupeKey: randomUUID(), targetConnectionId, targetRecoveryConnectionId, targetConsentId,
    credential: cipher.encrypt("synthetic-target-key", `garmin_personal:${personId}:${targetConnectionId}`), externalUserId: null, capabilityVersion: "synthetic-v1", acceptedCoverageGaps: [] };
  return { personId, sourceStore, sourceId, sourceRecoveryId, sourceConsentId, cutovers, preview, input,
    targetStore: new IntegrationRepository<GarminPersonalConnection>(database, "garmin_personal") };
}
async function sealPolicies() {
  const dir = await mkdtemp(join(tmpdir(), "soy-task0181-journal-")); directories.push(dir);
  const journalPath = join(dir, "live.sqlite");
  const checkpointPath = join(dir, "checkpoint.sqlite");
  const journal = await RecoveryErasureJournal.create(journalPath); journal.close();
  await synchronizeRecoveryErasureJournal(database.pool, journalPath, checkpointPath);
  return { journalPath, checkpointPath };
}
async function activateWithJournal(f: Awaited<ReturnType<typeof fixture>>, row: CutoverRecord) {
  await sealPolicies();
  return f.cutovers.activate(row.id, row.version);
}
function previous(date: string): string { return new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10); }
function observation(connectionId: string, consentId: string, date: string): CreateRecoveryObservation {
  return { kind: "metric", observedFrom: null, observedUntil: null, localDate: date, temporalPrecision: "local_date", timezone: "UTC", quality: "reliable", connectionId, consentId, dedupeKey: randomUUID(),
    sourceReference: { channel: "account", externalSystem: "intervals_icu", externalRecordId: randomUUID(), occurredAt: null },
    detail: { type: "metric", metric: "resting_heart_rate", value: 51, unit: "bpm" } };
}
function activity(personId: string, connectionId: string, consentId: string, occurredAt: string): ImportExternalActivity {
  return { personId, connectionId, consentId, providerIdentity: randomUUID(), normalizedChecksum: randomUUID(), occurredAt, localDate: occurredAt.slice(0, 10), timezone: "UTC", name: "Synthetic run", durationSeconds: 60, distanceMeters: null, trainingLoad: null, trainingLoadBasis: null, trainingLoadBasisVersion: null, averageHeartRate: null, maximumHeartRate: null, deviceName: null, sourceProvider: "intervals_icu", garminAttributed: false };
}

describe("future-only Garmin cutover persistence", () => {
  it("does not let manual sync bypass scheduled or restore-suppressed target authority", async () => {
    const f = await fixture();
    const row = await f.cutovers.schedule(f.personId, f.input);
    expect(await f.targetStore.requestSync(f.personId)).toBe(false);
    await database.pool.query("update integration_cutovers set restore_suppressed=true where id=$1", [row.id]);
    expect(await f.targetStore.requestSync(f.personId)).toBe(false);
    const status = await f.targetStore.status(f.personId);
    if (status) expect(status.sync.state).toBe("blocked");
  });
  it("refuses legacy manifest export for any cutover policy, including cancelled schedules", async () => {
    const f = await fixture();
    const row = await f.cutovers.schedule(f.personId, f.input);
    await expect(exportRecoveryErasureManifest(database.pool)).rejects.toThrow("sealed version-2 erasure journal");
    await f.cutovers.cancel(f.personId, row.version, "synthetic cancelled schedule");
    await expect(exportRecoveryErasureManifest(database.pool)).rejects.toThrow("sealed version-2 erasure journal");
  });

  it("schedules encrypted pending access without stopping source or creating domain facts; retries same intent", async () => {
    const f = await fixture();
    const row = await f.cutovers.schedule(f.personId, f.input);
    expect(row).toMatchObject({ state: "scheduled", startsOn: f.preview.startsOn, version: 1 });
    expect(await f.cutovers.schedule(f.personId, f.input)).toMatchObject({ id: row.id, version: 1 });
    expect(await f.sourceStore.findActive(f.personId)).not.toBeNull();
    expect(await f.targetStore.findActive(f.personId)).toBeNull();
    expect(await f.cutovers.pendingTarget(f.personId)).toMatchObject({ id: f.input.targetConnectionId });
    expect((await database.pool.query("select count(*) from recovery_observations where person_id=$1", [f.personId])).rows[0].count).toBe("0");
    await expect(f.cutovers.schedule(f.personId, { ...f.input, startsOn: "2099-01-01" })).rejects.toThrow();
  });

  it("rejects stale structural preview but not ordinary source sync timestamps", async () => {
    const f = await fixture();
    await f.sourceStore.markSyncSucceeded(f.sourceId, f.sourceConsentId, false);
    await expect(f.cutovers.schedule(f.personId, f.input)).resolves.toMatchObject({ state: "scheduled" });
    const g = await fixture();
    await database.pool.query("update persons set timezone='Europe/Moscow' where id=$1", [g.personId]);
    await expect(g.cutovers.schedule(g.personId, g.input)).rejects.toThrow();
    expect(await g.cutovers.find(g.personId)).toBeNull();
  });

  it("guards scheduled receipts and final Recovery/Training writes by source date and parent UTC start", async () => {
    const f = await fixture();
    await f.cutovers.schedule(f.personId, f.input);
    const oldDate = previous(f.preview.startsOn);
    expect(await f.sourceStore.recordInbox(f.sourceId, f.sourceConsentId, "wellness", f.preview.startsOn, "checksum", { localDate: f.preview.startsOn })).toEqual({ state: "stale_generation" });
    expect(await f.sourceStore.recordInbox(f.sourceId, f.sourceConsentId, "wellness", oldDate, "checksum", { localDate: oldDate })).toMatchObject({ state: "process" });
    const recovery = new RecoveryRepository(database);
    await expect(recovery.createObservation(f.personId, observation(f.sourceRecoveryId, f.sourceConsentId, f.preview.startsOn))).rejects.toThrow("outside provider cutover authority");
    await expect(recovery.createObservation(f.personId, observation(f.sourceRecoveryId, f.sourceConsentId, oldDate))).resolves.toMatchObject({ created: true });
    const training = new TrainingRepository(database);
    const before = activity(f.personId, f.sourceId, f.sourceConsentId, new Date(f.preview.startsAt.valueOf() - 1).toISOString());
    await expect(training.importExternalActivity(before)).resolves.toBe("created");
    await expect(training.importExternalActivity(activity(f.personId, f.sourceId, f.sourceConsentId, f.preview.startsAt.toISOString()))).resolves.toBe("stopped");
    const derived = { ...observation(f.sourceRecoveryId, f.sourceConsentId, oldDate), observedFrom: new Date(f.preview.startsAt.valueOf() + 60_000).toISOString(), observedUntil: new Date(f.preview.startsAt.valueOf() + 60_000).toISOString(), temporalPrecision: "instant" as const, localDate: null,
      sourceReference: { channel: "account" as const, externalSystem: "intervals_icu_activity_fit:garmin_140_9_v1", externalRecordId: `${before.providerIdentity}:140.9:${"a".repeat(64)}`, occurredAt: new Date(f.preview.startsAt.valueOf() + 60_000).toISOString() }, detail: { type: "metric" as const, metric: "garmin_post_activity_recovery_time" as const, value: 60, unit: "minute" as const } };
    await expect(recovery.createObservation(f.personId, derived)).resolves.toMatchObject({ created: true });
    await expect(recovery.createObservation(f.personId, { ...derived, dedupeKey: randomUUID(), sourceReference: { ...derived.sourceReference, externalRecordId: `missing:140.9:${"a".repeat(64)}` } })).rejects.toThrow();
  });

  it("checks DB wall time after waiting for the Person lock, rejecting stale source writes at deadline", async () => {
    const f = await fixture();
    const row = await f.cutovers.schedule(f.personId, f.input);
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '1 minute', source_drains_until=date_trunc('milliseconds',clock_timestamp())+interval '300 milliseconds', state='draining',activated_at=clock_timestamp() where id=$1", [row.id]);
    const client = await database.pool.connect();
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [f.personId]);
    const pending = new RecoveryRepository(database).createObservation(f.personId, observation(f.sourceRecoveryId, f.sourceConsentId, previous(f.preview.startsOn)));
    const outcome = expect(pending).rejects.toThrow("outside provider cutover authority");
    await client.query("select pg_sleep(0.4)");
    await client.query("commit");
    client.release();
    await outcome;
    expect(await f.sourceStore.assertReadAllowed(f.sourceId, f.sourceConsentId)).toBe(false);
    await f.sourceStore.markSyncSucceeded(f.sourceId, f.sourceConsentId, true);
    expect((await f.sourceStore.status(f.personId))?.lastSuccessfulSyncAt).toBeNull();
  });

  it("activates atomically and finishes drain without authorizing source again", async () => {
    const f = await fixture();
    const scheduled = await f.cutovers.schedule(f.personId, f.input);
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '1 second' where id=$1", [scheduled.id]);
    const draining = await activateWithJournal(f, scheduled);
    expect(draining.state).toBe("draining");
    expect(await f.targetStore.findActive(f.personId)).not.toBeNull();
    expect((await f.targetStore.status(f.personId))?.historicalImport.scopeFromDate).toBe(f.preview.startsOn);
    await expect(f.cutovers.cancel(f.personId, draining.version, "too late")).rejects.toThrow();
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '2 seconds', source_drains_until=date_trunc('milliseconds',clock_timestamp())-interval '1 second' where id=$1", [scheduled.id]);
    const active = await f.cutovers.finishDrain(scheduled.id, draining.version);
    expect(active.state).toBe("active");
    expect(await f.sourceStore.findActive(f.personId)).toBeNull();
    await expect(f.sourceStore.activate({ id: f.sourceId, personId: f.personId, recoveryConnectionId: f.sourceRecoveryId, consentId: randomUUID(), externalUserId: "synthetic-athlete", credential: cipher.encrypt("next", `intervals_icu:${f.personId}:${f.sourceId}`), authorizationStartedAt: new Date() })).rejects.toThrow();
  });

  it("allows only the same source athlete to rotate during drain and preserves the exact bounds", async () => {
    const f = await fixture();
    const scheduled = await f.cutovers.schedule(f.personId, f.input);
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '1 second' where id=$1", [scheduled.id]);
    const draining = await activateWithJournal(f, scheduled);
    const rotate = (externalUserId: string) => f.sourceStore.activate({ id: f.sourceId, personId: f.personId, recoveryConnectionId: f.sourceRecoveryId, consentId: randomUUID(), externalUserId, credential: cipher.encrypt("next", `intervals_icu:${f.personId}:${f.sourceId}`), authorizationStartedAt: new Date() });
    await expect(rotate("different-athlete")).rejects.toThrow("cannot change");
    await rotate("synthetic-athlete");
    const changed = await f.cutovers.find(f.personId);
    expect(changed).toMatchObject({ startsOn: draining.startsOn, startsAt: draining.startsAt, sourceDrainsUntil: draining.sourceDrainsUntil, state: "draining" });
    expect(changed?.sourceConsentId).not.toBe(f.sourceConsentId);
    expect(await f.sourceStore.assertReadAllowed(f.sourceId, f.sourceConsentId)).toBe(false);
    expect(await f.sourceStore.assertReadAllowed(f.sourceId, changed!.sourceConsentId!)).toBe(true);
  });

  it("invalidates a schedule when source consent rotates before activation without losing source access", async () => {
    const f = await fixture();
    await f.cutovers.schedule(f.personId, f.input);
    const nextConsentId = randomUUID();
    await f.sourceStore.activate({ id: f.sourceId, personId: f.personId, recoveryConnectionId: f.sourceRecoveryId, consentId: nextConsentId,
      externalUserId: "synthetic-athlete", credential: cipher.encrypt("next", `intervals_icu:${f.personId}:${f.sourceId}`), authorizationStartedAt: new Date() });
    expect(await f.cutovers.find(f.personId)).toMatchObject({ state: "failed", failureCode: "consent_changed" });
    expect(await f.sourceStore.assertReadAllowed(f.sourceId, nextConsentId)).toBe(true);
    expect(await f.targetStore.findActive(f.personId)).toBeNull();
  });

  it("stops unfinished source history at the fixed deadline and preserves its unchecked cursor", async () => {
    const f = await fixture();
    await f.sourceStore.startHistoricalImport(f.personId);
    await database.pool.query("update integration_connections set historical_cursor_before='2026-01-01' where id=$1", [f.sourceId]);
    const scheduled = await f.cutovers.schedule(f.personId, f.input);
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '2 seconds',source_drains_until=date_trunc('milliseconds',clock_timestamp())-interval '1 second' where id=$1", [scheduled.id]);
    const active = await activateWithJournal(f, scheduled);
    expect(active.state).toBe("active");
    expect((await f.sourceStore.status(f.personId))?.historicalImport).toMatchObject({ status: "failed", failureCode: "cutover_source_stopped", processedThroughDate: "2026-01-01", completedAt: null });
    await expect(f.sourceStore.startHistoricalImport(f.personId)).resolves.toBe(false);
  });

  it("resets old target history snapshots on retry and retains encrypted pending key after preactivation failure", async () => {
    const f = await fixture();
    const row = await f.cutovers.schedule(f.personId, f.input);
    const failed = await f.cutovers.failBeforeActivation(row.id, row.version, "provider_timeout");
    expect(await f.cutovers.pendingTarget(f.personId)).not.toBeNull();
    await database.pool.query("update integration_connections set historical_scope_from_date='2000-01-01',historical_import_status='completed',historical_cursor_before='2000-01-01',historical_requested_at=now(),historical_completed_at=now(),historical_next_attempt_at=null where id=$1", [f.input.targetConnectionId]);
    const preview = await f.cutovers.preview(f.personId);
    const retry = await f.cutovers.retry(f.personId, { ...f.input, expectedVersion: failed.version, expectedRevision: preview.expectedRevision, dedupeKey: randomUUID(), targetConsentId: randomUUID() });
    expect(retry.state).toBe("scheduled");
    expect((await f.targetStore.status(f.personId))?.historicalImport).toMatchObject({ scopeFromDate: f.preview.startsOn, status: "not_requested", processedThroughDate: null });
  });

  it("preserves effective bounds and clears audit references when either connection is erased", async () => {
    const f = await fixture();
    const row = await f.cutovers.schedule(f.personId, f.input);
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '2 seconds',source_drains_until=date_trunc('milliseconds',clock_timestamp())-interval '1 second' where id=$1", [row.id]);
    const active = await activateWithJournal(f, row);
    await new RecoveryRepository(database).requestErasure(f.personId, f.input.targetRecoveryConnectionId, randomUUID(), "user_request", randomUUID());
    const retained = await f.cutovers.find(f.personId);
    expect(retained).toMatchObject({ state: "active", startsOn: active.startsOn, targetConnectionId: null, targetConsentId: null });
    await expect(f.sourceStore.activate({ id: f.sourceId, personId: f.personId, recoveryConnectionId: f.sourceRecoveryId, consentId: randomUUID(), externalUserId: "synthetic-athlete", credential: cipher.encrypt("next", `intervals_icu:${f.personId}:${f.sourceId}`), authorizationStartedAt: new Date() })).rejects.toThrow();
  });

  it("clears source credentials after a fixed revocation budget and reports unconfirmed remote revocation", async () => {
    const f = await fixture();
    const row = await f.cutovers.schedule(f.personId, f.input);
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '2 seconds',source_drains_until=date_trunc('milliseconds',clock_timestamp())-interval '1 second' where id=$1", [row.id]);
    await activateWithJournal(f, row);
    for (let attempt = 0; attempt < 5; attempt++) await f.sourceStore.failRemoteDisconnect(f.sourceId, "provider_timeout", f.sourceConsentId);
    expect(await f.cutovers.cleanupExpiredRevocations()).toBe(1);
    expect((await f.cutovers.find(f.personId))?.sourceRevocationUnconfirmed).toBe(true);
    expect((await database.pool.query("select credential_ciphertext,remote_disconnect_pending from integration_connections where id=$1", [f.sourceId])).rows[0]).toEqual({ credential_ciphertext: null, remote_disconnect_pending: false });
  });

  it("serializes concurrent claims and skips an expired source rather than starving another Person", async () => {
    const f = await fixture();
    const claims = await Promise.all([f.sourceStore.claimDue("worker-a", 60_000), f.sourceStore.claimDue("worker-b", 60_000)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)?.id).toBe(f.sourceId);
    await f.sourceStore.releaseClaim(f.sourceId, f.sourceConsentId);
    const cutover = await f.cutovers.schedule(f.personId, f.input);
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '2 seconds',source_drains_until=date_trunc('milliseconds',clock_timestamp())-interval '1 second',state='draining',activated_at=clock_timestamp() where id=$1", [cutover.id]);
    const other = await fixture();
    expect((await other.sourceStore.claimDue("unrelated-worker", 60_000))?.id).toBe(other.sourceId);
  });

  it("completes a target history job only at its scoped date, never at an unchecked legacy lower bound", async () => {
    const f = await fixture();
    const scheduled = await f.cutovers.schedule(f.personId, f.input);
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '1 second' where id=$1", [scheduled.id]);
    await activateWithJournal(f, scheduled);
    const token = randomUUID();
    expect(await f.targetStore.claimHistoricalWindow(f.input.targetConnectionId, f.input.targetConsentId, null, token, 60_000)).not.toBeNull();
    expect(await f.targetStore.markHistoricalWindowSucceeded(f.input.targetConnectionId, token, "2000-01-01", true)).toBe(false);
    expect(await f.targetStore.markHistoricalWindowSucceeded(f.input.targetConnectionId, token, f.preview.startsOn, true)).toBe(true);
    expect((await f.targetStore.status(f.personId))?.historicalImport).toMatchObject({ status: "completed", scopeFromDate: f.preview.startsOn, processedThroughDate: f.preview.startsOn });
  });

  it("never grants target authority without a durable matching policy proof", async () => {
    const f = await fixture();
    const scheduled = await f.cutovers.schedule(f.personId, f.input);
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '1 second' where id=$1", [scheduled.id]);
    await expect(f.cutovers.activate(scheduled.id, scheduled.version)).rejects.toBeInstanceOf(CutoverJournalProofRequiredError);
    expect(await f.targetStore.findActive(f.personId)).toBeNull();
    await f.cutovers.failBeforeActivation(scheduled.id, scheduled.version, "journal_not_ready");
    expect(await f.sourceStore.assertReadAllowed(f.sourceId, f.sourceConsentId)).toBe(true);
  });

  it("acknowledges policy only after a v2 durable seal, preserving v1 and failed-seal denial", async () => {
    const f = await fixture();
    const row = await f.cutovers.schedule(f.personId, f.input);
    const dir = await mkdtemp(join(tmpdir(), "soy-task0181-proof-")); directories.push(dir);
    const v1 = join(dir, "v1.sqlite"); const legacy = await RecoveryErasureJournal.create(v1, () => new Date(), 1); legacy.close();
    await expect(synchronizeRecoveryErasureJournal(database.pool, v1, join(dir, "v1-checkpoint.sqlite"))).rejects.toThrow("version-2");
    const v2 = join(dir, "v2.sqlite"); const current = await RecoveryErasureJournal.create(v2); current.close();
    await expect(synchronizeRecoveryErasureJournal(database.pool, v2, join(dir, "failed.sqlite"), {
      checkpointDurability: { syncFile: async () => { throw new Error("synthetic seal failure"); }, syncDirectory: async () => undefined }
    })).rejects.toThrow("synthetic seal failure");
    expect((await f.cutovers.find(f.personId))?.policyJournalHash).toBeNull();
    await synchronizeRecoveryErasureJournal(database.pool, v2, join(dir, "complete.sqlite"));
    const proved = await f.cutovers.find(f.personId);
    expect(proved?.policyJournalHash).toBe(immutableCutoverPolicyHash(row));
    expect(proved?.policyJournalAt).toBeInstanceOf(Date);
  });

  it("does not let an old sync acknowledge a retry with different immutable bounds", async () => {
    const f = await fixture();
    const row = await f.cutovers.schedule(f.personId, f.input);
    const dir = await mkdtemp(join(tmpdir(), "soy-task0181-stale-proof-")); directories.push(dir);
    const path = join(dir, "journal.sqlite"); const journal = await RecoveryErasureJournal.create(path); journal.close();
    let changed = false;
    await synchronizeRecoveryErasureJournal(database.pool, path, join(dir, "checkpoint.sqlite"), {
      checkpointDurability: { syncFile: async () => undefined, syncDirectory: async () => {
        if (changed) return; changed = true;
        const failed = await f.cutovers.failBeforeActivation(row.id, row.version, "provider_timeout");
        const nextDate = new Date(Date.parse(`${row.startsOn}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
        const next = await f.cutovers.preview(f.personId, nextDate);
        await f.cutovers.retry(f.personId, { ...f.input, startsOn: nextDate, expectedVersion: failed.version,
          expectedRevision: next.expectedRevision, dedupeKey: randomUUID(), targetConsentId: randomUUID() });
      } }
    });
    expect(changed).toBe(true);
    expect((await f.cutovers.find(f.personId))?.policyJournalHash).toBeNull();
    expect((await f.cutovers.find(f.personId))?.startsOn).not.toBe(row.startsOn);
  });

  it("restores deny-only bounds before accepted erasure replay into a state predating cutover", async () => {
    const f = await fixture();
    const scheduled = await f.cutovers.schedule(f.personId, f.input);
    await database.pool.query("update integration_cutovers set starts_at=date_trunc('milliseconds',clock_timestamp())-interval '2 seconds',source_drains_until=date_trunc('milliseconds',clock_timestamp())-interval '1 second' where id=$1", [scheduled.id]);
    await activateWithJournal(f, scheduled);
    const request = await new RecoveryRepository(database).requestErasure(f.personId, f.sourceRecoveryId, randomUUID(), "user_request", randomUUID());
    const { checkpointPath } = await sealPolicies();
    const sealed = await RecoveryErasureJournal.open(checkpointPath, { readOnly: true }); const through = sealed.verify().completeThrough; sealed.close();
    // Reconstruct the relevant synthetic backup state from before schedule/erasure; no live database is restored.
    await database.pool.query("delete from integration_cutovers where id=$1", [scheduled.id]);
    await database.pool.query("delete from recovery_erasure_requests where id=$1", [request.id]);
    await database.pool.query("delete from recovery_connections where id=$1", [f.input.targetRecoveryConnectionId]);
    await database.pool.query("update recovery_connections set status='active',disconnected_at=null,erasure_requested_at=null where id=$1", [f.sourceRecoveryId]);
    await database.pool.query("update recovery_consents set status='active',revoked_at=null,revocation_reason=null where id=$1", [f.sourceConsentId]);
    const restoredKey = cipher.encrypt("synthetic-restored-key", `intervals_icu:${f.personId}:${f.sourceId}`);
    await database.pool.query("update integration_connections set lifecycle='active',import_enabled=true,disconnected_at=null,credential_key_id=$2,credential_nonce=$3,credential_ciphertext=$4,credential_tag=$5 where id=$1", [f.sourceId, restoredKey.keyId, restoredKey.nonce, restoredKey.ciphertext, restoredKey.tag]);
    const recovery = new RecoveryRepository(database);
    await applyRecoveryErasureJournal(recovery, checkpointPath, through);
    const denied = await f.cutovers.find(f.personId);
    expect(denied).toMatchObject({ startsOn: scheduled.startsOn, restoreSuppressed: true, state: "active" });
    expect(await f.targetStore.requestSync(f.personId)).toBe(false);
    expect(await f.sourceStore.findActive(f.personId)).toBeNull();
    expect((await f.cutovers.nextDue())?.id).not.toBe(scheduled.id);
    const version = denied!.version;
    await applyRecoveryErasureJournal(recovery, checkpointPath, through);
    expect((await f.cutovers.find(f.personId))?.version).toBe(version);
    await expect(f.cutovers.cancel(f.personId, version, "cannot undo denial")).rejects.toThrow("operational recovery");
    const conflicting = { ...integrationCutoverRestorePolicy(denied!), startsOn: "2099-01-01", version: version + 1 };
    await expect(recovery.replayCutoverPolicy(conflicting)).rejects.toThrow("conflicts");
  });
});
