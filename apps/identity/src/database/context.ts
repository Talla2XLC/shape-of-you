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

/**
 * Creates an Identity-owned database context.
 *
 * @param databaseUrl - Identity PostgreSQL connection URL.
 * @param maximumPoolSize - Maximum connections owned by this context.
 * @returns A typed Drizzle client and its underlying PostgreSQL pool.
 */
export function createIdentityDatabase(
  databaseUrl: string,
  maximumPoolSize = 10
): IdentityDatabaseContext {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 1_000,
    max: maximumPoolSize
  });

  return {
    db: drizzle({ client: pool, schema }),
    pool
  };
}
