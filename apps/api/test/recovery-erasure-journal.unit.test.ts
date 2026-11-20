import { access, chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { RecoveryErasureJournal, prepareRecoveryErasureJournalV2, inspectRecoveryErasureJournalHead } from "../src/recovery/recovery-erasure-journal.js";
import { parseIntegrationCutoverRestorePolicy, type IntegrationCutoverRestorePolicy } from "../src/recovery/integration-cutover-restore-policy.js";

const marker = {
  id: "00000000-0000-4000-8000-000000000096",
  personId: "00000000-0000-4000-8000-000000000001",
  connectionId: "00000000-0000-4000-8000-000000000002",
  reason: "user_request" as const,
  requestedAt: "2026-09-04T08:00:00.000Z"
};

const directories: string[] = [];
const policy: IntegrationCutoverRestorePolicy = {
  formatVersion: 1, id: "00000000-0000-4000-8000-000000000181", personId: marker.personId,
  sourceProvider: "intervals_icu", targetProvider: "garmin_personal", state: "scheduled", version: 1,
  restoreSuppressed: false, createdAt: "2026-11-20T10:00:00.000Z", startsOn: "2026-11-21", timezone: "Europe/Moscow",
  startsAt: "2026-11-20T21:00:00.000Z", sourceDrainsUntil: "2026-12-04T21:00:00.000Z", activatedAt: null,
  sourceConnectionId: "00000000-0000-4000-8000-000000000182", targetConnectionId: "00000000-0000-4000-8000-000000000183",
  sourceRecoveryConnectionId: marker.connectionId, targetRecoveryConnectionId: "00000000-0000-4000-8000-000000000184",
  sourceConsentId: "00000000-0000-4000-8000-000000000185", targetConsentId: "00000000-0000-4000-8000-000000000186",
  capabilityVersion: "test-v1", acceptedCoverageGaps: ["recovery.hrv_rmssd"]
};

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "shape-of-you-erasure-journal-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })
  ));
});

describe("Recovery erasure journal", () => {
  it("seals typed accepted and completed evidence idempotently", async () => {
    const directory = await temporaryDirectory();
    const livePath = join(directory, "live.sqlite");
    const checkpointPath = join(directory, "checkpoint.sqlite");
    const journal = await RecoveryErasureJournal.create(
      livePath,
      () => new Date("2026-09-04T09:00:00.000Z")
    );
    journal.appendAccepted(marker);
    journal.appendAccepted(marker);
    journal.appendCompleted({
      requestId: marker.id,
      completedAt: "2026-09-04T08:05:00.000Z"
    });
    journal.appendCompleted({
      requestId: marker.id,
      completedAt: "2026-09-04T08:05:00.000Z"
    });
    journal.appendCheckpoint("2026-09-04T08:10:00.000Z");
    await journal.createSealedCheckpoint(checkpointPath);
    await expect(journal.createSealedCheckpoint(checkpointPath)).rejects.toThrow();
    journal.close();

    const sealed = await RecoveryErasureJournal.open(checkpointPath, { readOnly: true });
    expect(sealed.verify("2026-09-04T08:10:00.000Z")).toEqual({
      journalId: expect.any(String),
      completeThrough: "2026-09-04T08:10:00.000Z",
      accepted: [marker],
      completedRequestIds: [marker.id]
    });
    expect(() => sealed.verify("2026-09-04T08:10:00.001Z")).toThrow("incomplete");
    sealed.close();
  });

  it("requires accepted intent before completion", async () => {
    const directory = await temporaryDirectory();
    const journal = await RecoveryErasureJournal.create(join(directory, "journal.sqlite"));
    expect(() => journal.appendCompleted({
      requestId: marker.id,
      completedAt: "2026-09-04T08:05:00.000Z"
    })).toThrow("requires accepted intent");
    journal.close();
  });

  it("rejects updates, deletes, permissive files and hash-chain tampering", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "journal.sqlite");
    const journal = await RecoveryErasureJournal.create(
      path,
      () => new Date("2026-09-04T09:00:00.000Z")
    );
    journal.appendAccepted(marker);
    journal.appendCheckpoint("2026-09-04T08:10:00.000Z");
    journal.close();

    const raw = new DatabaseSync(path);
    expect(() => raw.exec(
      "update recovery_erasure_journal_records set reason = 'retention_expired' where sequence = 1"
    )).toThrow("append-only");
    expect(() => raw.exec(
      "delete from recovery_erasure_journal_records where sequence = 1"
    )).toThrow("append-only");
    raw.exec("drop trigger recovery_erasure_journal_records_no_update");
    raw.exec(
      "update recovery_erasure_journal_records set reason = 'retention_expired' where sequence = 1"
    );
    raw.close();
    await expect(RecoveryErasureJournal.open(path)).rejects.toThrow("integrity");

    await chmod(path, 0o644);
    await expect(RecoveryErasureJournal.open(path)).rejects.toThrow("mode-0600");
  });

  it("removes an unacknowledgeable checkpoint when durable flush fails", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "journal.sqlite");
    const checkpointDirectory = join(directory, "checkpoints");
    const checkpointPath = join(checkpointDirectory, "checkpoint.sqlite");
    await mkdir(checkpointDirectory, { mode: 0o700 });
    const journal = await RecoveryErasureJournal.create(path);
    journal.appendCheckpoint("2026-09-04T08:10:00.000Z");

    await expect(journal.createSealedCheckpoint(checkpointPath, {
      syncFile: async () => {
        throw new Error("synthetic durable flush failure");
      },
      syncDirectory: async () => undefined
    })).rejects.toThrow("synthetic durable flush failure");
    await expect(access(checkpointPath)).rejects.toThrow();
    journal.close();
  });

  it("rejects a permissive checkpoint directory", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "journal.sqlite");
    const checkpointDirectory = join(directory, "checkpoints");
    await mkdir(checkpointDirectory, { mode: 0o755 });
    const journal = await RecoveryErasureJournal.create(path);
    journal.appendCheckpoint("2026-09-04T08:10:00.000Z");

    await expect(journal.createSealedCheckpoint(
      join(checkpointDirectory, "checkpoint.sqlite")
    )).rejects.toThrow("mode-0700");
    journal.close();
  });

  it("roundtrips bounded cutover records and rejects conflicting or regressing authority", async () => {
    const directory = await temporaryDirectory();
    const journal = await RecoveryErasureJournal.create(join(directory, "journal.sqlite"));
    expect(journal.formatVersion).toBe(2);
    journal.appendCutover(policy);
    journal.appendCutover(policy);
    const active = { ...policy, version: 2, state: "active" as const, activatedAt: policy.startsAt };
    journal.appendCutover(active);
    journal.appendCheckpoint("2026-12-05T10:00:00.000Z");
    expect(journal.verify().cutovers).toEqual([active]);
    expect(() => journal.appendCutover(policy)).toThrow("conflicts");
    expect(() => journal.appendCutover({ ...active, version: 3, startsOn: "2026-11-22" })).toThrow("cannot regress");
    expect(() => journal.appendCutover({ ...active, version: 2, timezone: "UTC" })).toThrow("conflicts");
    journal.close();
  });

  it.each([
    { ...policy, apiKey: "synthetic-secret" },
    { ...policy, externalUserId: "123" },
    { ...policy, healthValues: [50] },
    { ...policy, capabilityVersion: "x".repeat(5000) },
    { ...policy, acceptedCoverageGaps: ["unknown.metric"] }
  ])("rejects unexpected, oversized or sensitive snapshot fields", (input) => {
    expect(() => parseIntegrationCutoverRestorePolicy(input)).toThrow();
  });

  it("prepares v2 with the exact v1 prefix and completeness while leaving source bytes untouched", async () => {
    const directory = await temporaryDirectory();
    const sourcePath = join(directory, "source-v1.sqlite");
    const outputPath = join(directory, "prepared-v2.sqlite");
    const checkpointPath = join(directory, "prepared-checkpoint.sqlite");
    const source = await RecoveryErasureJournal.create(sourcePath, () => new Date("2026-09-04T09:00:00.000Z"), 1);
    source.appendAccepted(marker);
    source.appendCheckpoint("2026-09-04T08:10:00.000Z");
    const expected = source.head();
    expect(() => source.appendCutover(policy)).toThrow("explicitly upgraded");
    source.close();
    const before = await readFile(sourcePath);
    await prepareRecoveryErasureJournalV2(sourcePath, outputPath, checkpointPath, expected);
    expect(await readFile(sourcePath)).toEqual(before);
    const prepared = await RecoveryErasureJournal.open(outputPath);
    expect(prepared.head()).toEqual({ ...expected, formatVersion: 2 });
    const oldRows = new DatabaseSync(sourcePath, { readOnly: true });
    const newRows = new DatabaseSync(outputPath, { readOnly: true });
    const rows = oldRows.prepare("select * from recovery_erasure_journal_records order by sequence").all();
    for (const row of rows) expect(newRows.prepare("select sequence,record_kind,request_id,person_id,connection_id,reason,occurred_at,complete_through,recorded_at,previous_hash,record_hash from recovery_erasure_journal_records where sequence=?").get(row.sequence!)).toEqual(row);
    oldRows.close(); newRows.close();
    prepared.appendCompleted({ requestId: marker.id, completedAt: "2026-09-04T08:05:00.000Z" });
    prepared.appendCutover(policy);
    prepared.appendCheckpoint("2026-11-20T10:00:00.000Z");
    expect(prepared.verify().cutovers).toEqual([policy]);
    prepared.close();
    expect((await inspectRecoveryErasureJournalHead(checkpointPath)).completeThrough).toBe(expected.completeThrough);
  });

  it("refuses stale upgrade previews and removes failed preparation without changing v1 evidence", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "source-v1.sqlite");
    const journal = await RecoveryErasureJournal.create(path, () => new Date("2026-09-04T09:00:00.000Z"), 1);
    journal.appendCheckpoint("2026-09-04T08:00:00.000Z");
    const stale = journal.head();
    journal.appendAccepted(marker);
    const current = journal.head();
    journal.close();
    const original = await readFile(path);
    await expect(prepareRecoveryErasureJournalV2(path, join(directory, "stale.sqlite"), join(directory, "stale-checkpoint.sqlite"), stale)).rejects.toThrow("head changed");
    const output = join(directory, "failed.sqlite");
    await expect(prepareRecoveryErasureJournalV2(path, output, join(directory, "failed-checkpoint.sqlite"), current, {
      syncFile: async () => { throw new Error("synthetic flush failure"); }, syncDirectory: async () => undefined
    })).rejects.toThrow("synthetic flush failure");
    await expect(access(output)).rejects.toThrow();
    expect(await readFile(path)).toEqual(original);
    expect((await inspectRecoveryErasureJournalHead(path)).formatVersion).toBe(1);
  });

  it("detects cutover-payload tampering through the same append-only chain", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "journal.sqlite");
    const journal = await RecoveryErasureJournal.create(path);
    journal.appendCutover(policy);
    journal.appendCheckpoint("2026-11-20T10:00:00.000Z");
    journal.close();
    const raw = new DatabaseSync(path);
    raw.exec("drop trigger recovery_erasure_journal_records_no_update");
    raw.prepare("update recovery_erasure_journal_records set cutover_policy=? where record_kind='cutover'").run(JSON.stringify({ ...policy, startsOn: "2026-11-22" }));
    raw.close();
    await expect(RecoveryErasureJournal.open(path)).rejects.toThrow("integrity");
  });
});
