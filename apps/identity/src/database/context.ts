import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

/** Database client and connection pool owned by one Identity process. */
export interface IdentityDatabaseContext {
  /** Typed Drizzle client bound only to the Identity schema. */
  readonly db: NodePgDatabase<typeof schema>;
  /** PostgreSQL pool that the context owner must close during shutdown. */
  readonly pool: Pool;
}

/** Fixed PostgreSQL session limits owned by an Identity database client. */
export interface IdentityDatabaseSessionLimits {
  /** Maximum time in milliseconds to wait for a database lock. */
  readonly lockTimeoutMs?: number;
  /** Maximum time in milliseconds for one PostgreSQL statement. */
  readonly statementTimeoutMs?: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function sessionOptions(
  limits: IdentityDatabaseSessionLimits
): string | undefined {
  const options: string[] = [];
  if (limits.lockTimeoutMs !== undefined) {
    options.push(
      `-c lock_timeout=${positiveInteger(limits.lockTimeoutMs, "lockTimeoutMs")}`
    );
  }
  if (limits.statementTimeoutMs !== undefined) {
    options.push(
      `-c statement_timeout=${positiveInteger(limits.statementTimeoutMs, "statementTimeoutMs")}`
    );
  }
  return options.length > 0 ? options.join(" ") : undefined;
}

/**
 * Creates an Identity-owned database context.
 *
 * @param databaseUrl - Identity PostgreSQL connection URL.
 * @param maximumPoolSize - Maximum connections owned by this context.
 * @param limits - Optional process-owned PostgreSQL session limits.
 * @returns A typed Drizzle client and its underlying PostgreSQL pool.
 */
export function createIdentityDatabase(
  databaseUrl: string,
  maximumPoolSize = 10,
  limits: IdentityDatabaseSessionLimits = {}
): IdentityDatabaseContext {
  const options = sessionOptions(limits);
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 1_000,
    max: maximumPoolSize,
    ...(options ? { options } : {})
  });

  return {
    db: drizzle({ client: pool, schema }),
    pool
  };
}

/**
 * Verifies that the Identity process can execute a PostgreSQL query.
 *
 * @param database - Identity-owned database context to check.
 * @throws Error when PostgreSQL is unavailable or rejects the query.
 */
export async function checkIdentityDatabaseReadiness(
  database: IdentityDatabaseContext
): Promise<void> {
  await database.pool.query("select 1");
}
