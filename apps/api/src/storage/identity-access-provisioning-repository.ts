import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";

import type { DatabaseContext } from "../database/context.js";

/** Result of provisioning one externally authenticated API principal. */
export interface IdentityAccessProvisioningResult {
  readonly personId: string;
  readonly status: "created" | "existing" | "linked";
  readonly userId: string;
}

/** Credential-free inspection state for one external Identity subject. */
export interface IdentityAccessInspectionResult {
  readonly status: "active" | "conflict" | "revoked" | "unbound";
}

/** Result of changing one provisioned Identity subject's Person access. */
export interface IdentityAccessLifecycleResult {
  readonly grantId: string;
  readonly personId: string;
  readonly status: "existing" | "restored" | "revoked";
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

interface GrantLifecycleRow extends ActiveGrantRow {
  readonly grant_id: string;
  readonly grant_status: "active" | "revoked";
}

interface IdentityAccessLifecycleState {
  readonly activeGrant: GrantLifecycleRow | undefined;
  readonly latestGrant: GrantLifecycleRow;
  readonly personId: string;
  readonly userId: string;
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

  /**
   * Ensures an operator-selected subject owns the sole real Person.
   *
   * Empty API state creates the first real Person. An existing sole active
   * real Person is reused through a new API User and owner grant so its facts
   * are not duplicated. Existing revoked, disabled, partial, archived, or
   * ambiguous state is never repaired implicitly.
   *
   * @param issuer Exact external Identity origin that issued the subject.
   * @param subject Opaque public subject owned by the Identity service.
   * @returns API-owned ids and whether access was created, linked, or existing.
   * @throws {IdentityAccessProvisioningConflictError} When state cannot be
   * safely resolved without an explicit lifecycle decision.
   */
  public async ensureSolePersonOwnerAccess(
    issuer: string,
    subject: string
  ): Promise<IdentityAccessProvisioningResult> {
    validateIdentityReference(issuer, subject);
    const client = await this.database.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        ["identity-access:ensure-sole-person"]
      );
      const existing = await loadExistingAccess(client, issuer, subject);
      if (existing) {
        await client.query("commit");
        return existing;
      }

      const realPersons = await client.query<{
        readonly id: string;
        readonly status: "active" | "archived";
      }>(
        `select id, status
           from persons
          where kind = 'real'
          order by id`
      );
      if (
        realPersons.rows.length > 1 ||
        realPersons.rows[0]?.status === "archived"
      ) {
        throw new IdentityAccessProvisioningConflictError(
          "Identity access cannot select one active real Person"
        );
      }

      const userId = randomUUID();
      const personId = realPersons.rows[0]?.id ?? randomUUID();
      await client.query("insert into users (id, status) values ($1, 'active')", [
        userId
      ]);
      if (realPersons.rows.length === 0) {
        await client.query(
          "insert into persons (id, kind, status) values ($1, 'real', 'active')",
          [personId]
        );
      }
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
      return {
        personId,
        status: realPersons.rows.length === 0 ? "created" : "linked",
        userId
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Inspects access without changing authorization state.
   *
   * @param issuer Exact external Identity origin that issued the subject.
   * @param subject Opaque public subject owned by the Identity service.
   * @returns A bounded state without API or Identity identifiers.
   */
  public async inspectOwnerAccess(
    issuer: string,
    subject: string
  ): Promise<IdentityAccessInspectionResult> {
    validateIdentityReference(issuer, subject);
    const binding = await this.database.pool.query<ExistingBindingRow>(
      `select m.user_id, u.status as user_status
         from identity_subject_mappings m
         join users u on u.id = m.user_id
        where m.issuer = $1 and m.subject = $2`,
      [issuer, subject]
    );
    const existing = binding.rows[0];
    if (!existing) return { status: "unbound" };
    if (binding.rows.length !== 1 || existing.user_status !== "active") {
      return { status: "conflict" };
    }

    const grants = await this.database.pool.query<GrantLifecycleRow>(
      `select g.id as grant_id,
              g.person_id,
              g.role,
              g.status as grant_status,
              p.kind as person_kind,
              p.status as person_status
         from person_access_grants g
         join persons p on p.id = g.person_id
        where g.user_id = $1
        order by g.granted_at desc, g.id desc`,
      [existing.user_id]
    );
    const latest = grants.rows[0];
    if (!latest) return { status: "conflict" };
    const active = grants.rows.filter((grant) => grant.grant_status === "active");
    const invalid = grants.rows.some(
      (grant) =>
        grant.person_id !== latest.person_id ||
        grant.role !== "owner" ||
        grant.person_kind !== "real" ||
        grant.person_status !== "active"
    );
    if (invalid || active.length > 1) return { status: "conflict" };
    return { status: active.length === 1 ? "active" : "revoked" };
  }

  /**
   * Revokes the sole active real Person owner grant for an Identity subject.
   *
   * Calls are serialized with provisioning and restoration. A safe repeat
   * returns the latest revoked grant without changing lifecycle history.
   *
   * @param issuer Exact external Identity origin that issued the subject.
   * @param subject Opaque public subject owned by the Identity service.
   * @returns API-owned ids and whether the active grant was revoked.
   * @throws {IdentityAccessProvisioningConflictError} When the binding or
   * grant history is missing, partial, disabled, synthetic, or ambiguous.
   */
  public async revokeOwnerAccess(
    issuer: string,
    subject: string
  ): Promise<IdentityAccessLifecycleResult> {
    validateIdentityReference(issuer, subject);
    const client = await this.database.pool.connect();
    try {
      await client.query("begin");
      await lockIdentityAccess(client, issuer, subject);
      const state = await loadLifecycleState(client, issuer, subject);
      if (!state.activeGrant) {
        await client.query("commit");
        return lifecycleResult(state, state.latestGrant.grant_id, "existing");
      }

      const revoked = await client.query<{ id: string }>(
        `update person_access_grants
            set status = 'revoked', revoked_at = now()
          where id = $1 and status = 'active'
        returning id`,
        [state.activeGrant.grant_id]
      );
      if (revoked.rowCount !== 1 || !revoked.rows[0]) {
        throw new IdentityAccessProvisioningConflictError(
          "Identity access active grant changed concurrently"
        );
      }
      await client.query("commit");
      return lifecycleResult(state, revoked.rows[0].id, "revoked");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Restores a revoked Identity subject by creating a new active owner grant.
   *
   * Revoked rows remain immutable lifecycle history. A safe repeat returns
   * the current active grant instead of creating another grant.
   *
   * @param issuer Exact external Identity origin that issued the subject.
   * @param subject Opaque public subject owned by the Identity service.
   * @returns API-owned ids and whether a new active grant was created.
   * @throws {IdentityAccessProvisioningConflictError} When the binding or
   * grant history is missing, partial, disabled, synthetic, or ambiguous.
   */
  public async restoreOwnerAccess(
    issuer: string,
    subject: string
  ): Promise<IdentityAccessLifecycleResult> {
    validateIdentityReference(issuer, subject);
    const client = await this.database.pool.connect();
    try {
      await client.query("begin");
      await lockIdentityAccess(client, issuer, subject);
      const state = await loadLifecycleState(client, issuer, subject);
      if (state.activeGrant) {
        await client.query("commit");
        return lifecycleResult(state, state.activeGrant.grant_id, "existing");
      }

      const grantId = randomUUID();
      await client.query(
        `insert into person_access_grants
           (id, person_id, user_id, role, status)
         values ($1, $2, $3, 'owner', 'active')`,
        [grantId, state.personId, state.userId]
      );
      await client.query("commit");
      return lifecycleResult(state, grantId, "restored");
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

/** Serializes all lifecycle changes for one exact external identity. */
async function lockIdentityAccess(
  client: PoolClient,
  issuer: string,
  subject: string
): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    JSON.stringify([issuer, subject])
  ]);
}

/** Resolves a complete, unambiguous owner-grant lifecycle for mutation. */
async function loadLifecycleState(
  client: PoolClient,
  issuer: string,
  subject: string
): Promise<IdentityAccessLifecycleState> {
  const binding = await client.query<ExistingBindingRow>(
    `select m.user_id, u.status as user_status
       from identity_subject_mappings m
       join users u on u.id = m.user_id
      where m.issuer = $1 and m.subject = $2`,
    [issuer, subject]
  );
  const existing = binding.rows[0];
  if (binding.rows.length !== 1 || !existing) {
    throw new IdentityAccessProvisioningConflictError(
      "Identity access binding does not exist"
    );
  }
  if (existing.user_status !== "active") {
    throw new IdentityAccessProvisioningConflictError(
      "Identity access is bound to a disabled API User"
    );
  }

  const grants = await client.query<GrantLifecycleRow>(
    `select g.id as grant_id,
            g.person_id,
            g.role,
            g.status as grant_status,
            p.kind as person_kind,
            p.status as person_status
       from person_access_grants g
       join persons p on p.id = g.person_id
      where g.user_id = $1
      order by g.granted_at desc, g.id desc`,
    [existing.user_id]
  );
  const latestGrant = grants.rows[0];
  if (!latestGrant) {
    throw new IdentityAccessProvisioningConflictError(
      "Identity access grant history does not exist"
    );
  }
  const activeGrants = grants.rows.filter(
    (grant) => grant.grant_status === "active"
  );
  const invalidHistory = grants.rows.some(
    (grant) =>
      grant.person_id !== latestGrant.person_id ||
      grant.role !== "owner" ||
      grant.person_kind !== "real" ||
      grant.person_status !== "active"
  );
  if (invalidHistory || activeGrants.length > 1) {
    throw new IdentityAccessProvisioningConflictError(
      "Identity access does not have one unambiguous real Person owner lifecycle"
    );
  }
  return {
    activeGrant: activeGrants[0],
    latestGrant,
    personId: latestGrant.person_id,
    userId: existing.user_id
  };
}

/** Builds credential-free output state from a validated lifecycle. */
function lifecycleResult(
  state: IdentityAccessLifecycleState,
  grantId: string,
  status: IdentityAccessLifecycleResult["status"]
): IdentityAccessLifecycleResult {
  return {
    grantId,
    personId: state.personId,
    status,
    userId: state.userId
  };
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
