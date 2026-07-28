import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { AppConfig } from "@shape-of-you/config";

import * as schema from "./schema.js";

/** Database client and connection pool owned by one API application instance. */
export interface DatabaseContext {
  /** Typed Drizzle client bound to the API schema. */
  readonly db: NodePgDatabase<typeof schema>;
  /** PostgreSQL pool that the context owner must close during shutdown. */
  readonly pool: Pool;
}

/**
 * Creates the API database context from validated runtime configuration.
 *
 * @param config - Validated application configuration.
 * @returns A Drizzle client and its underlying PostgreSQL pool.
 */
export function createDatabase(config: AppConfig): DatabaseContext {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    connectionTimeoutMillis: 1_000,
    max: config.NODE_ENV === "test" ? 4 : 10
  });

  return {
    db: drizzle({ client: pool, schema }),
    pool
  };
}
