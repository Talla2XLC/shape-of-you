import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import type { DatabaseContext } from "../database/context.js";

/** Result of provisioning one externally authenticated API principal. */
export interface IdentityAccessProvisioningResult {
  readonly personId: string;
  readonly status: "created" | "existing";
  readonly userId: string;
}

/** Fail-closed error for partial or ambiguous authorization state. */
export class IdentityAccessProvisioningConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "IdentityAccessProvisioningConflictError";
  }
}

interface ExistingBindingRow {
  readonly user_id: string;
  readonly user_status: "active" | "disabled";
}

interface ActiveGrantRow {
  readonly person_id: string;
  readonly person_kind: "real" | "synthetic";
  readonly person_status: "active" | "archived";
  readonly role: "owner" | "editor" | "viewer" | "coach";
}

/**
 * Owns idempotent staging provisioning of an API User and Person grant.
 *
 * The repository uses only the API database. Existing partial, disabled, or
 * ambiguous state is never repaired implicitly.
 */
export class IdentityAccessProvisioningRepository {
  public constructor(private readonly database: DatabaseContext) {}

  /**
   * Creates one User, real Person, owner grant, and exact Identity binding.
   *
   * Calls for the same issuer and subject are serialized and return the
   * existing ids only when the complete authorization shape is still valid.
   *
   * @param issuer Exact external Identity origin that issued the subject.
   * @param subject Opaque public subject owned by the Identity service.
   * @returns The API-owned User and Person ids and whether rows were created.
   * @throws {IdentityAccessProvisioningConflictError} When existing state is
   * partial, disabled, synthetic, or ambiguous.
   */
  public async provisionOwnerAccess(
    issuer: string,
    subject: string
  ): Promise<IdentityAccessProvisioningResult> {
    validateIdentityReference(issuer, subject);
    const client = await this.database.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [JSON.stringify([issuer, subject])]
      );
      const existing = await loadExistingAccess(client, issuer, subject);
      if (existing) {
        await client.query("commit");
        return existing;
      }

      const userId = randomUUID();
      const personId = randomUUID();
      await client.query("insert into users (id, status) values ($1, 'active')", [
        userId
      ]);
      await client.query(
        "insert into persons (id, kind, status) values ($1, 'real', 'active')",
        [personId]
      );
      await client.query(
        `insert into person_access_grants (id, person_id, user_id, role, status)
         values ($1, $2, $3, 'owner', 'active')`,
        [randomUUID(), personId, userId]
      );
      await client.query(
        `insert into identity_subject_mappings (id, issuer, subject, user_id)
         values ($1, $2, $3, $4)`,
        [randomUUID(), issuer, subject, userId]
      );
      await client.query("commit");
      return { personId, status: "created", userId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Validates the exact external Identity reference stored by the API. */
function validateIdentityReference(issuer: string, subject: string): void {
  const issuerUrl = new URL(issuer);
  if (issuerUrl.origin !== issuer || issuer.length > 512) {
    throw new Error("Identity issuer must be an exact origin");
  }
  if (!subject.trim() || subject.length > 512) {
    throw new Error("Identity subject is invalid");
  }
}

/** Resolves and validates a previously provisioned authorization shape. */
async function loadExistingAccess(
  client: PoolClient,
  issuer: string,
  subject: string
): Promise<IdentityAccessProvisioningResult | undefined> {
  const binding = await client.query<ExistingBindingRow>(
    `select m.user_id, u.status as user_status
       from identity_subject_mappings m
       join users u on u.id = m.user_id
      where m.issuer = $1 and m.subject = $2
      limit 1`,
    [issuer, subject]
  );
  const existing = binding.rows[0];
  if (!existing) {
    return undefined;
  }
  if (existing.user_status !== "active") {
    throw new IdentityAccessProvisioningConflictError(
      "Identity access is bound to a disabled API User"
    );
  }

  const grants = await client.query<ActiveGrantRow>(
    `select g.person_id,
            g.role,
            p.kind as person_kind,
            p.status as person_status
       from person_access_grants g
       join persons p on p.id = g.person_id
      where g.user_id = $1 and g.status = 'active'
      order by g.person_id, g.role`,
    [existing.user_id]
  );
  const grant = grants.rows[0];
  if (
    grants.rows.length !== 1 ||
    !grant ||
    grant.role !== "owner" ||
    grant.person_kind !== "real" ||
    grant.person_status !== "active"
  ) {
    throw new IdentityAccessProvisioningConflictError(
      "Identity access does not have one active real Person owner grant"
    );
  }
  return {
    personId: grant.person_id,
    status: "existing",
    userId: existing.user_id
  };
}
