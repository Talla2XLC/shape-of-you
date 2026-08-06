import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import {
  checkIdentityDatabaseReadiness,
  createIdentityDatabase
} from "./context.js";

const DEFAULT_READINESS_ATTEMPTS = 12;
const DEFAULT_READINESS_DELAY_MS = 1_000;
const MAX_ERROR_CAUSE_DEPTH = 5;

/** Safe, whitelisted fields from one error in a migration failure chain. */
export interface IdentityMigrationErrorDiagnostic {
  readonly code?: string;
  readonly detail?: string;
  readonly hint?: string;
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

function redactDiagnosticText(value: string): string {
  return value
    .replace(
      /(postgres(?:ql)?:\/\/[^:\s/@]+:)[^@\s/]+@/giu,
      "$1[redacted]@"
    )
    .replace(/(\bpassword\s*=\s*)[^\s,;]+/giu, "$1[redacted]");
}

function optionalDiagnosticField(
  error: Record<string, unknown>,
  field: "code" | "detail" | "hint" | "severity"
): string | undefined {
  const value = error[field];
  return typeof value === "string" ? redactDiagnosticText(value) : undefined;
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
    const name =
      current instanceof Error
        ? current.name
        : typeof record?.name === "string"
          ? record.name
          : "UnknownError";
    const message =
      current instanceof Error
        ? current.message
        : typeof record?.message === "string"
          ? record.message
          : "unknown error";

    const code = record
      ? optionalDiagnosticField(record, "code")
      : undefined;
    const severity = record
      ? optionalDiagnosticField(record, "severity")
      : undefined;
    const detail = record
      ? optionalDiagnosticField(record, "detail")
      : undefined;
    const hint = record
      ? optionalDiagnosticField(record, "hint")
      : undefined;

    diagnostics.push({
      name: redactDiagnosticText(name),
      message: redactDiagnosticText(message),
      ...(code ? { code } : {}),
      ...(severity ? { severity } : {}),
      ...(detail ? { detail } : {}),
      ...(hint ? { hint } : {})
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
 * @throws Error when the URL is absent or migration execution fails.
 */
export async function runIdentityMigrations(
  databaseUrl: string | undefined = process.env.DATABASE_URL
): Promise<void> {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Identity migrations");
  }

  const database = createIdentityDatabase(databaseUrl, 2);
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(currentDirectory, "../../drizzle");

  try {
    await waitForIdentityDatabaseReadiness(() =>
      checkIdentityDatabaseReadiness(database)
    );
    await migrate(database.db, { migrationsFolder });
  } finally {
    await database.pool.end();
  }
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  runIdentityMigrations()
    .then(() => {
      process.stdout.write(
        `${JSON.stringify({ level: "info", message: "Identity migrations applied" })}\n`
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
