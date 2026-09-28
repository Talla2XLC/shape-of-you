import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

/** Counts changed Identity authority rows without exposing account identifiers. */
export interface OAuthIncidentRevocationResult {
  readonly correlationId: string;
  readonly sessionsRevoked: number;
  readonly sessionAuthorizationsRevoked: number;
  readonly refreshFamiliesRevoked: number;
}

/**
 * Revokes all Identity browser/provider sessions and refresh authority in one transaction.
 *
 * Run only during an approved signing-key incident after OAuth issuance is halted.
 * Repeated calls change no previously revoked rows. JWT access tokens require
 * the separate API-local denied-kid policy because they are stateless.
 *
 * @param pool - Identity-owned PostgreSQL pool.
 * @returns Aggregate counts and a non-secret audit correlation id.
 * @throws Error when any update or audit insert fails; the transaction rolls back.
 */
export async function revokeOAuthAuthorityForIncident(
  pool: Pool
): Promise<OAuthIncidentRevocationResult> {
  const correlationId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const sessions = await client.query<{ id: string; account_id: string }>(
      `update oauth_sessions
          set revoked_at = now()
        where revoked_at is null
      returning id, account_id`
    );
    const authorizations = await client.query(
      `update oauth_session_authorizations
          set revoked_at = now()
        where revoked_at is null`
    );
    const families = await client.query(
      `update oauth_refresh_token_families
          set revoked_at = now()
        where revoked_at is null`
    );
    for (const session of sessions.rows) {
      await client.query(
        `insert into identity_security_events
           (id, event_type, outcome, actor_kind, account_id, session_id,
            correlation_id)
         values ($1, 'oauth_session_revoked', 'succeeded', 'system', $2, $3, $4)`,
        [randomUUID(), session.account_id, session.id, correlationId]
      );
    }
    await client.query("commit");
    return {
      correlationId,
      sessionsRevoked: sessions.rowCount ?? 0,
      sessionAuthorizationsRevoked: authorizations.rowCount ?? 0,
      refreshFamiliesRevoked: families.rowCount ?? 0
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
