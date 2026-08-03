import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runIdentityMigrations } from "../src/database/migrate.js";

interface MigrationJournalEntry {
  readonly tag: string;
  readonly when: number;
}

interface MigrationJournal {
  readonly entries: readonly MigrationJournalEntry[];
}

interface AppliedMigration {
  readonly created_at: string;
  readonly hash: string;
}

let container: StartedPostgreSqlContainer;
const migrationsFolder = new URL("../drizzle/", import.meta.url);

async function expectedMigrations(): Promise<AppliedMigration[]> {
  const journal = JSON.parse(
    await readFile(new URL("meta/_journal.json", migrationsFolder), "utf8")
  ) as MigrationJournal;

  return Promise.all(
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
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_identity_migrations")
    .withUsername("shape_of_you_identity")
    .withPassword("shape_of_you_identity")
    .start();
}, 120_000);

afterAll(async () => {
  await container?.stop();
});

describe("Identity migration chain", () => {
  it("applies the generated journal cleanly and idempotently", async () => {
    const expected = await expectedMigrations();

    await runIdentityMigrations(container.getConnectionUri());
    await runIdentityMigrations(container.getConnectionUri());

    const pool = new Pool({ connectionString: container.getConnectionUri() });
    try {
      const result = await pool.query<AppliedMigration>(
        `select hash, created_at::text
           from drizzle.__drizzle_migrations
          order by created_at`
      );
      expect(result.rows).toEqual(expected);
    } finally {
      await pool.end();
    }
  });

  it("creates only the approved typed foundation tables without JSON columns", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    try {
      const tables = await pool.query<{ table_name: string }>(
        `select table_name
           from information_schema.tables
          where table_schema = 'public'
          order by table_name`
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "identity_accounts",
        "passkey_recovery_sessions",
        "recovery_code_batches",
        "recovery_codes",
        "webauthn_challenges",
        "webauthn_credentials"
      ]);

      const serializedColumns = await pool.query<{ column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_schema = 'public'
            and data_type in ('json', 'jsonb')`
      );
      expect(serializedColumns.rows).toEqual([]);
    } finally {
      await pool.end();
    }
  });

  it("rejects plaintext-shaped challenges and unbound registration", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const accountId = randomUUID();
    try {
      await pool.query(
        `insert into identity_accounts
           (id, subject, webauthn_user_handle, display_name)
         values ($1, $2, $3, $4)`,
        [accountId, randomUUID(), randomBytes(32), "Migration test account"]
      );

      await expect(
        pool.query(
          `insert into webauthn_challenges
             (id, account_id, purpose, challenge_hash, expected_rp_id,
              expected_origin, user_verification, expires_at)
           values ($1, $2, 'registration', $3, $4, $5, 'required', now() + interval '5 minutes')`,
          [
            randomUUID(),
            accountId,
            randomBytes(31),
            "identity.example.test",
            "https://identity.example.test"
          ]
        )
      ).rejects.toMatchObject({ constraint: "webauthn_challenges_hash_length" });

      await expect(
        pool.query(
          `insert into webauthn_challenges
             (id, purpose, challenge_hash, expected_rp_id, expected_origin,
              user_verification, expires_at)
           values ($1, 'registration', $2, $3, $4, 'required', now() + interval '5 minutes')`,
          [
            randomUUID(),
            randomBytes(32),
            "identity.example.test",
            "https://identity.example.test"
          ]
        )
      ).rejects.toMatchObject({
        constraint: "webauthn_challenges_registration_account"
      });
    } finally {
      await pool.end();
    }
  });
});
