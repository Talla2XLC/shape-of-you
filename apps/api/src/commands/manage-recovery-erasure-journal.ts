import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { createDatabase } from "../database/context.js";
import {
  applyRecoveryErasureJournal,
  inspectRecoveryErasureJournal,
  synchronizeRecoveryErasureJournal
} from "../recovery/recovery-erasure-journal-sync.js";
import {
  assertPrivateRecoveryErasureJournalDirectory,
  RecoveryErasureJournal
} from "../recovery/recovery-erasure-journal.js";
import { RecoveryRepository } from "../storage/recovery-repository.js";

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing required option ${name}`);
  return normalized;
}

function database() {
  const databaseUrl = required(process.env.DATABASE_URL, "DATABASE_URL");
  return createDatabase({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: 3_000,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: "00000000-0000-4000-8000-000000000001",
    SHUTDOWN_TIMEOUT_MS: 10_000
  });
}

function uniqueCheckpointPath(directory: string): string {
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/g, "");
  return join(directory, `checkpoint-${timestamp}-${randomUUID()}.sqlite`);
}

/** Synchronizes, inspects, or applies the independent typed erasure journal. */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      action: { type: "string" },
      journal: { type: "string" },
      checkpoint: { type: "string" },
      "checkpoint-directory": { type: "string" },
      "required-through": { type: "string" }
    }
  });
  if (values.action !== "sync" && values.action !== "sync-pending"
    && values.action !== "inspect" && values.action !== "apply") {
    throw new Error("--action must be sync, sync-pending, inspect, or apply");
  }
  const journalPath = required(values.journal, "--journal");

  if (values.action === "inspect") {
    if (values.checkpoint || values["checkpoint-directory"]) {
      throw new Error("Inspect does not accept checkpoint output options");
    }
    const verified = await inspectRecoveryErasureJournal(
      journalPath,
      values["required-through"]
    );
    process.stdout.write(
      `Recovery erasure journal verified (${verified.accepted.length} accepted, ${verified.completedRequestIds.length} completed, complete through ${verified.completeThrough}).\n`
    );
    return;
  }

  if (values.action === "sync-pending") {
    if (values.checkpoint || values["required-through"]) {
      throw new Error("Sync-pending accepts only --journal and --checkpoint-directory");
    }
    const checkpointDirectory = required(
      values["checkpoint-directory"],
      "--checkpoint-directory"
    );
    await assertPrivateRecoveryErasureJournalDirectory(checkpointDirectory);
    const context = database();
    try {
      const result = await synchronizeRecoveryErasureJournal(
        context.pool,
        journalPath,
        uniqueCheckpointPath(checkpointDirectory),
        { onlyIfPending: true }
      );
      process.stdout.write(result.checkpointCreated
        ? `Recovery erasure journal checkpoint sealed (${result.acceptedCount} accepted, ${result.completedCount} completed, complete through ${result.completeThrough}).\n`
        : "Recovery erasure journal has no pending acknowledgements.\n");
    } finally {
      await context.pool.end();
    }
    return;
  }

  const context = database();
  try {
    if (values.action === "apply") {
      if (values.checkpoint || values["checkpoint-directory"]) {
        throw new Error("Apply does not accept checkpoint output options");
      }
      const verified = await applyRecoveryErasureJournal(
        new RecoveryRepository(context),
        journalPath,
        required(values["required-through"], "--required-through")
      );
      process.stdout.write(
        `Recovery erasure journal applied (${verified.accepted.length} accepted markers).\n`
      );
      return;
    }

    if (values["required-through"]) {
      throw new Error("Sync does not accept --required-through");
    }
    if (values["checkpoint-directory"]) {
      throw new Error("Sync does not accept --checkpoint-directory");
    }
    let journal: RecoveryErasureJournal;
    try {
      journal = await RecoveryErasureJournal.open(journalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      journal = await RecoveryErasureJournal.create(journalPath);
    }
    journal.close();
    const result = await synchronizeRecoveryErasureJournal(
      context.pool,
      journalPath,
      required(values.checkpoint, "--checkpoint")
    );
    process.stdout.write(
      `Recovery erasure journal checkpoint sealed (${result.acceptedCount} accepted, ${result.completedCount} completed, complete through ${result.completeThrough}).\n`
    );
  } finally {
    await context.pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Recovery erasure journal operation failed"}\n`
  );
  process.exitCode = 1;
});
