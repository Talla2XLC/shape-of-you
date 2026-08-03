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

interface MigrationSource {
  readonly contents: string;
  readonly tag: string;
}

let container: StartedPostgreSqlContainer;
const migrationsFolder = new URL("../drizzle/", import.meta.url);

async function migrationSources(): Promise<MigrationSource[]> {
  const journal = JSON.parse(
    await readFile(new URL("meta/_journal.json", migrationsFolder), "utf8")
  ) as MigrationJournal;

  return Promise.all(
    journal.entries.map(async (entry) => {
      return {
        contents: await readFile(
          new URL(`${entry.tag}.sql`, migrationsFolder),
          "utf8"
        ),
        tag: entry.tag
      };
    })
  );
}

async function expectedMigrations(): Promise<AppliedMigration[]> {
  const journal = JSON.parse(
    await readFile(new URL("meta/_journal.json", migrationsFolder), "utf8")
  ) as MigrationJournal;
  const sources = new Map(
    (await migrationSources()).map((source) => [source.tag, source.contents])
  );

  return journal.entries.map((entry) => {
    const contents = sources.get(entry.tag);
    if (contents === undefined) {
      throw new Error(`Missing generated migration source: ${entry.tag}`);
    }
    return {
      created_at: String(entry.when),
      hash: createHash("sha256").update(contents).digest("hex")
    };
  });
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
  it("keeps every generated PostgreSQL identifier within 63 bytes", async () => {
    const overlongIdentifiers: string[] = [];

    for (const source of await migrationSources()) {
      for (const match of source.contents.matchAll(/"((?:""|[^"])*)"/g)) {
        const identifier = match[1]!.replaceAll('""', '"');
        const byteLength = Buffer.byteLength(identifier, "utf8");
        if (byteLength > 63) {
          overlongIdentifiers.push(`${source.tag}: ${byteLength} ${identifier}`);
        }
      }
    }

    expect(overlongIdentifiers).toEqual([]);
  });

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

  it("creates only the approved typed lifecycle tables without JSON columns", async () => {
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
        "oauth_authorization_codes",
        "oauth_client_allowed_scopes",
        "oauth_client_redirect_uris",
        "oauth_clients",
        "oauth_grant_oidc_scopes",
        "oauth_grant_resource_scopes",
        "oauth_grants",
        "oauth_interaction_requested_resources",
        "oauth_interaction_requested_scopes",
        "oauth_interactions",
        "oauth_refresh_token_families",
        "oauth_refresh_tokens",
        "oauth_session_authorizations",
        "oauth_sessions",
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

      const bearerColumns = await pool.query<{
        column_name: string;
        table_name: string;
      }>(
        `select table_name, column_name
           from information_schema.columns
          where table_schema = 'public'
            and ((table_name = 'oauth_sessions'
                  and column_name = 'credential')
              or (table_name = 'oauth_authorization_codes'
                  and column_name = 'code')
              or (table_name = 'oauth_refresh_tokens'
                  and column_name = 'token'))`
      );
      expect(bearerColumns.rows).toEqual([]);
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

  it("enforces OAuth hashes, redirect binding, S256 PKCE and reuse revocation", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const accountId = randomUUID();
    const clientId = "chatgpt-test-client";
    const redirectUri = "https://chatgpt.example.test/oauth/callback";
    const grantId = randomUUID();
    const sessionId = randomUUID();
    try {
      await pool.query(
        `insert into identity_accounts
           (id, subject, webauthn_user_handle, display_name)
         values ($1, $2, $3, $4)`,
        [accountId, randomUUID(), randomBytes(32), "OAuth migration account"]
      );
      await pool.query(
        `insert into oauth_clients
           (id, display_name, refresh_tokens_enabled)
         values ($1, $2, true)`,
        [clientId, "ChatGPT test client"]
      );
      await pool.query(
        `insert into oauth_client_redirect_uris
           (id, client_id, redirect_uri)
         values ($1, $2, $3)`,
        [randomUUID(), clientId, redirectUri]
      );
      await pool.query(
        `insert into oauth_client_allowed_scopes (client_id, scope)
         values ($1, 'openid'), ($1, 'person:read')`,
        [clientId]
      );
      await pool.query(
        `insert into oauth_grants (id, account_id, client_id)
         values ($1, $2, $3)`,
        [grantId, accountId, clientId]
      );
      await pool.query(
        `insert into oauth_sessions
           (id, account_id, credential_hash, provider_uid, authenticated_at,
            acr, amr, expires_at)
         values ($1, $2, $3, $4, now() - interval '1 second', $5,
                 ARRAY['passkey'], now() + interval '1 hour')`,
        [sessionId, accountId, randomBytes(32), randomUUID(), "urn:soy:passkey"]
      );

      const authorizationCodeValues = [
        randomUUID(),
        randomBytes(31),
        accountId,
        clientId,
        sessionId,
        grantId,
        redirectUri,
        "A".repeat(43),
        "https://api.example.test",
        ["openid", "person:read"]
      ];
      await expect(
        pool.query(
          `insert into oauth_authorization_codes
             (id, code_hash, account_id, client_id, session_id, grant_id,
              redirect_uri, code_challenge, resource, issued_scopes,
              expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   now() + interval '5 minutes')`,
          authorizationCodeValues
        )
      ).rejects.toMatchObject({
        constraint: "oauth_authorization_codes_hash_length"
      });

      authorizationCodeValues[0] = randomUUID();
      authorizationCodeValues[1] = randomBytes(32);
      authorizationCodeValues[6] = "https://attacker.example.test/callback";
      await expect(
        pool.query(
          `insert into oauth_authorization_codes
             (id, code_hash, account_id, client_id, session_id, grant_id,
              redirect_uri, code_challenge, resource, issued_scopes,
              expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   now() + interval '5 minutes')`,
          authorizationCodeValues
        )
      ).rejects.toMatchObject({
        constraint: "oauth_authorization_codes_redirect_uri_fk"
      });

      await expect(
        pool.query(
          `insert into oauth_refresh_token_families
             (id, account_id, client_id, session_id, grant_id, expires_at,
              reuse_detected_at)
           values ($1, $2, $3, $4, $5, now() + interval '1 day', now())`,
          [randomUUID(), accountId, clientId, sessionId, grantId]
        )
      ).rejects.toMatchObject({
        constraint: "oauth_refresh_families_reuse_revokes"
      });

      const familyId = randomUUID();
      await pool.query(
        `insert into oauth_refresh_token_families
           (id, account_id, client_id, session_id, grant_id, expires_at)
         values ($1, $2, $3, $4, $5, now() + interval '1 day')`,
        [familyId, accountId, clientId, sessionId, grantId]
      );
      await pool.query(
        `insert into oauth_refresh_tokens
           (id, family_id, generation, token_hash, account_id, client_id,
            session_id, grant_id, resource, issued_scopes, expires_at)
         values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9,
                 now() + interval '1 day')`,
        [
          randomUUID(),
          familyId,
          randomBytes(32),
          accountId,
          clientId,
          sessionId,
          grantId,
          "https://api.example.test",
          ["person:read"]
        ]
      );
      await pool.query(
        `insert into oauth_refresh_tokens
           (id, family_id, generation, token_hash, account_id, client_id,
            session_id, grant_id, resource, issued_scopes, expires_at,
            consumed_at, replaced_by_generation)
         values ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9,
                 now() + interval '1 day', now(), 1)`,
        [
          randomUUID(),
          familyId,
          randomBytes(32),
          accountId,
          clientId,
          sessionId,
          grantId,
          "https://api.example.test",
          ["person:read"]
        ]
      );

      await expect(
        pool.query(
          `insert into oauth_refresh_tokens
             (id, family_id, generation, token_hash, account_id, client_id,
              session_id, grant_id, resource, issued_scopes, expires_at,
              consumed_at, replaced_by_generation)
           values ($1, $2, 2, $3, $4, $5, $6, $7, $8, $9,
                   now() + interval '1 day', now(), 0)`,
          [
            randomUUID(),
            familyId,
            randomBytes(32),
            accountId,
            clientId,
            sessionId,
            grantId,
            "https://api.example.test",
            ["person:read"]
          ]
        )
      ).rejects.toMatchObject({
        constraint: "oauth_refresh_tokens_next_generation"
      });
    } finally {
      await pool.end();
    }
  });
});
