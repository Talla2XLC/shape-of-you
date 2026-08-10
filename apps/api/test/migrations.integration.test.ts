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

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabase } from "../src/database/context.js";
import { runMigrations } from "../src/database/migrate.js";
import { personAccessGrants, users } from "../src/database/schema.js";
import {
  IdentityAccessProvisioningConflictError,
  IdentityAccessProvisioningRepository
} from "../src/storage/identity-access-provisioning-repository.js";
import { IdentitySubjectMappingRepository } from "../src/storage/identity-subject-mapping-repository.js";

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
  it("keeps every generated PostgreSQL identifier within 63 bytes", async () => {
    const overlongIdentifiers: string[] = [];

    for (const entry of journal.entries) {
      const contents = await readFile(
        new URL(`${entry.tag}.sql`, migrationsFolder),
        "utf8"
      );
      for (const match of contents.matchAll(/"((?:""|[^"])*)"/g)) {
        const identifier = match[1]!.replaceAll('""', '"');
        const byteLength = Buffer.byteLength(identifier, "utf8");
        if (byteLength > 63) {
          overlongIdentifiers.push(
            `${entry.tag}: ${byteLength} ${identifier}`
          );
        }
      }
    }

    expect(overlongIdentifiers).toEqual([]);
  });

  it("applies the full journal cleanly and idempotently", async () => {
    const url = container.getConnectionUri();

    await runMigrations(url);
    expect(await appliedMigrations(url)).toEqual(expectedMigrations);

    await runMigrations(url);
    expect(await appliedMigrations(url)).toEqual(expectedMigrations);

    const database = createDatabase(databaseConfig(url));
    const userId = "00000000-0000-4000-8000-000000000101";
    try {
      await database.db.insert(users).values({ id: userId });
      await database.db.insert(personAccessGrants).values({
        personId: syntheticPersonId,
        userId,
        role: "owner"
      });
      const mappings = new IdentitySubjectMappingRepository(database);
      await expect(
        mappings.bind("https://identity.example.test", "account-1", userId)
      ).resolves.toBe("created");
      await expect(
        mappings.bind("https://identity.example.test", "account-1", userId)
      ).resolves.toBe("existing");
      await expect(
        mappings.resolveAuthorizedPersons(
          "https://identity.example.test",
          "account-1"
        )
      ).resolves.toEqual([{ personId: syntheticPersonId, roles: ["owner"] }]);
      await database.db
        .update(personAccessGrants)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(eq(personAccessGrants.userId, userId));
      await expect(
        mappings.resolveAuthorizedPersons(
          "https://identity.example.test",
          "account-1"
        )
      ).resolves.toEqual([]);
    } finally {
      await database.pool.end();
    }
  });

  it("provisions one complete Identity access shape idempotently", async () => {
    const database = createDatabase(databaseConfig(container.getConnectionUri()));
    const repository = new IdentityAccessProvisioningRepository(database);
    const mappings = new IdentitySubjectMappingRepository(database);
    const issuer = "https://identity.provisioning.example.test";
    const subject = "provisioning-subject";
    let userId: string | undefined;
    let personId: string | undefined;
    try {
      const created = await repository.provisionOwnerAccess(issuer, subject);
      userId = created.userId;
      personId = created.personId;
      expect(created.status).toBe("created");
      await expect(repository.provisionOwnerAccess(issuer, subject)).resolves.toEqual({
        personId,
        status: "existing",
        userId
      });
      await expect(
        mappings.resolveAuthorizedPersons(issuer, subject)
      ).resolves.toEqual([{ personId, roles: ["owner"] }]);

      const rows = await database.pool.query<{
        grant_count: string;
        mapping_count: string;
        person_count: string;
        user_count: string;
      }>(
        `select
           (select count(*)::text from users where id = $1) as user_count,
           (select count(*)::text from persons where id = $2 and kind = 'real') as person_count,
           (select count(*)::text from person_access_grants where user_id = $1 and status = 'active') as grant_count,
           (select count(*)::text from identity_subject_mappings where issuer = $3 and subject = $4) as mapping_count`,
        [userId, personId, issuer, subject]
      );
      expect(rows.rows[0]).toEqual({
        grant_count: "1",
        mapping_count: "1",
        person_count: "1",
        user_count: "1"
      });
    } finally {
      if (userId && personId) {
        await database.pool.query(
          "delete from identity_subject_mappings where issuer = $1 and subject = $2",
          [issuer, subject]
        );
        await database.pool.query("delete from person_access_grants where user_id = $1", [
          userId
        ]);
        await database.pool.query("delete from persons where id = $1", [personId]);
        await database.pool.query("delete from users where id = $1", [userId]);
      }
      await database.pool.end();
    }
  });

  it("rejects partial and ambiguous Identity access without repairing it", async () => {
    const database = createDatabase(databaseConfig(container.getConnectionUri()));
    const repository = new IdentityAccessProvisioningRepository(database);
    const mappings = new IdentitySubjectMappingRepository(database);
    const issuer = "https://identity.conflict.example.test";
    const subject = "partial-subject";
    const userId = "00000000-0000-4000-8000-000000000301";
    try {
      await database.db.insert(users).values({ id: userId });
      await mappings.bind(issuer, subject, userId);

      await expect(repository.provisionOwnerAccess(issuer, subject)).rejects.toBeInstanceOf(
        IdentityAccessProvisioningConflictError
      );
      const state = await database.pool.query<{
        grant_count: string;
        mapping_count: string;
        person_count: string;
      }>(
        `select
           (select count(*)::text from person_access_grants where user_id = $1) as grant_count,
           (select count(*)::text from identity_subject_mappings where issuer = $2 and subject = $3) as mapping_count,
           (select count(*)::text from persons p join person_access_grants g on g.person_id = p.id where g.user_id = $1) as person_count`,
        [userId, issuer, subject]
      );
      expect(state.rows[0]).toEqual({
        grant_count: "0",
        mapping_count: "1",
        person_count: "0"
      });
    } finally {
      await database.pool.query(
        "delete from identity_subject_mappings where issuer = $1 and subject = $2",
        [issuer, subject]
      );
      await database.pool.query("delete from users where id = $1", [userId]);
      await database.pool.end();
    }
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
