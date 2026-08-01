import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";

interface MigrationJournalEntry {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
}

interface MigrationJournal {
  readonly dialect: string;
  readonly entries: readonly MigrationJournalEntry[];
  readonly version: string;
}

interface AppliedMigration {
  readonly created_at: string;
  readonly hash: string;
}

let container: StartedPostgreSqlContainer;
let priorMigrationsFolder: string;
let journal: MigrationJournal;
let expectedMigrations: AppliedMigration[];

const migrationsFolder = new URL("../drizzle/", import.meta.url);
const syntheticPersonId = "00000000-0000-4000-8000-000000000001";

function databaseUrl(databaseName: string): string {
  const url = new URL(container.getConnectionUri());
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function databaseConfig(url: string) {
  return {
    NODE_ENV: "test" as const,
    HOST: "127.0.0.1",
    PORT: 3_000,
    DATABASE_URL: url,
    LOG_LEVEL: "silent" as const,
    PERSON_CONTEXT_MODE: "synthetic" as const,
    SYNTHETIC_PERSON_ID: syntheticPersonId,
    SHUTDOWN_TIMEOUT_MS: 1_000
  };
}

async function appliedMigrations(url: string): Promise<AppliedMigration[]> {
  const pool = new Pool({ connectionString: url });
  try {
    const result = await pool.query<AppliedMigration>(
      `select hash, created_at::text
         from drizzle.__drizzle_migrations
        order by created_at`
    );
    return result.rows;
  } finally {
    await pool.end();
  }
}

beforeAll(async () => {
  process.env.PERSON_CONTEXT_MODE = "synthetic";
  process.env.SYNTHETIC_PERSON_ID = syntheticPersonId;
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_migrations_clean")
    .withUsername("shape_of_you")
    .withPassword("shape_of_you")
    .start();
  journal = JSON.parse(
    await readFile(new URL("meta/_journal.json", migrationsFolder), "utf8")
  ) as MigrationJournal;
  expectedMigrations = await Promise.all(
    journal.entries.map(async (entry) => {
      const contents = await readFile(
        new URL(`${entry.tag}.sql`, migrationsFolder),
        "utf8"
      );
      return {
        created_at: String(entry.when),
        hash: createHash("sha256").update(contents).digest("hex")
      };
    })
  );
  priorMigrationsFolder = await mkdtemp(
    path.join(tmpdir(), "shape-of-you-migration-prefix-")
  );
  await mkdir(path.join(priorMigrationsFolder, "meta"));
  for (const entry of journal.entries) {
    await cp(
      new URL(`${entry.tag}.sql`, migrationsFolder),
      path.join(priorMigrationsFolder, `${entry.tag}.sql`)
    );
  }
}, 120_000);

afterAll(async () => {
  await container?.stop();
  if (priorMigrationsFolder) {
    await rm(priorMigrationsFolder, { force: true, recursive: true });
  }
});

describe("API migration chain", () => {
  it("applies the full journal cleanly and idempotently", async () => {
    const url = container.getConnectionUri();

    await runMigrations(url);
    expect(await appliedMigrations(url)).toEqual(expectedMigrations);

    await runMigrations(url);
    expect(await appliedMigrations(url)).toEqual(expectedMigrations);
  });

  it("upgrades every committed journal prefix through the production runner", async () => {
    const adminPool = new Pool({ connectionString: container.getConnectionUri() });
    try {
      for (let prefixLength = 1; prefixLength < journal.entries.length; prefixLength += 1) {
        const databaseName = `shape_of_you_migration_prefix_${prefixLength}`;
        await adminPool.query(`create database ${databaseName}`);
        const url = databaseUrl(databaseName);
        const prefixJournal: MigrationJournal = {
          ...journal,
          entries: journal.entries.slice(0, prefixLength)
        };
        await writeFile(
          path.join(priorMigrationsFolder, "meta", "_journal.json"),
          JSON.stringify(prefixJournal)
        );

        const prefixDatabase = createDatabase(databaseConfig(url));
        try {
          await migrate(prefixDatabase.db, {
            migrationsFolder: priorMigrationsFolder
          });
        } finally {
          await prefixDatabase.pool.end();
        }

        expect(await appliedMigrations(url)).toEqual(
          expectedMigrations.slice(0, prefixLength)
        );
        await runMigrations(url);
        expect(await appliedMigrations(url)).toEqual(expectedMigrations);
        await runMigrations(url);
        expect(await appliedMigrations(url)).toEqual(expectedMigrations);
      }
    } finally {
      await adminPool.end();
    }
  }, 120_000);
});
