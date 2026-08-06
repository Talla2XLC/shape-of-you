import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runIdentityMigrations } from "../src/database/migrate.js";
import {
  checkIdentityDatabaseReadiness,
  createIdentityDatabase
} from "../src/database/context.js";

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
  it("checks the runtime database connection through the owned pool", async () => {
    const database = createIdentityDatabase(container.getConnectionUri(), 1);

    try {
      await expect(
        checkIdentityDatabaseReadiness(database)
      ).resolves.toBeUndefined();
    } finally {
      await database.pool.end();
    }
  });

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

  it("upgrades existing sessions and backfills their activity time", async () => {
    const journal = JSON.parse(
      await readFile(new URL("meta/_journal.json", migrationsFolder), "utf8")
    ) as MigrationJournal;
    const priorEntries = journal.entries.slice(0, -1);
    const sources = new Map(
      (await migrationSources()).map((source) => [source.tag, source.contents])
    );
    const temporaryMigrations = await mkdtemp(
      join(tmpdir(), "shape-of-you-identity-upgrade-")
    );
    const temporaryMeta = join(temporaryMigrations, "meta");
    const databaseName = `identity_upgrade_${randomUUID().replaceAll("-", "")}`;
    const adminPool = new Pool({ connectionString: container.getConnectionUri() });
    const upgradeUrl = new URL(container.getConnectionUri());
    upgradeUrl.pathname = `/${databaseName}`;

    try {
      await mkdir(temporaryMeta);
      await writeFile(
        join(temporaryMeta, "_journal.json"),
        JSON.stringify({ entries: priorEntries, version: "7", dialect: "postgresql" })
      );
      for (const entry of priorEntries) {
        const contents = sources.get(entry.tag);
        if (contents === undefined) {
          throw new Error(`Missing generated migration source: ${entry.tag}`);
        }
        await writeFile(join(temporaryMigrations, `${entry.tag}.sql`), contents);
      }

      await adminPool.query(`create database "${databaseName}"`);
      const legacyDatabase = createIdentityDatabase(upgradeUrl.toString(), 1);
      try {
        await migrate(legacyDatabase.db, {
          migrationsFolder: temporaryMigrations
        });
        const accountId = randomUUID();
        await legacyDatabase.pool.query(
          `insert into identity_accounts
             (id, subject, webauthn_user_handle, display_name)
           values ($1, $2, $3, $4)`,
          [accountId, randomUUID(), randomBytes(32), "Upgrade test account"]
        );
        await legacyDatabase.pool.query(
          `insert into oauth_sessions
             (id, account_id, credential_hash, provider_uid, authenticated_at,
              acr, amr, last_activity_at, expires_at)
           values ($1, $2, $3, $4, now() - interval '1 minute', $5,
                   ARRAY['recovery'], now() - interval '1 minute',
                   now() + interval '30 days' - interval '1 minute')`,
          [randomUUID(), accountId, randomBytes(32), randomUUID(), "urn:soy:recovery"]
        );
      } finally {
        await legacyDatabase.pool.end();
      }

      await runIdentityMigrations(upgradeUrl.toString());

      const upgradedPool = new Pool({ connectionString: upgradeUrl.toString() });
      try {
        const result = await upgradedPool.query<{
          authenticated_at: Date;
          csrf_token_hash: Buffer;
          expires_at: Date;
          last_activity_at: Date;
          revoked_at: Date;
        }>(
          `select authenticated_at, csrf_token_hash, last_activity_at,
                  expires_at, revoked_at
             from oauth_sessions`
        );
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0]!.last_activity_at).toEqual(
          result.rows[0]!.authenticated_at
        );
        expect(result.rows[0]!.expires_at.getTime()).toBe(
          result.rows[0]!.authenticated_at.getTime() + 30 * 24 * 60 * 60 * 1_000
        );
        expect(result.rows[0]!.csrf_token_hash).toEqual(Buffer.alloc(32));
        expect(result.rows[0]!.revoked_at).toBeInstanceOf(Date);
      } finally {
        await upgradedPool.end();
      }
    } finally {
      await adminPool.end();
      await rm(temporaryMigrations, { force: true, recursive: true });
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
        "identity_security_events",
        "initial_passkey_enrollments",
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
        "oauth_signing_keys",
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

      const privateKeyColumns = await pool.query<{
        column_name: string;
        table_name: string;
      }>(
        `select table_name, column_name
           from information_schema.columns
          where table_schema = 'public'
            and column_name in
                ('private_key', 'private_key_pem', 'private_jwk', 'jwk',
                 'secret_value', 'key_material')`
      );
      expect(privateKeyColumns.rows).toEqual([]);
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

      await expect(
        pool.query(
          `insert into webauthn_challenges
             (id, purpose, challenge_hash, expected_rp_id, expected_origin,
              user_verification, expires_at)
           values ($1, 'authentication', $2, $3, $4, 'required',
                   now() + interval '5 minutes 1 second')`,
          [
            randomUUID(),
            randomBytes(32),
            "identity.example.test",
            "https://identity.example.test"
          ]
        )
      ).rejects.toMatchObject({
        constraint: "webauthn_challenges_max_lifetime"
      });
    } finally {
      await pool.end();
    }
  });

  it("enforces hashed, short-lived, single-state initial enrollment", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const accountId = randomUUID();
    try {
      await pool.query(
        `insert into identity_accounts
           (id, subject, webauthn_user_handle, display_name)
         values ($1, $2, $3, $4)`,
        [accountId, randomUUID(), randomBytes(32), "Enrollment policy account"]
      );
      await expect(
        pool.query(
          `insert into initial_passkey_enrollments
             (id, account_id, token_hash, expires_at)
           values ($1, $2, $3, now() + interval '15 minutes 1 second')`,
          [randomUUID(), accountId, randomBytes(32)]
        )
      ).rejects.toMatchObject({
        constraint: "initial_passkey_enrollments_lifetime"
      });
      await expect(
        pool.query(
          `insert into initial_passkey_enrollments
             (id, account_id, token_hash, expires_at, consumed_at, invalidated_at)
           values ($1, $2, $3, now() + interval '15 minutes', now(), now())`,
          [randomUUID(), accountId, randomBytes(32)]
        )
      ).rejects.toMatchObject({
        constraint: "initial_passkey_enrollments_terminal_state"
      });
    } finally {
      await pool.end();
    }
  });

  it("binds passkey sessions to one account and a 30-day idle window", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const firstAccountId = randomUUID();
    const secondAccountId = randomUUID();
    const credentialId = randomUUID();
    try {
      for (const accountId of [firstAccountId, secondAccountId]) {
        await pool.query(
          `insert into identity_accounts
             (id, subject, webauthn_user_handle, display_name)
           values ($1, $2, $3, $4)`,
          [accountId, randomUUID(), randomBytes(32), "Session policy account"]
        );
      }
      await pool.query(
        `insert into webauthn_credentials
           (id, account_id, credential_id, public_key, device_type)
         values ($1, $2, $3, $4, 'multi_device')`,
        [credentialId, firstAccountId, randomBytes(32), randomBytes(64)]
      );

      const insertSession = (accountId: string, expiresInterval: string) =>
        pool.query(
          `insert into oauth_sessions
             (id, account_id, webauthn_credential_id, credential_hash,
              csrf_token_hash, provider_uid, authenticated_at, acr, amr,
              last_activity_at, expires_at)
           values ($1, $2, $3, $4, $5, $6, now(), $7, ARRAY['passkey'], now(),
                   now() + $8::interval)`,
          [
            randomUUID(),
            accountId,
            credentialId,
            randomBytes(32),
            randomBytes(32),
            randomUUID(),
            "urn:soy:passkey",
            expiresInterval
          ]
        );

      await expect(
        insertSession(secondAccountId, "1 day")
      ).rejects.toMatchObject({
        constraint: "oauth_sessions_webauthn_credential_account_fk"
      });
      await expect(
        insertSession(firstAccountId, "30 days 1 second")
      ).rejects.toMatchObject({
        constraint: "oauth_sessions_activity_window"
      });
      await expect(insertSession(firstAccountId, "30 days")).resolves.toBeDefined();
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
    const webauthnCredentialId = randomUUID();
    try {
      await pool.query(
        `insert into identity_accounts
           (id, subject, webauthn_user_handle, display_name)
         values ($1, $2, $3, $4)`,
        [accountId, randomUUID(), randomBytes(32), "OAuth migration account"]
      );
      await pool.query(
        `insert into webauthn_credentials
           (id, account_id, credential_id, public_key, device_type)
         values ($1, $2, $3, $4, 'multi_device')`,
        [webauthnCredentialId, accountId, randomBytes(32), randomBytes(64)]
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
           (id, account_id, webauthn_credential_id, credential_hash,
            csrf_token_hash, provider_uid, authenticated_at, acr, amr,
            last_activity_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, now() - interval '1 second', $7,
                 ARRAY['passkey'], now(), now() + interval '1 hour')`,
        [
          sessionId,
          accountId,
          webauthnCredentialId,
          randomBytes(32),
          randomBytes(32),
          randomUUID(),
          "urn:soy:passkey"
        ]
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

  it("enforces signing-key rotation and typed security-event boundaries", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const accountId = randomUUID();
    const clientId = "security-event-test-client";
    const sessionId = randomUUID();
    const webauthnCredentialId = randomUUID();
    const firstKeyId = randomUUID();
    const secondKeyId = randomUUID();
    try {
      await pool.query(
        `insert into identity_accounts
           (id, subject, webauthn_user_handle, display_name)
         values ($1, $2, $3, $4)`,
        [accountId, randomUUID(), randomBytes(32), "Security event account"]
      );
      await pool.query(
        `insert into webauthn_credentials
           (id, account_id, credential_id, public_key, device_type)
         values ($1, $2, $3, $4, 'multi_device')`,
        [webauthnCredentialId, accountId, randomBytes(32), randomBytes(64)]
      );
      await pool.query(
        `insert into oauth_clients (id, display_name)
         values ($1, $2)`,
        [clientId, "Security event client"]
      );
      await pool.query(
        `insert into oauth_sessions
           (id, account_id, webauthn_credential_id, credential_hash,
            csrf_token_hash, provider_uid, authenticated_at, acr, amr,
            last_activity_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, now(), $7, ARRAY['passkey'], now(),
                 now() + interval '1 hour')`,
        [
          sessionId,
          accountId,
          webauthnCredentialId,
          randomBytes(32),
          randomBytes(32),
          randomUUID(),
          "urn:soy:passkey"
        ]
      );
      await pool.query(
        `insert into oauth_signing_keys
           (id, key_id, algorithm, public_key_spki, secret_provider_handle,
            status, published_at, activated_at)
         values ($1, $2, 'ES256', $3, $4, 'active', now(), now())`,
        [firstKeyId, "test-key-1", randomBytes(91), "secret-provider/key-1"]
      );

      await expect(
        pool.query(
          `insert into oauth_signing_keys
             (id, key_id, algorithm, public_key_spki, secret_provider_handle,
              status, published_at, activated_at)
           values ($1, $2, 'ES256', $3, $4, 'active', now(), now())`,
          [secondKeyId, "test-key-2", randomBytes(91), "secret-provider/key-2"]
        )
      ).rejects.toMatchObject({
        constraint: "oauth_signing_keys_one_active_uq"
      });

      await expect(
        pool.query(
          `insert into oauth_signing_keys
             (id, key_id, algorithm, public_key_spki, secret_provider_handle,
              status, activated_at)
           values ($1, $2, 'ES256', $3, $4, 'staged', now())`,
          [randomUUID(), "invalid-staged-key", randomBytes(91), "secret-provider/invalid"]
        )
      ).rejects.toMatchObject({
        constraint: "oauth_signing_keys_activated_after_publish"
      });

      await pool.query(
        `update oauth_signing_keys
            set status = 'verifying', signing_stopped_at = now()
          where id = $1`,
        [firstKeyId]
      );
      await pool.query(
        `insert into oauth_signing_keys
           (id, key_id, algorithm, public_key_spki, secret_provider_handle,
            status, published_at, activated_at)
         values ($1, $2, 'ES256', $3, $4, 'active', now(), now())`,
        [secondKeyId, "test-key-2", randomBytes(91), "secret-provider/key-2"]
      );

      await pool.query(
        `insert into identity_security_events
           (id, event_type, outcome, actor_kind, actor_account_id, account_id,
            client_id, session_id, signing_key_id, correlation_id,
            source_address_hash, user_agent_hash)
         values ($1, 'signing_key_lifecycle_changed', 'succeeded', 'account',
                 $2, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          accountId,
          clientId,
          sessionId,
          secondKeyId,
          "security-event-correlation",
          randomBytes(32),
          randomBytes(32)
        ]
      );

      await expect(
        pool.query(
          `insert into identity_security_events
             (id, event_type, outcome, actor_kind, actor_account_id,
              correlation_id)
           values ($1, 'passkey_authentication', 'denied', 'anonymous', $2, $3)`,
          [randomUUID(), accountId, "invalid-anonymous-actor"]
        )
      ).rejects.toMatchObject({
        constraint: "identity_security_events_actor_account"
      });

      await expect(
        pool.query(
          `insert into identity_security_events
             (id, event_type, outcome, actor_kind, correlation_id,
              source_address_hash)
           values ($1, 'passkey_authentication', 'failed', 'anonymous', $2, $3)`,
          [randomUUID(), "invalid-source-hash", randomBytes(31)]
        )
      ).rejects.toMatchObject({
        constraint: "identity_security_events_source_hash_length"
      });

      await expect(
        pool.query(
          `insert into identity_security_events
             (id, event_type, outcome, actor_kind, session_id, correlation_id)
           values ($1, 'oauth_session_revoked', 'succeeded', 'system', $2, $3)`,
          [randomUUID(), sessionId, "missing-session-account"]
        )
      ).rejects.toMatchObject({
        constraint: "identity_security_events_session_account"
      });
    } finally {
      await pool.end();
    }
  });
});
