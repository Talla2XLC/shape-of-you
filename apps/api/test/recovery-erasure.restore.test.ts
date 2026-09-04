import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { AppConfig } from "@shape-of-you/config";

import { createDatabase, type DatabaseContext } from "../src/database/context.js";
import {
  applyRecoveryErasureJournal,
  synchronizeRecoveryErasureJournal
} from "../src/recovery/recovery-erasure-journal-sync.js";
import { RecoveryErasureJournal } from "../src/recovery/recovery-erasure-journal.js";
import { RecoveryRepository } from "../src/storage/recovery-repository.js";

const run = promisify(execFile);
const personId = "00000000-0000-4000-8000-000000000001";
const postgresUser = "shape_of_you_restore_drill";
const sourceDatabase = "shape_of_you_restore_source";
const restoredDatabase = "shape_of_you_restore_target";
const migrationsDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));

interface MigrationJournal {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly {
    readonly idx: number;
    readonly version: string;
    readonly when: number;
    readonly tag: string;
    readonly breakpoints: boolean;
  }[];
}

let temporaryRoot: string;
let postgres: ChildProcess;
let port: number;
let sourceUrl: string;
let source: DatabaseContext;

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a private restore port")));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function databaseUrl(name: string): string {
  return `postgresql://${postgresUser}@127.0.0.1:${port}/${name}`;
}

function config(url: string): AppConfig {
  return {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    PORT: 3_000,
    DATABASE_URL: url,
    LOG_LEVEL: "silent",
    PERSON_CONTEXT_MODE: "synthetic",
    SYNTHETIC_PERSON_ID: personId,
    SHUTDOWN_TIMEOUT_MS: 1_000
  };
}

async function waitForPostgres(): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await run("pg_isready", ["-h", "127.0.0.1", "-p", String(port)]);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError ?? new Error("Temporary PostgreSQL did not become ready");
}

async function stopPostgres(): Promise<void> {
  if (!postgres || postgres.exitCode !== null) return;
  postgres.kill("SIGTERM");
  const stopped = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10_000);
    timeout.unref();
    postgres.once("exit", () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
  if (stopped || postgres.exitCode !== null) return;
  postgres.kill("SIGKILL");
  await new Promise<void>((resolve) => postgres.once("exit", () => resolve()));
}

beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "shape-of-you-restore-drill-"));
  const dataDirectory = join(temporaryRoot, "postgres");
  port = await availablePort();
  expect(port).not.toBe(5_431);
  await run("initdb", [
    "-D", dataDirectory,
    "-U", postgresUser,
    "--auth-local=trust",
    "--auth-host=trust",
    "--no-instructions"
  ]);
  postgres = spawn("postgres", [
    "-D", dataDirectory,
    "-h", "127.0.0.1",
    "-p", String(port),
    "-c", "listen_addresses=127.0.0.1"
  ], { stdio: "ignore" });
  await waitForPostgres();
  await run("createdb", [
    "-h", "127.0.0.1",
    "-p", String(port),
    "-U", postgresUser,
    sourceDatabase
  ]);
  sourceUrl = databaseUrl(sourceDatabase);
  source = createDatabase(config(sourceUrl));
  await migrate(source.db, { migrationsFolder: migrationsDirectory });
});

afterAll(async () => {
  await source?.pool.end();
  await stopPostgres();
  if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true });
});

describe("Recovery erasure restore safety", () => {
  it("applies the journal-gate migration from every prior journal prefix", async () => {
    const journal = JSON.parse(
      await readFile(join(migrationsDirectory, "meta", "_journal.json"), "utf8")
    ) as MigrationJournal;
    for (let prefixLength = 0; prefixLength < journal.entries.length; prefixLength += 1) {
      const name = `shape_of_you_task0096_prefix_${prefixLength}`;
      await run("createdb", [
        "-h", "127.0.0.1",
        "-p", String(port),
        "-U", postgresUser,
        name
      ]);
      const prefixDirectory = join(temporaryRoot, `migration-prefix-${prefixLength}`);
      await mkdir(join(prefixDirectory, "meta"), { recursive: true });
      const prefixEntries = journal.entries.slice(0, prefixLength);
      for (const entry of prefixEntries) {
        await cp(
          join(migrationsDirectory, `${entry.tag}.sql`),
          join(prefixDirectory, `${entry.tag}.sql`)
        );
      }
      await writeFile(
        join(prefixDirectory, "meta", "_journal.json"),
        `${JSON.stringify({ ...journal, entries: prefixEntries })}\n`,
        "utf8"
      );
      const prefixDatabase = createDatabase(config(databaseUrl(name)));
      try {
        await migrate(prefixDatabase.db, { migrationsFolder: prefixDirectory });
        await migrate(prefixDatabase.db, { migrationsFolder: migrationsDirectory });
        const columns = await prefixDatabase.pool.query<{ column_name: string }>(
          `select column_name
             from information_schema.columns
            where table_schema = 'public'
              and table_name = 'recovery_erasure_requests'
              and column_name in ('journal_accepted_at', 'journal_completed_at')
            order by column_name`
        );
        expect(columns.rows.map((row) => row.column_name)).toEqual([
          "journal_accepted_at",
          "journal_completed_at"
        ]);
      } finally {
        await prefixDatabase.pool.end();
      }
    }
  });

  it("removes deleted device facts from a real isolated pre-erasure restore", async () => {
    const repository = new RecoveryRepository(source);
    const model = await repository.registerDeviceModel({
      providerKey: "local-restore-provider",
      providerName: "Local restore provider",
      modelKey: "local-restore-watch",
      version: 1,
      name: "Local restore watch",
      capabilities: ["metric"]
    });
    const connection = await repository.createConnection(personId, {
      deviceModelVersionId: model.id,
      label: null,
      dedupeKey: "task0096:restore:connection"
    });
    const consent = await repository.grantConsent(personId, connection.id, {
      purpose: "TASK-0096 isolated restore proof",
      allowedKinds: ["metric"],
      retentionMode: "indefinite",
      retainUntil: null
    });
    const device = await repository.createObservation(personId, {
      kind: "metric",
      observedFrom: "2026-09-04T05:00:00.000Z",
      observedUntil: "2026-09-04T05:00:00.000Z",
      timezone: "Europe/Moscow",
      quality: "reliable",
      connectionId: connection.id,
      consentId: consent.id,
      dedupeKey: "task0096:restore:device",
      sourceReference: {
        channel: "device",
        externalSystem: "local-restore-provider",
        externalRecordId: "synthetic-device-fact",
        occurredAt: "2026-09-04T05:00:00.000Z"
      },
      detail: { type: "metric", metric: "resting_heart_rate", value: 56, unit: "bpm" }
    });
    const manual = await repository.createObservation(personId, {
      kind: "metric",
      observedFrom: "2026-09-04T06:00:00.000Z",
      observedUntil: "2026-09-04T06:00:00.000Z",
      timezone: "Europe/Moscow",
      quality: "reliable",
      connectionId: null,
      consentId: null,
      dedupeKey: "task0096:restore:manual",
      sourceReference: {
        channel: "manual",
        externalSystem: null,
        externalRecordId: null,
        occurredAt: "2026-09-04T06:00:00.000Z"
      },
      detail: { type: "metric", metric: "resting_heart_rate", value: 57, unit: "bpm" }
    });
    const policyId = await repository.registerPolicyVersion({
      policyKey: "task0096-restore-policy",
      policyName: "TASK-0096 restore policy",
      version: 1,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveUntil: null,
      analysisWindowDays: 7,
      minimumObservations: 1,
      sufficientObservations: 1,
      insufficientConfidenceCap: 0.25,
      poorQualityConfidenceCap: 0.4,
      targetSleepMinutes: 480,
      fatigueWeight: 20,
      sorenessWeight: 15,
      stressWeight: 10,
      lowEnergyWeight: 15,
      lowSleepQualityWeight: 10,
      sleepDeficitWeight: 20,
      externalSetWeight: 1,
      bodyweightSetWeight: 0.5,
      assistedSetWeight: 0.25,
      moderateRiskThreshold: 25,
      highRiskThreshold: 50
    });
    const assessment = await repository.createAssessment(personId, {
      policyVersionId: policyId,
      asOf: "2026-09-04T07:00:00.000Z",
      timezone: "Europe/Moscow",
      dedupeKey: "task0096:restore:assessment"
    });

    const dumpPath = join(temporaryRoot, "pre-erasure.dump");
    await run("pg_dump", [
      "-h", "127.0.0.1",
      "-p", String(port),
      "-U", postgresUser,
      "--format=custom",
      "--file", dumpPath,
      sourceDatabase
    ]);

    const request = await repository.requestErasure(
      personId,
      connection.id,
      "task0096:restore:request",
      "user_request",
      "00000000-0000-4000-8000-000000000096"
    );
    expect(await repository.claimErasure("blocked-before-journal", 30_000)).toBeNull();

    const liveJournalPath = join(temporaryRoot, "live-journal.sqlite");
    const acceptedCheckpoint = join(temporaryRoot, "accepted-checkpoint.sqlite");
    const journal = await RecoveryErasureJournal.create(liveJournalPath);
    const unavailableCheckpoint = join(temporaryRoot, "unavailable-checkpoint.sqlite");
    await writeFile(unavailableCheckpoint, "reserved", { mode: 0o600 });
    await expect(synchronizeRecoveryErasureJournal(
      source.pool,
      journal,
      unavailableCheckpoint
    )).rejects.toThrow();
    expect(await repository.claimErasure("blocked-after-checkpoint-failure", 30_000)).toBeNull();
    const unacknowledged = await source.pool.query<{ journal_accepted_at: Date | null }>(
      "select journal_accepted_at from recovery_erasure_requests where id = $1",
      [request.id]
    );
    expect(unacknowledged.rows[0]?.journal_accepted_at).toBeNull();
    const acceptedSync = await synchronizeRecoveryErasureJournal(
      source.pool,
      journal,
      acceptedCheckpoint
    );
    const job = await repository.claimErasure("local-restore-worker", 30_000);
    expect(job?.id).toBe(request.id);
    await repository.completeErasure(job!);

    const completedCheckpoint = join(temporaryRoot, "completed-checkpoint.sqlite");
    const completedSync = await synchronizeRecoveryErasureJournal(
      source.pool,
      journal,
      completedCheckpoint
    );
    journal.close();
    expect(completedSync.completedCount).toBe(1);

    await run("createdb", [
      "-h", "127.0.0.1",
      "-p", String(port),
      "-U", postgresUser,
      restoredDatabase
    ]);
    await run("pg_restore", [
      "-h", "127.0.0.1",
      "-p", String(port),
      "-U", postgresUser,
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "--dbname", restoredDatabase,
      dumpPath
    ]);

    const restored = createDatabase(config(databaseUrl(restoredDatabase)));
    const restoredRepository = new RecoveryRepository(restored);
    try {
      expect(await restoredRepository.findObservation(personId, device.observation.id)).not.toBeNull();
      expect(await restoredRepository.findAssessment(personId, assessment.assessment.id)).not.toBeNull();
      await expect(applyRecoveryErasureJournal(
        restoredRepository,
        acceptedCheckpoint,
        new Date(new Date(acceptedSync.completeThrough).valueOf() + 1).toISOString()
      )).rejects.toThrow("incomplete");
      await applyRecoveryErasureJournal(
        restoredRepository,
        acceptedCheckpoint,
        acceptedSync.completeThrough
      );
      expect(await restoredRepository.findObservation(personId, device.observation.id)).toBeNull();
      expect(await restoredRepository.findAssessment(personId, assessment.assessment.id)).toBeNull();
      expect(await restoredRepository.findObservation(personId, manual.observation.id)).not.toBeNull();
      await applyRecoveryErasureJournal(
        restoredRepository,
        completedCheckpoint,
        completedSync.completeThrough
      );
      const retained = await restoredRepository.registerDeviceModel({
        providerKey: "local-restore-provider",
        providerName: "Local restore provider",
        modelKey: "local-restore-watch",
        version: 1,
        name: "Local restore watch",
        capabilities: ["metric"]
      });
      expect(retained.id).toBe(model.id);
    } finally {
      await restored.pool.end();
    }
  });
});
