import { randomBytes, randomUUID } from "node:crypto";

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON
} from "@simplewebauthn/server";
import type { Pool, PoolClient } from "pg";

import type { IdentityConfig } from "../config.js";
import {
  bearerValueMatches,
  createOpaqueToken,
  hashBearerValue
} from "./crypto.js";
import type {
  DatabaseWebAuthnTransport,
  StoredPasskey,
  WebAuthnAdapter
} from "./webauthn-adapter.js";

export const identitySessionCookieName = "__Host-shape_of_you_identity";
const challengeLifetimeMs = 5 * 60 * 1_000;
const enrollmentLifetimeMs = 15 * 60 * 1_000;
const sessionIdleLifetimeMs = 30 * 24 * 60 * 60 * 1_000;

/** Stable application error translated to a safe HTTP response. */
export class IdentityAuthenticationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

interface AccountRow {
  readonly id: string;
  readonly subject: string;
  readonly webauthn_user_handle: Buffer;
  readonly display_name: string;
}

interface ChallengeRow {
  readonly id: string;
  readonly account_id: string | null;
  readonly initial_passkey_enrollment_id: string | null;
  readonly challenge_hash: Buffer;
  readonly expected_rp_id: string;
  readonly expected_origin: string;
}

interface CredentialRow extends AccountRow {
  readonly credential_row_id: string;
  readonly credential_id: Buffer;
  readonly public_key: Buffer;
  readonly counter: string;
  readonly device_type: "single_device" | "multi_device";
  readonly backed_up: boolean;
  readonly transports: DatabaseWebAuthnTransport[];
}

interface RegistrationAuthority {
  readonly account: AccountRow;
  readonly enrollmentId: string | null;
  readonly sessionId: string | null;
}

/** Result printed once by the operator bootstrap command. */
export interface AccountBootstrapResult {
  readonly accountId: string;
  readonly subject: string;
  readonly enrollmentToken: string;
  readonly expiresAt: Date;
}

/** Request authority supplied to registration endpoints. */
export interface RegistrationRequestAuthority {
  readonly authorization?: string | undefined;
  readonly cookie?: string | undefined;
  readonly csrfToken?: string | undefined;
}

/** Implements the approved passkey enrollment, login, and browser-session flow. */
export class IdentityAuthenticationService {
  constructor(
    private readonly pool: Pool,
    private readonly adapter: WebAuthnAdapter,
    private readonly config: Pick<
      IdentityConfig,
      "IDENTITY_PUBLIC_ORIGIN" | "WEBAUTHN_RP_ID" | "WEBAUTHN_RP_NAME"
    >
  ) {}

  /** Creates an account and its first short-lived enrollment token atomically. */
  async bootstrapAccount(displayName: string): Promise<AccountBootstrapResult> {
    const normalizedName = displayName.trim();
    if (!normalizedName || normalizedName.length > 200) {
      throw new IdentityAuthenticationError(
        400,
        "invalid_display_name",
        "Display name must contain between 1 and 200 characters"
      );
    }
    const accountId = randomUUID();
    const subject = randomUUID();
    const enrollmentId = randomUUID();
    const enrollmentToken = createOpaqueToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + enrollmentLifetimeMs);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into identity_accounts
           (id, subject, webauthn_user_handle, display_name, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $5)`,
        [accountId, subject, randomBytes(32), normalizedName, now]
      );
      await client.query(
        `insert into initial_passkey_enrollments
           (id, account_id, token_hash, created_at, expires_at)
         values ($1, $2, $3, $4, $5)`,
        [enrollmentId, accountId, hashBearerValue(enrollmentToken), now, expiresAt]
      );
      await this.insertSecurityEvent(client, {
        eventType: "initial_passkey_enrollment_created",
        actorKind: "system",
        accountId,
        correlationId: enrollmentId
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return { accountId, subject, enrollmentToken, expiresAt };
  }

  /** Starts registration for the bootstrap token or an authenticated session. */
  async createRegistrationOptions(
    authority: RegistrationRequestAuthority
  ): Promise<Readonly<Record<string, unknown>>> {
    const resolved = await this.resolveRegistrationAuthority(authority);
    const credentials = await this.pool.query<{ credential_id: Buffer }>(
      `select credential_id
         from webauthn_credentials
        where account_id = $1 and revoked_at is null`,
      [resolved.account.id]
    );
    const options = await this.adapter.createRegistrationOptions({
      rpId: this.config.WEBAUTHN_RP_ID,
      rpName: this.config.WEBAUTHN_RP_NAME,
      userHandle: resolved.account.webauthn_user_handle,
      userName: resolved.account.subject,
      displayName: resolved.account.display_name,
      excludedCredentialIds: credentials.rows.map((row) => row.credential_id)
    });
    const challengeId = randomUUID();
    const now = new Date();
    await this.pool.query(
      `insert into webauthn_challenges
         (id, account_id, initial_passkey_enrollment_id, purpose,
          challenge_hash, expected_rp_id,
          expected_origin, user_verification, created_at, expires_at)
       values ($1, $2, $3, 'registration', $4, $5, $6, 'required', $7, $8)`,
      [
        challengeId,
        resolved.account.id,
        resolved.enrollmentId,
        hashBearerValue(options.challenge),
        this.config.WEBAUTHN_RP_ID,
        this.config.IDENTITY_PUBLIC_ORIGIN,
        now,
        new Date(now.getTime() + challengeLifetimeMs)
      ]
    );
    return { challengeId, options };
  }

  /** Verifies and persists a newly enrolled passkey exactly once. */
  async verifyRegistration(input: {
    readonly authority: RegistrationRequestAuthority;
    readonly challengeId: string;
    readonly label?: string | undefined;
    readonly response: RegistrationResponseJSON;
  }): Promise<Readonly<Record<string, unknown>>> {
    const authority = await this.resolveRegistrationAuthority(input.authority);
    const label = input.label?.trim() || null;
    if (label !== null && label.length > 200) {
      throw new IdentityAuthenticationError(400, "invalid_label", "Passkey label is too long");
    }
    const challenge = await this.getChallenge(input.challengeId, "registration");
    if (
      challenge.account_id !== authority.account.id ||
      challenge.initial_passkey_enrollment_id !== authority.enrollmentId
    ) {
      throw this.denied();
    }
    let verified;
    try {
      verified = await this.adapter.verifyRegistration({
        response: input.response,
        expectedChallenge: (value) => bearerValueMatches(value, challenge.challenge_hash),
        expectedOrigin: challenge.expected_origin,
        expectedRpId: challenge.expected_rp_id
      });
    } catch {
      throw new IdentityAuthenticationError(400, "invalid_webauthn_response", "Passkey verification failed");
    }
    const credentialRowId = randomUUID();
    const now = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.requireActiveAccount(client, authority.account.id);
      await this.consumeChallenge(client, challenge.id, now);
      if (authority.enrollmentId !== null) {
        const consumed = await client.query(
          `update initial_passkey_enrollments
              set consumed_at = $2
            where id = $1 and consumed_at is null and invalidated_at is null
              and expires_at >= $2
          returning id`,
          [authority.enrollmentId, now]
        );
        if (consumed.rowCount !== 1) throw this.denied();
      }
      await client.query(
        `insert into webauthn_credentials
           (id, account_id, credential_id, public_key, counter, device_type,
            backed_up, transports, label, created_at)
         values ($1, $2, $3, $4, $5, $6, $7,
                 $8::webauthn_transport[], $9, $10)`,
        [
          credentialRowId,
          authority.account.id,
          verified.credentialId,
          verified.publicKey,
          verified.counter,
          verified.deviceType,
          verified.backedUp,
          verified.transports,
          label,
          now
        ]
      );
      await this.insertSecurityEvent(client, {
        eventType: "passkey_registered",
        actorKind: authority.sessionId === null ? "anonymous" : "account",
        actorAccountId: authority.sessionId === null ? null : authority.account.id,
        accountId: authority.account.id,
        sessionId: authority.sessionId,
        correlationId: challenge.id
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return { accountId: authority.account.id, credentialId: credentialRowId };
  }

  /** Starts discoverable-credential authentication. */
  async createAuthenticationOptions(): Promise<Readonly<Record<string, unknown>>> {
    const options = await this.adapter.createAuthenticationOptions({
      rpId: this.config.WEBAUTHN_RP_ID
    });
    const challengeId = randomUUID();
    const now = new Date();
    await this.pool.query(
      `insert into webauthn_challenges
         (id, purpose, challenge_hash, expected_rp_id, expected_origin,
          user_verification, created_at, expires_at)
       values ($1, 'authentication', $2, $3, $4, 'required', $5, $6)`,
      [
        challengeId,
        hashBearerValue(options.challenge),
        this.config.WEBAUTHN_RP_ID,
        this.config.IDENTITY_PUBLIC_ORIGIN,
        now,
        new Date(now.getTime() + challengeLifetimeMs)
      ]
    );
    return { challengeId, options };
  }

  /** Verifies a passkey assertion and creates a sliding browser session. */
  async verifyAuthentication(input: {
    readonly challengeId: string;
    readonly response: AuthenticationResponseJSON;
  }): Promise<{
    readonly body: Readonly<Record<string, unknown>>;
    readonly cookie: string;
  }> {
    const challenge = await this.getChallenge(input.challengeId, "authentication");
    const credentialId = this.decodeCredentialId(input.response.id);
    const credentialResult = await this.pool.query<CredentialRow>(
      `select c.id as credential_row_id, c.credential_id, c.public_key,
              c.counter::text, c.device_type, c.backed_up, c.transports,
              a.id, a.subject, a.webauthn_user_handle, a.display_name
         from webauthn_credentials c
         join identity_accounts a on a.id = c.account_id
        where c.credential_id = $1 and c.revoked_at is null
          and a.status = 'active'`,
      [credentialId]
    );
    const row = credentialResult.rows[0];
    if (!row) throw this.denied();
    const stored: StoredPasskey = {
      credentialId: row.credential_id,
      publicKey: row.public_key,
      counter: Number(row.counter),
      deviceType: row.device_type,
      backedUp: row.backed_up,
      transports: row.transports
    };
    let verified;
    try {
      verified = await this.adapter.verifyAuthentication({
        response: input.response,
        expectedChallenge: (value) => bearerValueMatches(value, challenge.challenge_hash),
        expectedOrigin: challenge.expected_origin,
        expectedRpId: challenge.expected_rp_id,
        credential: stored
      });
    } catch {
      throw new IdentityAuthenticationError(400, "invalid_webauthn_response", "Passkey verification failed");
    }
    const sessionCredential = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const sessionId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionIdleLifetimeMs);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const activeCredential = await client.query(
        `select c.id
           from webauthn_credentials c
           join identity_accounts a on a.id = c.account_id
          where c.id = $1 and c.account_id = $2 and c.revoked_at is null
            and a.status = 'active'
          for update of c, a`,
        [row.credential_row_id, row.id]
      );
      if (activeCredential.rowCount !== 1) throw this.denied();
      await this.consumeChallenge(client, challenge.id, now);
      await client.query(
        `update webauthn_credentials
            set counter = $2, backed_up = $3, last_used_at = $4
          where id = $1 and revoked_at is null`,
        [row.credential_row_id, verified.counter, verified.backedUp, now]
      );
      await client.query(
        `insert into oauth_sessions
           (id, account_id, webauthn_credential_id, credential_hash,
            csrf_token_hash, provider_uid, authenticated_at, acr, amr,
            created_at, last_activity_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'urn:soy:passkey',
                 ARRAY['passkey'], $7, $7, $8)`,
        [
          sessionId,
          row.id,
          row.credential_row_id,
          hashBearerValue(sessionCredential),
          hashBearerValue(csrfToken),
          randomUUID(),
          now,
          expiresAt
        ]
      );
      await this.insertSecurityEvent(client, {
        eventType: "passkey_authentication",
        actorKind: "account",
        actorAccountId: row.id,
        accountId: row.id,
        sessionId,
        correlationId: challenge.id
      });
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    return {
      body: {
        account: { id: row.id, subject: row.subject, displayName: row.display_name },
        csrfToken,
        expiresAt: expiresAt.toISOString()
      },
      cookie: `${identitySessionCookieName}=${sessionCredential}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`
    };
  }

  private async resolveRegistrationAuthority(
    input: RegistrationRequestAuthority
  ): Promise<RegistrationAuthority> {
    const bearer = input.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (bearer) {
      const result = await this.pool.query<AccountRow & { enrollment_id: string }>(
        `select a.id, a.subject, a.webauthn_user_handle, a.display_name,
                e.id as enrollment_id
           from initial_passkey_enrollments e
           join identity_accounts a on a.id = e.account_id
          where e.token_hash = $1 and e.consumed_at is null
            and e.invalidated_at is null and e.expires_at >= now()
            and a.status = 'active'`,
        [hashBearerValue(bearer)]
      );
      const row = result.rows[0];
      if (!row) throw this.denied();
      return { account: row, enrollmentId: row.enrollment_id, sessionId: null };
    }
    const sessionToken = this.readCookie(input.cookie, identitySessionCookieName);
    if (!sessionToken || !input.csrfToken) throw this.denied();
    const result = await this.pool.query<
      AccountRow & { csrf_token_hash: Buffer; session_id: string }
    >(
      `select a.id, a.subject, a.webauthn_user_handle, a.display_name,
              s.id as session_id, s.csrf_token_hash
         from oauth_sessions s
         join identity_accounts a on a.id = s.account_id
        where s.credential_hash = $1 and s.revoked_at is null
          and s.expires_at >= now() and a.status = 'active'`,
      [hashBearerValue(sessionToken)]
    );
    const row = result.rows[0];
    if (!row || !bearerValueMatches(input.csrfToken, row.csrf_token_hash)) {
      throw this.denied();
    }
    const now = new Date();
    const touched = await this.pool.query(
      `update oauth_sessions
          set last_activity_at = $2, expires_at = $3
        where id = $1 and revoked_at is null and expires_at >= $2
          and exists (
            select 1 from identity_accounts a
             where a.id = oauth_sessions.account_id and a.status = 'active'
          )`,
      [row.session_id, now, new Date(now.getTime() + sessionIdleLifetimeMs)]
    );
    if (touched.rowCount !== 1) throw this.denied();
    return { account: row, enrollmentId: null, sessionId: row.session_id };
  }

  private async requireActiveAccount(client: PoolClient, accountId: string): Promise<void> {
    const result = await client.query(
      `select id from identity_accounts
        where id = $1 and status = 'active'
        for update`,
      [accountId]
    );
    if (result.rowCount !== 1) throw this.denied();
  }

  private async getChallenge(
    challengeId: string,
    purpose: "registration" | "authentication"
  ): Promise<ChallengeRow> {
    const result = await this.pool.query<ChallengeRow>(
      `select id, account_id, initial_passkey_enrollment_id, challenge_hash,
              expected_rp_id, expected_origin
         from webauthn_challenges
        where id = $1 and purpose = $2 and consumed_at is null
          and expires_at >= now()`,
      [challengeId, purpose]
    );
    const row = result.rows[0];
    if (!row) {
      throw new IdentityAuthenticationError(400, "invalid_challenge", "Challenge is invalid or expired");
    }
    return row;
  }

  private async consumeChallenge(client: PoolClient, id: string, now: Date): Promise<void> {
    const result = await client.query(
      `update webauthn_challenges set consumed_at = $2
        where id = $1 and consumed_at is null and expires_at >= $2
      returning id`,
      [id, now]
    );
    if (result.rowCount !== 1) {
      throw new IdentityAuthenticationError(400, "invalid_challenge", "Challenge is invalid or expired");
    }
  }

  private decodeCredentialId(value: string): Buffer {
    try {
      const decoded = Buffer.from(value, "base64url");
      if (!decoded.length || decoded.toString("base64url") !== value) throw new Error();
      return decoded;
    } catch {
      throw new IdentityAuthenticationError(400, "invalid_webauthn_response", "Credential id is invalid");
    }
  }

  private readCookie(header: string | undefined, name: string): string | null {
    for (const part of header?.split(";") ?? []) {
      const [key, ...rest] = part.trim().split("=");
      if (key === name) return rest.join("=");
    }
    return null;
  }

  private denied(): IdentityAuthenticationError {
    return new IdentityAuthenticationError(401, "authentication_required", "Authentication required");
  }

  private async insertSecurityEvent(
    client: PoolClient,
    input: {
      readonly eventType: "initial_passkey_enrollment_created" | "passkey_registered" | "passkey_authentication";
      readonly actorKind: "anonymous" | "account" | "system";
      readonly actorAccountId?: string | null;
      readonly accountId: string;
      readonly sessionId?: string | null;
      readonly correlationId: string;
    }
  ): Promise<void> {
    await client.query(
      `insert into identity_security_events
         (id, event_type, outcome, actor_kind, actor_account_id, account_id,
          session_id, correlation_id)
       values ($1, $2, 'succeeded', $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        input.eventType,
        input.actorKind,
        input.actorAccountId ?? null,
        input.accountId,
        input.sessionId ?? null,
        input.correlationId
      ]
    );
  }
}
