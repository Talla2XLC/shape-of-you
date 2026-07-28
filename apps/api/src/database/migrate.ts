import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "@shape-of-you/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase } from "./context.js";

/**
 * Applies all pending API-owned Drizzle migrations and closes its connection.
 *
 * @param databaseUrl - Optional PostgreSQL URL override for operational use.
 * @throws Error when configuration, connection, or migration execution fails.
 */
export async function runMigrations(databaseUrl?: string): Promise<void> {
  const config = loadConfig(
    databaseUrl
      ? { ...process.env, DATABASE_URL: databaseUrl }
      : process.env
  );
  const database = createDatabase(config);
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
  runMigrations()
    .then(() => {
      process.stdout.write(
        `${JSON.stringify({ level: "info", message: "migrations applied" })}\n`
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${JSON.stringify({
          level: "error",
          message: "migration failed",
          error: error instanceof Error ? error.message : "unknown error"
        })}\n`
      );
      process.exitCode = 1;
    });
}
