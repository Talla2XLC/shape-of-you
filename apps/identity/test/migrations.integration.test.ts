import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID
} from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createNetServer } from "node:net";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { AdapterPayload } from "oidc-provider";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runIdentityMigrations } from "../src/database/migrate.js";
import { createIdentityServer } from "../src/app.js";
import {
  IdentityAuthenticationService,
  identityCsrfCookieName,
  identitySessionCookieName
} from "../src/authentication/service.js";
import {
  IdentityAccountSubjectNotFoundError,
  IdentityAccountSubjectStore
} from "../src/authentication/account-subject-store.js";
import { SimpleWebAuthnAdapter } from "../src/authentication/webauthn-adapter.js";
import {
  checkIdentityDatabaseReadiness,
  createIdentityDatabase
} from "../src/database/context.js";
import { OAuthSigningKeyStore } from "../src/oauth/signing-key-store.js";
import { parseOAuthSigningKeyRing } from "../src/oauth/signing-keys.js";
import { OAuthClientStore } from "../src/oauth/client-store.js";
import { createOAuthProviderAdapterFactory } from "../src/oauth/provider-adapter.js";
import { OAuthRequestContext } from "../src/oauth/request-context.js";
import { OAuthRuntime } from "../src/oauth/runtime.js";
import { OAuthBrowserUi } from "../src/oauth/browser-ui.js";

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

  it("resolves only the immutable public subject for an exact account", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const store = new IdentityAccountSubjectStore(pool);
    const accountId = randomUUID();
    const subject = randomUUID();
    try {
      await pool.query(
        `insert into identity_accounts
           (id, subject, webauthn_user_handle, display_name)
         values ($1, $2, $3, $4)`,
        [accountId, subject, randomBytes(32), "Subject lookup fixture"]
      );

      await expect(store.findExact(accountId)).resolves.toEqual({
        accountId,
        subject
      });
      await expect(store.findExact(randomUUID())).rejects.toBeInstanceOf(
        IdentityAccountSubjectNotFoundError
      );
    } finally {
      await pool.query("delete from identity_accounts where id = $1", [accountId]);
      await pool.end();
    }
  });

  it("upgrades existing sessions and backfills their CSRF state", async () => {
    const journal = JSON.parse(
      await readFile(new URL("meta/_journal.json", migrationsFolder), "utf8")
    ) as MigrationJournal;
    const csrfMigrationIndex = journal.entries.findIndex(
      (entry) => entry.tag === "20260806075426_mysterious_malcolm_colcord"
    );
    expect(csrfMigrationIndex).toBeGreaterThan(0);
    const priorEntries = journal.entries.slice(0, csrfMigrationIndex);
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

  it("fails the OAuth provider-state upgrade before inventing legacy interaction data", async () => {
    const journal = JSON.parse(
      await readFile(new URL("meta/_journal.json", migrationsFolder), "utf8")
    ) as MigrationJournal;
    const providerStateMigrationIndex = journal.entries.findIndex(
      (entry) => entry.tag === "20260806171723_spotty_arachne"
    );
    const idTokenHintMigrationIndex = journal.entries.findIndex(
      (entry) => entry.tag === "20260810152202_solid_ultimates"
    );
    expect(providerStateMigrationIndex).toBeGreaterThan(0);
    expect(idTokenHintMigrationIndex).toBe(providerStateMigrationIndex + 1);
    expect(idTokenHintMigrationIndex).toBe(journal.entries.length - 1);
    const priorEntries = journal.entries.slice(0, providerStateMigrationIndex);
    const sources = new Map(
      (await migrationSources()).map((source) => [source.tag, source.contents])
    );
    const temporaryMigrations = await mkdtemp(
      join(tmpdir(), "shape-of-you-identity-provider-upgrade-")
    );
    const temporaryMeta = join(temporaryMigrations, "meta");
    const databaseName = `identity_provider_upgrade_${randomUUID().replaceAll("-", "")}`;
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
        await migrate(legacyDatabase.db, { migrationsFolder: temporaryMigrations });
        await legacyDatabase.pool.query(
          `insert into oauth_clients (id, display_name)
           values ('legacy-client', 'Legacy client')`
        );
        await legacyDatabase.pool.query(
          `insert into oauth_client_redirect_uris (id, client_id, redirect_uri)
           values ($1, 'legacy-client', 'https://legacy.example.test/callback')`,
          [randomUUID()]
        );
        await legacyDatabase.pool.query(
          `insert into oauth_interactions
             (id, credential_hash, client_id, prompt, redirect_uri,
              code_challenge, expires_at)
           values ($1, $2, 'legacy-client', 'login', $3, $4,
                   now() + interval '10 minutes')`,
          [
            randomUUID(),
            randomBytes(32),
            "https://legacy.example.test/callback",
            "P".repeat(43)
          ]
        );
      } finally {
        await legacyDatabase.pool.end();
      }

      await expect(runIdentityMigrations(upgradeUrl.toString())).rejects.toThrow(
        "OAuth interaction provider state cannot be backfilled"
      );
      const failedUpgradePool = new Pool({ connectionString: upgradeUrl.toString() });
      try {
        const columns = await failedUpgradePool.query<{ count: string }>(
          `select count(*)::text as count
             from information_schema.columns
            where table_schema = 'public' and table_name = 'oauth_interactions'
              and column_name in ('provider_cid', 'provider_return_to')`
        );
        expect(columns.rows[0]?.count).toBe("0");
      } finally {
        await failedUpgradePool.end();
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
        "totp_credentials",
        "totp_recovery_challenge_bindings",
        "totp_recovery_sessions",
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

  it("activates and rotates external OAuth signing keys without private-key persistence", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const privateKeyValue = (): string => {
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      return privateKey
        .export({ format: "der", type: "pkcs8" })
        .toString("base64url");
    };
    const first = privateKeyValue();
    const second = privateKeyValue();
    const store = new OAuthSigningKeyStore(pool);
    try {
      await store.reconcile(
        parseOAuthSigningKeyRing("v1", JSON.stringify({ v1: first }))
      );
      await store.reconcile(
        parseOAuthSigningKeyRing(
          "v2",
          JSON.stringify({ v1: first, v2: second })
        )
      );

      const rows = await pool.query<{
        key_id: string;
        secret_provider_handle: string;
        status: string;
      }>(
        `select key_id, secret_provider_handle, status
           from oauth_signing_keys
          order by key_id`
      );
      expect(rows.rows).toEqual([
        { key_id: "v1", secret_provider_handle: "env:v1", status: "verifying" },
        { key_id: "v2", secret_provider_handle: "env:v2", status: "active" }
      ]);
      const events = await pool.query<{ count: string }>(
        `select count(*)::text as count from identity_security_events
          where event_type = 'signing_key_lifecycle_changed'
            and signing_key_id in (
              select id from oauth_signing_keys where secret_provider_handle like 'env:%'
            )`
      );
      expect(events.rows[0]?.count).toBe("3");
      await expect(
        store.reconcile(
          parseOAuthSigningKeyRing("v2", JSON.stringify({ v2: second }))
        )
      ).rejects.toThrow("still required for verification");
    } finally {
      await pool.query(
        `delete from identity_security_events where signing_key_id in (
           select id from oauth_signing_keys where secret_provider_handle like 'env:%'
         )`
      );
      await pool.query(
        "delete from oauth_signing_keys where secret_provider_handle like 'env:%'"
      );
      await pool.end();
    }
  });

  it("provisions one exact public OAuth client without a client secret", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const store = new OAuthClientStore(pool);
    try {
      await store.provisionPublicClient({
        clientId: "chatgpt",
        displayName: "ChatGPT",
        redirectUris: ["https://chatgpt.com/connector/oauth/callback-id"],
        allowedScopes: ["person:read", "weight:write"],
        refreshTokensEnabled: true
      });
      await store.provisionPublicClient({
        clientId: "chatgpt",
        displayName: "ChatGPT connector",
        redirectUris: ["https://chatgpt.com/connector/oauth/new-callback-id"],
        allowedScopes: ["openid", "person:read"],
        refreshTokensEnabled: true
      });

      await expect(store.findProviderClient("chatgpt")).resolves.toEqual({
        application_type: "web",
        client_id: "chatgpt",
        client_name: "ChatGPT connector",
        grant_types: ["authorization_code", "refresh_token"],
        id_token_signed_response_alg: "ES256",
        redirect_uris: ["https://chatgpt.com/connector/oauth/new-callback-id"],
        response_types: ["code"],
        scope: "openid person:read",
        token_endpoint_auth_method: "none"
      });
      await expect(store.listAllowedScopes("chatgpt")).resolves.toEqual(
        new Set(["openid", "person:read"])
      );
      await expect(store.provisionPublicClient({
        clientId: "invalid-offline-client",
        displayName: "Invalid offline client",
        redirectUris: ["https://chatgpt.com/connector/oauth/invalid-offline"],
        allowedScopes: ["openid", "offline_access"],
        refreshTokensEnabled: false
      })).rejects.toThrow("offline access requires refresh tokens");
    } finally {
      await pool.end();
    }
  });

  it("persists provider interactions and binds the exact passkey session", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const clients = new OAuthClientStore(pool);
    const requestContext = new OAuthRequestContext();
    const resource = "https://api.example.test/mcp";
    const issuer = "https://identity.example.test";
    const adapters = createOAuthProviderAdapterFactory({
      pool,
      clients,
      requestContext,
      issuer,
      resource
    });
    const accountId = randomUUID();
    const subject = randomUUID();
    const mismatchedAccountId = randomUUID();
    const credentialId = randomUUID();
    const sessionId = randomUUID();
    const interactionCredential = "I".repeat(43);
    const providerCredential = "S".repeat(43);
    const providerUid = "U".repeat(43);
    const idTokenHint = [
      Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub: subject })).toString("base64url"),
      "H".repeat(86)
    ].join(".");
    const now = Math.floor(Date.now() / 1_000);
    try {
      await pool.query(
        `insert into identity_accounts
           (id, subject, webauthn_user_handle, display_name)
         values ($1, $2, $3, $4)`,
        [accountId, subject, randomBytes(32), "OAuth adapter account"]
      );
      await pool.query(
        `insert into identity_accounts
           (id, subject, webauthn_user_handle, display_name)
         values ($1, $2, $3, $4)`,
        [mismatchedAccountId, randomUUID(), randomBytes(32), "Other OAuth account"]
      );
      await pool.query(
        `insert into webauthn_credentials
           (id, account_id, credential_id, public_key, device_type)
         values ($1, $2, $3, $4, 'multi_device')`,
        [credentialId, accountId, randomBytes(32), randomBytes(64)]
      );
      await pool.query(
        `insert into oauth_sessions
           (id, account_id, webauthn_credential_id, credential_hash,
            csrf_token_hash, provider_uid, authenticated_at, acr, amr,
            last_activity_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, to_timestamp($7), $8,
                 ARRAY['passkey'], to_timestamp($7), to_timestamp($9))`,
        [
          sessionId,
          accountId,
          credentialId,
          randomBytes(32),
          randomBytes(32),
          randomUUID(),
          now,
          "urn:soy:passkey",
          now + 3_600
        ]
      );

      const interaction = adapters("Interaction");
      await interaction.upsert(
        interactionCredential,
        {
          cid: "C".repeat(43),
          exp: now + 600,
          iat: now,
          jti: interactionCredential,
          kind: "Interaction",
          params: {
            client_id: "chatgpt",
            code_challenge: "P".repeat(43),
            code_challenge_method: "S256",
            id_token_hint: idTokenHint,
            redirect_uri: "https://chatgpt.com/connector/oauth/new-callback-id",
            resource,
            response_type: "code",
            scope: "openid person:read",
            state: "state"
          },
          prompt: { name: "login", reasons: ["no_session"], details: {} },
          returnTo: `${issuer}/auth/${interactionCredential}`
        },
        600
      );
      const persistedHint = await pool.query<{ id_token_hint_subject: string | null }>(
        `select id_token_hint_subject
           from oauth_interactions
          where credential_hash = $1`,
        [createHash("sha256").update(interactionCredential).digest()]
      );
      expect(persistedHint.rows[0]?.id_token_hint_subject).toBe(subject);
      await expect(interaction.find(interactionCredential)).resolves.toMatchObject({
        params: expect.not.objectContaining({ id_token_hint: expect.anything() })
      });
      await pool.query(
        `update oauth_interactions
            set account_id = $2, session_id = $3
          where credential_hash = $1`,
        [createHash("sha256").update(interactionCredential).digest(), accountId, sessionId]
      );

      const session = adapters("Session");
      const sessionCountBeforePlaceholder = await pool.query<{ count: string }>(
        "select count(*)::text as count from oauth_sessions"
      );
      await session.upsert("U".repeat(43), {
        exp: now + 3_600,
        iat: now,
        jti: "U".repeat(43),
        kind: "Session",
        uid: randomUUID()
      });
      const sessionCountAfterPlaceholder = await pool.query<{ count: string }>(
        "select count(*)::text as count from oauth_sessions"
      );
      expect(sessionCountAfterPlaceholder.rows[0]?.count).toBe(
        sessionCountBeforePlaceholder.rows[0]?.count
      );
      await expect(
        session.upsert("V".repeat(43), {
          acr: "urn:soy:passkey",
          exp: now + 3_600,
          iat: now,
          jti: "V".repeat(43),
          kind: "Session",
          uid: randomUUID()
        })
      ).rejects.toThrow("OAuth Session without an account contains bound state");
      await requestContext.run(interactionCredential, () =>
        session.upsert(providerCredential, {
          accountId,
          acr: "urn:soy:passkey",
          amr: ["passkey"],
          exp: now + 3_600,
          iat: now,
          jti: providerCredential,
          kind: "Session",
          loginTs: now,
          uid: providerUid
        })
      );

      await expect(session.find(providerCredential)).resolves.toMatchObject({
        accountId,
        jti: providerCredential,
        uid: providerUid
      });
      await expect(session.findByUid(providerUid)).resolves.toMatchObject({
        accountId,
        uid: providerUid
      });
      const pendingInteraction = (await interaction.find(interactionCredential))!;
      await expect(
        interaction.upsert(interactionCredential, {
          ...pendingInteraction,
          result: {
            login: {
              accountId: mismatchedAccountId,
              acr: "urn:soy:passkey",
              amr: ["passkey"],
              remember: true,
              ts: now
            }
          }
        })
      ).rejects.toThrow("does not match the ID token hint subject");
      await interaction.upsert(interactionCredential, {
        ...pendingInteraction,
        result: {
          login: {
            accountId,
            acr: "urn:soy:passkey",
            amr: ["passkey"],
            remember: true,
            ts: now
          }
        }
      });
      await expect(
        session.upsert("N".repeat(43), {
          accountId,
          acr: "urn:soy:passkey",
          amr: ["passkey"],
          exp: now + 3_600,
          iat: now,
          jti: "N".repeat(43),
          kind: "Session",
          loginTs: now,
          uid: providerUid
        })
      ).rejects.toThrow("OAuth provider Session is not already bound");

      const grantId = randomUUID();
      const grant = adapters("Grant");
      await grant.upsert(grantId, {
        accountId,
        clientId: "chatgpt",
        iat: now,
        jti: grantId,
        kind: "Grant",
        openid: { scope: "openid" },
        rejected: { openid: { scope: "person:read" } },
        resources: { [resource]: "person:read" }
      });
      await session.upsert(providerCredential, {
        accountId,
        acr: "urn:soy:passkey",
        amr: ["passkey"],
        authorizations: { chatgpt: { grantId } },
        exp: now + 3_600,
        iat: now,
        jti: providerCredential,
        kind: "Session",
        loginTs: now,
        uid: providerUid
      });

      const authorizationCodeValue = "A".repeat(43);
      const authorizationCode = adapters("AuthorizationCode");
      await authorizationCode.upsert(authorizationCodeValue, {
        accountId,
        acr: "urn:soy:passkey",
        amr: ["passkey"],
        authTime: now,
        clientId: "chatgpt",
        codeChallenge: "P".repeat(43),
        codeChallengeMethod: "S256",
        exp: now + 600,
        expiresWithSession: true,
        grantId,
        iat: now,
        jti: authorizationCodeValue,
        kind: "AuthorizationCode",
        redirectUri: "https://chatgpt.com/connector/oauth/new-callback-id",
        resource,
        scope: "person:read",
        sessionUid: providerUid
      });
      await pool.query(
        `update oauth_authorization_codes
            set created_at = now() + interval '5 seconds',
                expires_at = now() + interval '10 minutes'
          where code_hash = $1`,
        [createHash("sha256").update(authorizationCodeValue).digest()]
      );
      await expect(authorizationCode.find(authorizationCodeValue)).resolves.toMatchObject({
        accountId,
        consumed: undefined,
        grantId,
        sessionUid: providerUid
      });
      const codeConsumption = await Promise.allSettled([
        authorizationCode.consume(authorizationCodeValue),
        authorizationCode.consume(authorizationCodeValue)
      ]);
      expect(codeConsumption.map((result) => result.status).sort()).toEqual([
        "fulfilled",
        "rejected"
      ]);
      await expect(authorizationCode.find(authorizationCodeValue)).resolves.toMatchObject({
        consumed: expect.any(Number)
      });

      const refreshToken = adapters("RefreshToken");
      const firstRefreshValue = "R".repeat(43);
      const concurrentRefreshValue = "Q".repeat(43);
      const initialRefreshPayload: Omit<AdapterPayload, "jti"> = {
        accountId,
        acr: "urn:soy:passkey",
        amr: ["passkey"],
        authTime: now,
        clientId: "chatgpt",
        exp: now + 3_600,
        expiresWithSession: true,
        grantId,
        gty: "authorization_code",
        iat: now,
        iiat: now,
        kind: "RefreshToken",
        resource,
        rotations: 0,
        scope: "person:read",
        sessionUid: providerUid
      };
      await Promise.all([
        refreshToken.upsert(firstRefreshValue, {
          ...initialRefreshPayload,
          jti: firstRefreshValue
        }),
        refreshToken.upsert(concurrentRefreshValue, {
          ...initialRefreshPayload,
          jti: concurrentRefreshValue
        })
      ]);
      const initialRefreshStates = await Promise.all([
        refreshToken.find(firstRefreshValue),
        refreshToken.find(concurrentRefreshValue)
      ]);
      expect(initialRefreshStates.filter(Boolean)).toHaveLength(1);
      const activeInitialRefreshValue = initialRefreshStates[0]
        ? firstRefreshValue
        : concurrentRefreshValue;
      const supersededInitialRefreshValue = initialRefreshStates[0]
        ? concurrentRefreshValue
        : firstRefreshValue;
      await expect(
        refreshToken.find(supersededInitialRefreshValue)
      ).resolves.toBeUndefined();
      const prematureReuseAudit = await pool.query(
        `select id from identity_security_events
          where account_id = $1 and event_type = 'oauth_refresh_reuse_detected'`,
        [accountId]
      );
      expect(prematureReuseAudit.rowCount).toBe(0);
      await refreshToken.consume(activeInitialRefreshValue);
      const secondRefreshValue = "T".repeat(43);
      await refreshToken.upsert(secondRefreshValue, {
        accountId,
        acr: "urn:soy:passkey",
        amr: ["passkey"],
        authTime: now,
        clientId: "chatgpt",
        exp: now + 3_600,
        expiresWithSession: true,
        grantId,
        gty: "authorization_code refresh_token",
        iat: now,
        iiat: now,
        jti: secondRefreshValue,
        kind: "RefreshToken",
        resource,
        rotations: 1,
        scope: "person:read",
        sessionUid: providerUid
      });
      await expect(refreshToken.find(secondRefreshValue)).resolves.toMatchObject({
        rotations: 1,
        scope: "person:read"
      });
      const refreshConsumption = await Promise.allSettled([
        refreshToken.consume(secondRefreshValue),
        refreshToken.consume(secondRefreshValue)
      ]);
      expect(refreshConsumption.map((result) => result.status).sort()).toEqual([
        "fulfilled",
        "rejected"
      ]);
      await expect(refreshToken.find(secondRefreshValue)).resolves.toBeUndefined();
      const family = await pool.query<{ id: string; reuse_detected_at: Date | null }>(
        `select id, reuse_detected_at
           from oauth_refresh_token_families
          where grant_id = $1 and reuse_detected_at is not null`,
        [grantId]
      );
      expect(family.rows[0]?.reuse_detected_at).toBeInstanceOf(Date);
      const audit = await pool.query<{ event_type: string }>(
        `select event_type from identity_security_events
          where correlation_id in ($1, $2)
          order by event_type`,
        [grantId, family.rows[0]!.id]
      );
      expect(audit.rows.map((row) => row.event_type)).toEqual([
        "oauth_code_exchange",
        "oauth_refresh_rotation",
        "oauth_refresh_reuse_detected"
      ]);

      await expect(
        interaction.upsert(interactionCredential, {
          ...((await interaction.find(interactionCredential)) ?? {}),
          unsupported: true
        })
      ).rejects.toThrow("unsupported fields");
    } finally {
      await pool.end();
    }
  });

  it("serves discovery, JWKS, authorization and the passkey interaction page", async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    const clients = new OAuthClientStore(pool);
    const keyId = `runtime-${randomUUID()}`;
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const keyValue = privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64url");
    const signingKeys = parseOAuthSigningKeyRing(
      keyId,
      JSON.stringify({ [keyId]: keyValue })
    );
    const probe = createNetServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", resolve);
    });
    const address = probe.address();
    if (!address || typeof address === "string") throw new Error("Loopback port is unavailable");
    const port = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const issuer = `http://127.0.0.1:${port}`;
    const resource = "https://api.runtime.example.test/mcp";
    const accountId = randomUUID();
    const subject = randomUUID();
    const credentialId = randomUUID();
    const sessionId = randomUUID();
    const sessionCredential = "B".repeat(43);
    const csrfToken = "D".repeat(43);
    let server: ReturnType<typeof createIdentityServer> | undefined;
    try {
      await new OAuthSigningKeyStore(pool).reconcile(signingKeys);
      await clients.provisionPublicClient({
        clientId: "chatgpt-runtime",
        displayName: "ChatGPT runtime",
        redirectUris: ["https://chatgpt.com/connector/oauth/runtime-callback"],
        allowedScopes: ["openid", "offline_access", "person:read"],
        refreshTokensEnabled: true
      });
      await pool.query(
        `insert into identity_accounts
           (id, subject, webauthn_user_handle, display_name)
         values ($1, $2, $3, $4)`,
        [accountId, subject, randomBytes(32), "Runtime account"]
      );
      await pool.query(
        `insert into webauthn_credentials
           (id, account_id, credential_id, public_key, device_type)
         values ($1, $2, $3, $4, 'multi_device')`,
        [credentialId, accountId, randomBytes(32), randomBytes(64)]
      );
      await pool.query(
        `insert into oauth_sessions
           (id, account_id, webauthn_credential_id, credential_hash,
            csrf_token_hash, provider_uid, authenticated_at, acr, amr,
            last_activity_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, now(), 'urn:soy:passkey',
                 ARRAY['passkey'], now(), now() + interval '30 days')`,
        [
          sessionId,
          accountId,
          credentialId,
          createHash("sha256").update(sessionCredential).digest(),
          createHash("sha256").update(csrfToken).digest(),
          randomUUID()
        ]
      );
      const runtime = new OAuthRuntime({
        pool,
        issuer,
        resource,
        signingKeys,
        cookieKeys: [randomBytes(32).toString("base64url")]
      });
      const authentication = new IdentityAuthenticationService(
        pool,
        new SimpleWebAuthnAdapter(),
        {
          IDENTITY_PUBLIC_ORIGIN: issuer,
          WEBAUTHN_RP_ID: "127.0.0.1",
          WEBAUTHN_RP_NAME: "Shape of You"
        }
      );
      server = createIdentityServer({
        readiness: { check: async () => undefined },
        authentication,
        publicOrigin: issuer,
        oauthRuntime: runtime,
        oauthBrowserUi: new OAuthBrowserUi({
          authentication,
          clients,
          publicOrigin: issuer,
          resource,
          runtime
        })
      });
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject);
        server!.listen(port, "127.0.0.1", resolve);
      });

      const discovery = await fetch(`${issuer}/.well-known/oauth-authorization-server`);
      expect(discovery.status).toBe(200);
      await expect(discovery.json()).resolves.toMatchObject({
        authorization_endpoint: `${issuer}/oauth/authorize`,
        issuer,
        jwks_uri: `${issuer}/oauth/jwks`,
        scopes_supported: expect.arrayContaining([
          "openid",
          "offline_access",
          "person:read"
        ]),
        token_endpoint: `${issuer}/oauth/token`
      });
      const openIdDiscovery = await fetch(`${issuer}/.well-known/openid-configuration`);
      expect(openIdDiscovery.status).toBe(200);
      await expect(openIdDiscovery.json()).resolves.toMatchObject({
        authorization_endpoint: `${issuer}/oauth/authorize`,
        issuer,
        jwks_uri: `${issuer}/oauth/jwks`,
        scopes_supported: expect.arrayContaining([
          "openid",
          "offline_access",
          "person:read"
        ]),
        token_endpoint: `${issuer}/oauth/token`
      });
      const jwks = await fetch(`${issuer}/oauth/jwks`);
      await expect(jwks.json()).resolves.toMatchObject({
        keys: [expect.objectContaining({ alg: "ES256", kid: keyId, kty: "EC" })]
      });

      const verifier = "V".repeat(43);
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const authorizationValues = {
        client_id: "chatgpt-runtime",
        code_challenge: challenge,
        code_challenge_method: "S256",
        redirect_uri: "https://chatgpt.com/connector/oauth/runtime-callback",
        resource,
        response_type: "code",
        scope: "openid offline_access person:read",
        state: "runtime-state",
        ui_locales: "ru-RU en"
      };
      const authorizationUrl = (overrides: Record<string, string> = {}): URL => {
        const authorization = new URL(`${issuer}/oauth/authorize`);
        for (const [name, value] of Object.entries({
          ...authorizationValues,
          ...overrides
        })) authorization.searchParams.set(name, value);
        return authorization;
      };
      for (const [label, invalid] of [
        ["redirect", { redirect_uri: "https://attacker.example.test/callback" }],
        ["pkce", { code_challenge_method: "plain" }],
        ["scope", { scope: "weight:write" }],
        ["resource", { resource: "https://unsupported.example.test/mcp" }],
        ["id-token-hint", { id_token_hint: "not-a-compact-jwt" }]
      ]) {
        const rejected = await fetch(authorizationUrl(invalid as Record<string, string>), {
          redirect: "manual"
        });
        if (rejected.status === 303) {
          const errorRedirect = new URL(rejected.headers.get("location")!);
          expect(errorRedirect.origin + errorRedirect.pathname, label as string).toBe(
            "https://chatgpt.com/connector/oauth/runtime-callback"
          );
          expect(errorRedirect.searchParams.get("error"), label as string).toBeTruthy();
          expect(errorRedirect.searchParams.has("code"), label as string).toBe(false);
        } else {
          expect(rejected.status, label as string).toBe(400);
        }
      }
      await pool.query(
        `update oauth_clients set status = 'disabled', disabled_at = now()
          where id = 'chatgpt-runtime'`
      );
      const disabledClient = await fetch(authorizationUrl(), { redirect: "manual" });
      expect(disabledClient.status).toBe(400);
      await pool.query(
        `update oauth_clients set status = 'active', disabled_at = null
          where id = 'chatgpt-runtime'`
      );

      const authorization = authorizationUrl();
      const start = await fetch(authorization, { redirect: "manual" });
      const startBody = start.status === 303 ? "" : await start.text();
      expect(start.status, startBody).toBe(303);
      const location = start.headers.get("location");
      expect(location).toMatch(/^\/oauth\/interaction\/[A-Za-z0-9_-]{43}$/);
      const cookies = new Map<string, string>([
        [identitySessionCookieName, sessionCredential],
        [identityCsrfCookieName, csrfToken]
      ]);
      const applyCookies = (response: Response): void => {
        for (const value of response.headers.getSetCookie()) {
          const [pair] = value.split(";", 1);
          const separator = pair!.indexOf("=");
          cookies.set(pair!.slice(0, separator), pair!.slice(separator + 1));
        }
      };
      const cookieHeader = (): string =>
        [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
      /** Completes exactly one provider consent round and returns the client callback. */
      const completeConsent = async (initialLocation: string): Promise<URL> => {
        expect(initialLocation).toMatch(/^\/oauth\/interaction\/[A-Za-z0-9_-]{43}$/);
        const consentPage = await fetch(new URL(initialLocation, issuer), {
          headers: { cookie: cookieHeader() }
        });
        expect(consentPage.status).toBe(200);
        expect(consentPage.headers.get("content-security-policy")).toContain(
          "form-action 'self' https://chatgpt.com"
        );
        const consentPageHtml = await consentPage.text();
        expect(consentPageHtml).toContain("Authorize access");
        expect(consentPageHtml).toContain("Read your profile");
        expect(consentPageHtml).toContain("Keep this connection active");
        expect(consentPageHtml).toContain('method="post"');
        expect(consentPageHtml).toContain(`${initialLocation}/consent`);

        const consent = await fetch(new URL(`${initialLocation}/consent`, issuer), {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            cookie: cookieHeader(),
            origin: issuer
          },
          body: new URLSearchParams({ action: "allow", csrfToken }),
          redirect: "manual"
        });
        expect(consent.status).toBe(303);
        applyCookies(consent);
        const interactionCredential = initialLocation.split("/").at(-1)!;
        const storedConsent = await createOAuthProviderAdapterFactory({
          pool,
          clients,
          requestContext: new OAuthRequestContext(),
          issuer,
          resource
        })("Interaction").find(interactionCredential);
        expect(storedConsent).toMatchObject({
          result: { consent: { grantId: expect.any(String) } }
        });
        const consentResume = await fetch(
          new URL(consent.headers.get("location")!, issuer),
          {
            headers: { cookie: cookieHeader() },
            redirect: "manual"
          }
        );
        expect(consentResume.status).toBe(303);
        applyCookies(consentResume);
        const callback = new URL(consentResume.headers.get("location")!, issuer);
        expect(callback.origin + callback.pathname).toBe(
          "https://chatgpt.com/connector/oauth/runtime-callback"
        );
        return callback;
      };
      applyCookies(start);
      const page = await fetch(new URL(location!, issuer), {
        headers: { cookie: cookieHeader() }
      });
      expect(page.status).toBe(200);
      const pageHtml = await page.text();
      expect(pageHtml).toContain("Continue as Runtime account");
      expect(pageHtml).toContain("replace(/\\+/g,'-').replace(/\\//g,'_')");

      const login = await fetch(new URL(`${location}/login`, issuer), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader(),
          origin: issuer
        },
        body: JSON.stringify({ csrfToken }),
        redirect: "manual"
      });
      expect(login.status).toBe(303);
      applyCookies(login);
      const loginResume = await fetch(new URL(login.headers.get("location")!, issuer), {
        headers: { cookie: cookieHeader() },
        redirect: "manual"
      });
      const loginResumeBody = loginResume.status === 303 ? "" : await loginResume.text();
      expect(loginResume.status, loginResumeBody).toBe(303);
      applyCookies(loginResume);
      const consentLocation = loginResume.headers.get("location");
      const callback = await completeConsent(consentLocation!);
      expect(callback.searchParams.get("state")).toBe("runtime-state");
      const code = callback.searchParams.get("code");
      expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);

      const token = await fetch(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "chatgpt-runtime",
          code: code!,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: "https://chatgpt.com/connector/oauth/runtime-callback"
        })
      });
      expect(token.status).toBe(200);
      const tokenBody = await token.json() as {
        access_token: string;
        expires_in: number;
        id_token: string;
        refresh_token: string;
      };
      expect(tokenBody.expires_in).toBe(600);
      expect(tokenBody.id_token.split(".")).toHaveLength(3);
      expect(tokenBody.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const accessPayload = JSON.parse(
        Buffer.from(tokenBody.access_token.split(".")[1]!, "base64url").toString("utf8")
      ) as Record<string, unknown>;
      expect(accessPayload).toMatchObject({
        aud: resource,
        client_id: "chatgpt-runtime",
        scope: "person:read",
        sub: subject
      });
      const persistedGrantScopes = await pool.query<{
        kind: "oidc" | "resource";
        resource: string | null;
        scope: string;
      }>(
        `select 'oidc'::text as kind, null::text as resource, scope
           from oauth_grant_oidc_scopes
          where grant_id in (
            select id from oauth_grants
             where account_id = $1 and client_id = 'chatgpt-runtime'
               and revoked_at is null
          )
         union all
         select 'resource'::text as kind, resource, scope
           from oauth_grant_resource_scopes
          where grant_id in (
            select id from oauth_grants
             where account_id = $1 and client_id = 'chatgpt-runtime'
               and revoked_at is null
          )
         order by kind, scope`,
        [accountId]
      );
      expect(persistedGrantScopes.rows).toEqual([
        { kind: "oidc", resource: null, scope: "offline_access" },
        { kind: "oidc", resource: null, scope: "openid" },
        { kind: "resource", resource, scope: "person:read" }
      ]);

      const sessionsBeforeStaleCookie = await pool.query<{ count: string }>(
        "select count(*)::text as count from oauth_sessions"
      );
      await pool.query(
        "update oauth_sessions set provider_credential_hash = null where id = $1",
        [sessionId]
      );
      const staleCookieAuthorization = await fetch(
        authorizationUrl({
          code_challenge: createHash("sha256")
            .update("S".repeat(43))
            .digest("base64url"),
          id_token_hint: tokenBody.id_token,
          scope: "openid person:read",
          state: "stale-cookie-runtime-state"
        }),
        {
          headers: { cookie: cookieHeader() },
          redirect: "manual"
        }
      );
      const staleCookieAuthorizationBody = staleCookieAuthorization.status === 303
        ? ""
        : await staleCookieAuthorization.text();
      expect(staleCookieAuthorization.status, staleCookieAuthorizationBody).toBe(303);
      const staleCookieLocation = staleCookieAuthorization.headers.get("location");
      expect(staleCookieLocation).toMatch(
        /^\/oauth\/interaction\/[A-Za-z0-9_-]{43}$/
      );
      applyCookies(staleCookieAuthorization);
      const staleCookieInteraction = await createOAuthProviderAdapterFactory({
        pool,
        clients,
        requestContext: new OAuthRequestContext(),
        issuer,
        resource
      })("Interaction").find(staleCookieLocation!.split("/").at(-1)!);
      expect(staleCookieInteraction).toMatchObject({
        prompt: { name: "login" }
      });
      const staleCookieLoginPage = await fetch(new URL(staleCookieLocation!, issuer), {
        headers: { cookie: cookieHeader() }
      });
      expect(staleCookieLoginPage.status).toBe(200);
      expect(await staleCookieLoginPage.text()).toContain("Continue as Runtime account");
      const sessionsAfterStaleCookie = await pool.query<{ count: string }>(
        "select count(*)::text as count from oauth_sessions"
      );
      expect(sessionsAfterStaleCookie.rows[0]?.count).toBe(
        sessionsBeforeStaleCookie.rows[0]?.count
      );

      const repeatVerifier = "R".repeat(43);
      const repeatChallenge = createHash("sha256")
        .update(repeatVerifier)
        .digest("base64url");
      for (const name of [...cookies.keys()]) {
        if (name.startsWith("shape_of_you_oidc_session")) cookies.delete(name);
      }
      const repeatedAuthorization = await fetch(
        authorizationUrl({
          code_challenge: repeatChallenge,
          id_token_hint: tokenBody.id_token,
          state: "repeat-runtime-state"
        }),
        {
          headers: { cookie: cookieHeader() },
          redirect: "manual"
        }
      );
      const repeatedAuthorizationBody = repeatedAuthorization.status === 303
        ? ""
        : await repeatedAuthorization.text();
      expect(repeatedAuthorization.status, repeatedAuthorizationBody).toBe(303);
      applyCookies(repeatedAuthorization);
      const reconnectLocation = repeatedAuthorization.headers.get("location");
      expect(reconnectLocation).toMatch(/^\/oauth\/interaction\/[A-Za-z0-9_-]{43}$/);
      const reconnectPage = await fetch(new URL(reconnectLocation!, issuer), {
        headers: { cookie: cookieHeader() }
      });
      expect(reconnectPage.status).toBe(200);
      expect(await reconnectPage.text()).toContain("Continue as Runtime account");
      const reconnectLogin = await fetch(new URL(`${reconnectLocation}/login`, issuer), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader(),
          origin: issuer
        },
        body: JSON.stringify({ csrfToken }),
        redirect: "manual"
      });
      const reconnectLoginBody = reconnectLogin.status === 303
        ? ""
        : await reconnectLogin.text();
      expect(reconnectLogin.status, reconnectLoginBody).toBe(303);
      applyCookies(reconnectLogin);
      const reconnectResume = await fetch(
        new URL(reconnectLogin.headers.get("location")!, issuer),
        {
          headers: { cookie: cookieHeader() },
          redirect: "manual"
        }
      );
      const reconnectResumeBody = reconnectResume.status === 303
        ? ""
        : await reconnectResume.text();
      expect(reconnectResume.status, reconnectResumeBody).toBe(303);
      applyCookies(reconnectResume);
      const reconnectConsentLocation = reconnectResume.headers.get("location");
      const repeatedCallback = await completeConsent(reconnectConsentLocation!);
      expect(repeatedCallback.searchParams.get("state")).toBe("repeat-runtime-state");
      const repeatedCode = repeatedCallback.searchParams.get("code");
      expect(repeatedCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const repeatedToken = await fetch(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "chatgpt-runtime",
          code: repeatedCode!,
          code_verifier: repeatVerifier,
          grant_type: "authorization_code",
          redirect_uri: "https://chatgpt.com/connector/oauth/runtime-callback"
        })
      });
      expect(repeatedToken.status).toBe(200);
      const repeatedTokenBody = await repeatedToken.json() as {
        access_token: string;
        refresh_token: string;
      };
      const repeatedAccessPayload = JSON.parse(
        Buffer.from(
          repeatedTokenBody.access_token.split(".")[1]!,
          "base64url"
        ).toString("utf8")
      ) as Record<string, unknown>;
      expect(repeatedAccessPayload).toMatchObject({
        aud: resource,
        client_id: "chatgpt-runtime",
        scope: "person:read",
        sub: subject
      });
      expect(repeatedAccessPayload.iat).toEqual(expect.any(Number));
      expect(repeatedAccessPayload.exp).toEqual(expect.any(Number));
      expect(
        (repeatedAccessPayload.exp as number) -
        (repeatedAccessPayload.iat as number)
      ).toBe(600);

      const supersededRefresh = await fetch(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "chatgpt-runtime",
          grant_type: "refresh_token",
          refresh_token: tokenBody.refresh_token
        })
      });
      expect(supersededRefresh.status).toBe(400);
      const refreshed = await fetch(`${issuer}/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: "chatgpt-runtime",
            grant_type: "refresh_token",
            refresh_token: repeatedTokenBody.refresh_token
          })
        });
      expect(refreshed.status).toBe(200);
      const refreshedBody = await refreshed.json() as {
        access_token: string;
        refresh_token: string;
      };
      expect(refreshedBody.refresh_token).not.toBe(repeatedTokenBody.refresh_token);
      const refreshedAccessPayload = JSON.parse(
        Buffer.from(refreshedBody.access_token.split(".")[1]!, "base64url").toString("utf8")
      ) as Record<string, unknown>;
      expect(refreshedAccessPayload).toMatchObject({
        aud: resource,
        client_id: "chatgpt-runtime",
        scope: "person:read",
        sub: subject
      });
      expect(refreshedAccessPayload.iat).toEqual(expect.any(Number));
      expect(refreshedAccessPayload.exp).toEqual(expect.any(Number));
      expect(
        (refreshedAccessPayload.exp as number) -
        (refreshedAccessPayload.iat as number)
      ).toBe(600);
      const activeGrants = await pool.query<{ count: string }>(
        `select count(*)::text as count from oauth_grants
          where account_id = $1 and client_id = 'chatgpt-runtime'
            and revoked_at is null`,
        [accountId]
      );
      expect(activeGrants.rows[0]?.count).toBe("1");
      const audit = await pool.query<{ event_type: string }>(
        `select event_type from identity_security_events
          where account_id = $1 and client_id = 'chatgpt-runtime'
          order by event_type`,
        [accountId]
      );
      expect(audit.rows.map((row) => row.event_type)).toEqual([
        "oauth_authorization",
        "oauth_authorization",
        "oauth_code_exchange",
        "oauth_code_exchange",
        "oauth_refresh_rotation"
      ]);
      const grantBeforeRenewal = await pool.query<{ id: string }>(
        `update oauth_grants
            set created_at = now() - interval '2 days',
                expires_at = now() - interval '1 day'
          where account_id = $1 and client_id = 'chatgpt-runtime'
            and revoked_at is null
        returning id`,
        [accountId]
      );
      await clients.provisionPublicClient({
        clientId: "grant-race-runtime",
        displayName: "Grant race runtime",
        redirectUris: ["https://chatgpt.com/connector/oauth/grant-race-callback"],
        allowedScopes: ["openid", "offline_access", "person:read"],
        refreshTokensEnabled: true
      });
      await clients.provisionPublicClient({
        clientId: "no-offline-runtime",
        displayName: "No offline runtime",
        redirectUris: ["https://chatgpt.com/connector/oauth/no-offline-callback"],
        allowedScopes: ["openid", "person:read"],
        refreshTokensEnabled: true
      });
      await expect(runtime.grantConsentScopes({
        accountId,
        clientId: "no-offline-runtime",
        scopes: ["openid", "offline_access", "person:read"]
      })).rejects.toMatchObject({
        error: "invalid_scope",
        error_description: "OAuth consent exceeds the client scope allowlist"
      });
      await pool.query(
        `insert into oauth_clients (id, display_name, refresh_tokens_enabled)
         values ('inconsistent-offline-runtime', 'Inconsistent offline runtime', false)`
      );
      await pool.query(
        `insert into oauth_client_allowed_scopes (client_id, scope)
         values ('inconsistent-offline-runtime', 'openid'),
                ('inconsistent-offline-runtime', 'offline_access'),
                ('inconsistent-offline-runtime', 'person:read')`
      );
      await expect(runtime.grantConsentScopes({
        accountId,
        clientId: "inconsistent-offline-runtime",
        scopes: ["openid", "offline_access", "person:read"]
      })).rejects.toMatchObject({
        error: "invalid_scope",
        error_description: "OAuth client cannot receive offline access"
      });
      const constrainedPool = new Pool({
        connectionString: container.getConnectionUri(),
        connectionTimeoutMillis: 1_000,
        max: 1
      });
      try {
        const constrainedRuntime = new OAuthRuntime({
          pool: constrainedPool,
          issuer,
          resource,
          signingKeys,
          cookieKeys: [randomBytes(32).toString("base64url")]
        });
        const renewedGrantIds = await Promise.all(
          Array.from({ length: 4 }, () => constrainedRuntime.grantConsentScopes({
            accountId,
            clientId: "chatgpt-runtime",
            scopes: ["openid", "offline_access", "person:read"]
          }))
        );
        expect(new Set(renewedGrantIds)).toEqual(
          new Set([grantBeforeRenewal.rows[0]!.id])
        );
        const racedGrantIds = await Promise.all(
          Array.from({ length: 4 }, () => constrainedRuntime.grantConsentScopes({
            accountId,
            clientId: "grant-race-runtime",
            scopes: ["openid", "offline_access", "person:read"]
          }))
        );
        expect(new Set(racedGrantIds).size).toBe(1);
      } finally {
        await constrainedPool.end();
      }
      const renewedGrant = await pool.query<{ count: string }>(
        `select count(*)::text as count from oauth_grants
          where account_id = $1 and client_id = 'chatgpt-runtime'
            and revoked_at is null and expires_at > now()`,
        [accountId]
      );
      expect(renewedGrant.rows[0]?.count).toBe("1");
      const racedGrant = await pool.query<{ count: string }>(
        `select count(*)::text as count from oauth_grants
          where account_id = $1 and client_id = 'grant-race-runtime'
            and revoked_at is null and expires_at > now()`,
        [accountId]
      );
      expect(racedGrant.rows[0]?.count).toBe("1");
      await pool.query(
        "update identity_accounts set status = 'disabled', disabled_at = now() where id = $1",
        [accountId]
      );
      const suspendedAccount = await fetch(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "chatgpt-runtime",
          grant_type: "refresh_token",
          refresh_token: refreshedBody.refresh_token
        })
      });
      expect(suspendedAccount.status).toBe(400);
      await pool.query(
        "update identity_accounts set status = 'active', disabled_at = null where id = $1",
        [accountId]
      );
      await pool.query(
        "update oauth_sessions set revoked_at = now() where id = $1",
        [sessionId]
      );
      const revokedSession = await fetch(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "chatgpt-runtime",
          grant_type: "refresh_token",
          refresh_token: refreshedBody.refresh_token
        })
      });
      expect(revokedSession.status).toBe(400);
      await pool.query(
        "update oauth_sessions set revoked_at = null where id = $1",
        [sessionId]
      );
      const replayConsumedRefresh = (): Promise<Response> =>
        fetch(`${issuer}/oauth/token`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: "chatgpt-runtime",
            grant_type: "refresh_token",
            refresh_token: repeatedTokenBody.refresh_token
          })
        });
      const reusedRefreshes = await Promise.all([
        replayConsumedRefresh(),
        replayConsumedRefresh()
      ]);
      expect(reusedRefreshes.map((response) => response.status)).toEqual([400, 400]);
      const refreshTokenAdapter = createOAuthProviderAdapterFactory({
        pool,
        clients,
        requestContext: new OAuthRequestContext(),
        issuer,
        resource
      })("RefreshToken");
      await Promise.all([
        refreshTokenAdapter.destroy(repeatedTokenBody.refresh_token),
        refreshTokenAdapter.destroy(repeatedTokenBody.refresh_token)
      ]);
      const reuseAudit = await pool.query<{ count: string }>(
        `select count(*)::text as count from identity_security_events
          where account_id = $1 and client_id = 'chatgpt-runtime'
            and event_type = 'oauth_refresh_reuse_detected'`,
        [accountId]
      );
      expect(reuseAudit.rows[0]?.count).toBe("1");
      const replayedFamilyState = await pool.query<{
        all_tokens_revoked: boolean;
        family_revoked: boolean;
        grant_revoked: boolean;
        reuse_detected: boolean;
        token_count: string;
      }>(
        `select bool_and(t.revoked_at is not null) as all_tokens_revoked,
                f.revoked_at is not null as family_revoked,
                g.revoked_at is not null as grant_revoked,
                f.reuse_detected_at is not null as reuse_detected,
                count(t.id)::text as token_count
           from oauth_refresh_token_families f
           join oauth_grants g on g.id = f.grant_id
           join oauth_refresh_tokens t on t.family_id = f.id
          where f.id = (
            select family_id
              from oauth_refresh_tokens
             where token_hash = $1
          )
          group by f.id, g.id`,
        [createHash("sha256").update(repeatedTokenBody.refresh_token).digest()]
      );
      expect(replayedFamilyState.rows[0]).toMatchObject({
        all_tokens_revoked: true,
        family_revoked: true,
        grant_revoked: true,
        reuse_detected: true,
        token_count: "2"
      });
    } finally {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      await pool.query(
        `delete from identity_security_events where signing_key_id in (
           select id from oauth_signing_keys where secret_provider_handle = $1
         )`,
        [`env:${keyId}`]
      );
      await pool.query(
        "delete from oauth_signing_keys where secret_provider_handle = $1",
        [`env:${keyId}`]
      );
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
