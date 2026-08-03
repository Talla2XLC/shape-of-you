import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createIdentityDatabase } from "./context.js";

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
          error: error instanceof Error ? error.message : "unknown error"
        })}\n`
      );
      process.exitCode = 1;
    });
}
