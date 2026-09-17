import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  readMigrationFiles,
  type MigrationMeta
} from "drizzle-orm/migrator";

import {
  checkIdentityDatabaseReadiness,
  createIdentityDatabase
} from "./context.js";

const DEFAULT_READINESS_ATTEMPTS = 12;
const DEFAULT_READINESS_DELAY_MS = 1_000;
const MIGRATION_LOCK_TIMEOUT_MS = 30_000;
const MIGRATION_STATEMENT_TIMEOUT_MS = 240_000;
const MAX_ERROR_CAUSE_DEPTH = 5;

/** One local or database migration journal entry used for exact comparison. */
export interface IdentityMigrationJournalEntry {
  readonly createdAt: string;
  readonly hash: string;
}

/** Safe lifecycle phases emitted by the Identity migration runner. */
export type IdentityMigrationPhase =
  | "readiness_started"
  | "readiness_completed"
  | "journal_check_started"
  | "journal_current"
  | "journal_pending"
  | "migration_apply_started"
  | "migration_apply_completed"
  | "pool_close_started"
  | "pool_close_completed";

/** Result of a successful Identity migration run. */
export type IdentityMigrationRunResult = "applied" | "current";

/** Operational hooks for secret-safe Identity migration phase reporting. */
export interface IdentityMigrationRunOptions {
  readonly onPhase?: (phase: IdentityMigrationPhase) => void;
}

/** Safe, whitelisted fields from one error in a migration failure chain. */
export interface IdentityMigrationErrorDiagnostic {
  readonly code?: string;
  readonly message: string;
  readonly name: string;
  readonly severity?: string;
}

/** Options for the bounded database-readiness wait before migration execution. */
export interface IdentityDatabaseReadinessOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
}

function validateJournalEntry(
  entry: IdentityMigrationJournalEntry,
  source: "database" | "local",
  index: number
): void {
  if (!/^[1-9]\d*$/u.test(entry.createdAt)) {
    throw new Error(
      `Identity ${source} migration journal entry ${index} has malformed created_at`
    );
  }
  if (!/^[0-9a-f]{64}$/u.test(entry.hash)) {
    throw new Error(
      `Identity ${source} migration journal entry ${index} has malformed hash`
    );
  }
}

/**
 * Compares the complete applied Identity journal with committed migrations.
 *
 * @param local - Committed local migration metadata in journal order.
 * @param database - Applied database metadata in journal order.
 * @returns `current` for an exact match or `pending` for an exact prefix.
 * @throws Error when either journal is malformed, ahead, or divergent.
 */
export function assessIdentityMigrationJournal(
  local: readonly IdentityMigrationJournalEntry[],
  database: readonly IdentityMigrationJournalEntry[]
): "current" | "pending" {
  if (local.length === 0) {
    throw new Error("Identity local migration journal is empty");
  }
  local.forEach((entry, index) => validateJournalEntry(entry, "local", index));
  database.forEach((entry, index) =>
    validateJournalEntry(entry, "database", index)
  );

  for (const [source, journal] of [
    ["local", local],
    ["database", database]
  ] as const) {
    for (let index = 1; index < journal.length; index += 1) {
      if (
        BigInt(journal[index - 1]!.createdAt) >=
        BigInt(journal[index]!.createdAt)
      ) {
        throw new Error(
          `Identity ${source} migration journal is not strictly ordered at entry ${index}`
        );
      }
    }
  }

  if (database.length > local.length) {
    throw new Error(
      "Identity database migration journal is ahead of local journal"
    );
  }

  for (let index = 0; index < database.length; index += 1) {
    const localEntry = local[index];
    const databaseEntry = database[index];
    if (
      !localEntry ||
      !databaseEntry ||
      localEntry.createdAt !== databaseEntry.createdAt ||
      localEntry.hash !== databaseEntry.hash
    ) {
      throw new Error(
        `Identity database migration journal diverges at entry ${index}`
      );
    }
  }

  return database.length === local.length ? "current" : "pending";
}

function localJournalEntry(
  migration: MigrationMeta
): IdentityMigrationJournalEntry {
  return {
    createdAt: String(migration.folderMillis),
    hash: migration.hash
  };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

async function readAppliedMigrationJournal(
  database: ReturnType<typeof createIdentityDatabase>
): Promise<readonly IdentityMigrationJournalEntry[]> {
  try {
    const result = await database.pool.query<{
      readonly created_at: unknown;
      readonly hash: unknown;
    }>(
      `select hash, created_at::text
         from drizzle.__drizzle_migrations
        order by created_at, id`
    );
    return result.rows.map((row) => ({
      createdAt: typeof row.created_at === "string" ? row.created_at : "",
      hash: typeof row.hash === "string" ? row.hash : ""
    }));
  } catch (error: unknown) {
    if (errorCode(error) === "42P01" || errorCode(error) === "3F000") {
      return [];
    }
    throw error;
  }
}

function optionalDiagnosticField(
  error: Record<string, unknown>,
  field: "code" | "severity"
): string | undefined {
  const value = error[field];
  if (typeof value !== "string") {
    return undefined;
  }
  if (field === "code") {
    const networkCodes = new Set([
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENOTFOUND",
      "ETIMEDOUT"
    ]);
    return /^[0-9A-Z]{5}$/u.test(value) || networkCodes.has(value)
      ? value
      : undefined;
  }
  const severities = new Set([
    "DEBUG",
    "ERROR",
    "FATAL",
    "INFO",
    "LOG",
    "NOTICE",
    "PANIC",
    "WARNING"
  ]);
  return severities.has(value) ? value : undefined;
}

/**
 * Extracts a bounded, secret-redacted error chain for structured operations logs.
 *
 * @param error - Unknown migration failure value.
 * @returns Whitelisted diagnostics without connection URLs, passwords, or stacks.
 */
export function describeIdentityMigrationError(
  error: unknown
): readonly IdentityMigrationErrorDiagnostic[] {
  const diagnostics: IdentityMigrationErrorDiagnostic[] = [];
  let current: unknown = error;

  while (
    current !== null &&
    current !== undefined &&
    diagnostics.length < MAX_ERROR_CAUSE_DEPTH
  ) {
    const record =
      typeof current === "object"
        ? (current as Record<string, unknown>)
        : undefined;
    const name = current instanceof Error ? "Error" : "UnknownError";
    const message = "Identity migration operation failed";

    const code = record
      ? optionalDiagnosticField(record, "code")
      : undefined;
    const severity = record
      ? optionalDiagnosticField(record, "severity")
      : undefined;
    diagnostics.push({
      name,
      message,
      ...(code ? { code } : {}),
      ...(severity ? { severity } : {})
    });

    current = record?.cause;
  }

  return diagnostics;
}

/**
 * Waits for a successful Identity database probe before migrations begin.
 *
 * Only readiness checks are retried. Migration execution remains single-shot.
 *
 * @param check - Read-only database readiness probe.
 * @param options - Bounded attempts, delay, and optional test sleep function.
 * @returns The one-based attempt number that succeeded.
 * @throws The last readiness error after all attempts fail.
 */
export async function waitForIdentityDatabaseReadiness(
  check: () => Promise<void>,
  options: IdentityDatabaseReadinessOptions = {}
): Promise<number> {
  const attempts = options.attempts ?? DEFAULT_READINESS_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_READINESS_DELAY_MS;
  const sleep =
    options.sleep ??
    ((duration: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, duration);
      }));

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error("Identity database readiness attempts must be positive");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("Identity database readiness delay must be non-negative");
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await check();
      return attempt;
    } catch (error: unknown) {
      if (attempt === attempts) {
        throw error;
      }
      await sleep(delayMs);
    }
  }

  throw new Error("Identity database readiness attempts were exhausted");
}

/**
 * Applies all pending Identity-owned migrations and closes the connection.
 *
 * @param databaseUrl - Optional PostgreSQL URL override for operational use.
 * @param options - Optional secret-safe phase reporter.
 * @returns Whether migrations were applied or the exact journal was current.
 * @throws Error when the URL is absent or migration execution fails.
 */
export async function runIdentityMigrations(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
  options: IdentityMigrationRunOptions = {}
): Promise<IdentityMigrationRunResult> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Identity migrations");
  }

  const database = createIdentityDatabase(databaseUrl, 2, {
    lockTimeoutMs: MIGRATION_LOCK_TIMEOUT_MS,
    statementTimeoutMs: MIGRATION_STATEMENT_TIMEOUT_MS
  });
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(currentDirectory, "../../drizzle");

  try {
    options.onPhase?.("readiness_started");
    await waitForIdentityDatabaseReadiness(() =>
      checkIdentityDatabaseReadiness(database)
    );
    options.onPhase?.("readiness_completed");

    options.onPhase?.("journal_check_started");
    const localJournal = readMigrationFiles({ migrationsFolder }).map(
      localJournalEntry
    );
    const appliedJournal = await readAppliedMigrationJournal(database);
    const journalStatus = assessIdentityMigrationJournal(
      localJournal,
      appliedJournal
    );

    if (journalStatus === "current") {
      options.onPhase?.("journal_current");
      return "current";
    }

    options.onPhase?.("journal_pending");
    options.onPhase?.("migration_apply_started");
    await migrate(database.db, { migrationsFolder });
    options.onPhase?.("migration_apply_completed");
    return "applied";
  } finally {
    options.onPhase?.("pool_close_started");
    await database.pool.end();
    options.onPhase?.("pool_close_completed");
  }
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  runIdentityMigrations(undefined, {
    onPhase: (phase) => {
      process.stdout.write(
        `${JSON.stringify({ level: "info", message: "Identity migration phase", phase })}\n`
      );
    }
  })
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify({ level: "info", message: "Identity migration completed", result })}\n`
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({
          level: "error",
          message: "Identity migration failed",
          errorChain: describeIdentityMigrationError(error)
        })}\n`
      );
      process.exitCode = 1;
    });
}
