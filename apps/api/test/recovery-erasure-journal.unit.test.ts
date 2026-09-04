import { access, chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { RecoveryErasureJournal } from "../src/recovery/recovery-erasure-journal.js";

const marker = {
  id: "00000000-0000-4000-8000-000000000096",
  personId: "00000000-0000-4000-8000-000000000001",
  connectionId: "00000000-0000-4000-8000-000000000002",
  reason: "user_request" as const,
  requestedAt: "2026-09-04T08:00:00.000Z"
};

const directories: string[] = [];

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
});
