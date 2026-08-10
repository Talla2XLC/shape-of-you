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
import {
  decryptTotpSecret,
  encodeBase32,
  encryptTotpSecret,
  verifyTotpCode,
  type TotpKeyRing
} from "./totp.js";

export const identitySessionCookieName = "__Host-shape_of_you_identity";
export const identityCsrfCookieName = "__Host-shape_of_you_csrf";
const challengeLifetimeMs = 5 * 60 * 1_000;
const enrollmentLifetimeMs = 15 * 60 * 1_000;
const sessionIdleLifetimeMs = 30 * 24 * 60 * 60 * 1_000;
const totpRecoveryLifetimeMs = 15 * 60 * 1_000;

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
  readonly recoverySessionId: string | null;
}

interface SessionAuthority {
  readonly account: AccountRow;
  readonly sessionId: string;
  readonly credentialId: string | null;
  readonly providerUid: string;
  readonly authenticatedAt: Date;
  readonly acr: string;
  readonly amr: string[];
}

/** Authenticated browser-session identity exposed to the OAuth interaction flow. */
export interface OAuthBrowserSession {
  readonly accountId: string;
  readonly subject: string;
  readonly displayName: string;
  readonly sessionId: string;
  readonly providerUid: string;
  readonly authenticatedAt: Date;
  readonly acr: string;
  readonly amr: readonly string[];
}

interface TotpRow {
  readonly id: string;
  readonly account_id: string;
  readonly secret_ciphertext: Buffer;
  readonly secret_nonce: Buffer;
  readonly secret_tag: Buffer;
  readonly key_id: string;
  readonly last_accepted_step: string | null;
  readonly failed_attempts: number;
  readonly attempt_window_started_at: Date | null;
  readonly locked_until: Date | null;
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
    >,
    private readonly totpKeyRing?: TotpKeyRing
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
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into webauthn_challenges
           (id, account_id, initial_passkey_enrollment_id, purpose,
            challenge_hash, expected_rp_id,
            expected_origin, user_verification, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'required', $8, $9)`,
        [
          challengeId,
          resolved.account.id,
          resolved.enrollmentId,
          resolved.recoverySessionId === null ? "registration" : "recovery_registration",
          hashBearerValue(options.challenge),
          this.config.WEBAUTHN_RP_ID,
          this.config.IDENTITY_PUBLIC_ORIGIN,
          now,
          new Date(now.getTime() + challengeLifetimeMs)
        ]
      );
      if (resolved.recoverySessionId !== null) {
        await client.query(
          `insert into totp_recovery_challenge_bindings
             (challenge_id, recovery_session_id, account_id)
           values ($1, $2, $3)`,
          [challengeId, resolved.recoverySessionId, resolved.account.id]
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
    const challenge = await this.getChallenge(
      input.challengeId,
      authority.recoverySessionId === null ? "registration" : "recovery_registration"
    );
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
      if (authority.recoverySessionId !== null) {
        const recovery = await client.query(
          `update totp_recovery_sessions r
              set completed_at = $3
            where r.id = $1 and r.account_id = $2
              and r.completed_at is null and r.invalidated_at is null
              and r.expires_at >= $3
              and exists (
                select 1 from totp_recovery_challenge_bindings b
                 where b.challenge_id = $4
                   and b.recovery_session_id = r.id
                   and b.account_id = r.account_id
              )
          returning r.id`,
          [authority.recoverySessionId, authority.account.id, now, challenge.id]
        );
        this.requireSingleRow(recovery, () => this.denied());
      }
      if (authority.enrollmentId !== null) {
        const consumed = await client.query(
          `update initial_passkey_enrollments
              set consumed_at = $2
            where id = $1 and consumed_at is null and invalidated_at is null
              and expires_at >= $2
          returning id`,
          [authority.enrollmentId, now]
        );
        this.requireSingleRow(consumed, () => this.denied());
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
      if (authority.recoverySessionId !== null) {
        await this.revokeAccountSessions(client, authority.account.id, now);
        await this.insertSecurityEvent(client, {
          eventType: "passkey_recovery_completed",
          actorKind: "anonymous",
          accountId: authority.account.id,
          correlationId: authority.recoverySessionId
        });
      }
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
    readonly csrfCookie: string;
  }> {
    const challenge = await this.getChallenge(input.challengeId, "authentication");
    const credentialId = this.decodeCredentialId(input.response.id);
    const credentialResult = await this.pool.query<CredentialRow>(
      `select c.id as credential_row_id, c.credential_id, c.public_key,
              c.counter::text, c.device_type, c.backed_up,
              c.transports::text[] as transports,
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
      this.requireSingleRow(activeCredential, () => this.denied());
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
      cookie: `${identitySessionCookieName}=${sessionCredential}; Path=/; Max-Age=2592000; Secure; HttpOnly; SameSite=Lax`,
      csrfCookie: `${identityCsrfCookieName}=${csrfToken}; Path=/; Max-Age=2592000; Secure; SameSite=Lax`
    };
  }

  /** Lists active passkeys for the authenticated account. */
  async listPasskeys(authority: RegistrationRequestAuthority) {
    const session = await this.resolveSessionAuthority(authority, false);
    const result = await this.pool.query(
      `select id, label, device_type as "deviceType", backed_up as "backedUp",
              created_at as "createdAt", last_used_at as "lastUsedAt"
         from webauthn_credentials
        where account_id = $1 and revoked_at is null
        order by created_at, id`,
      [session.account.id]
    );
    return { passkeys: result.rows, currentCredentialId: session.credentialId };
  }

  /** Renames one active passkey owned by the authenticated account. */
  async renamePasskey(
    authority: RegistrationRequestAuthority,
    credentialId: string,
    label: string
  ) {
    const session = await this.resolveSessionAuthority(authority, true);
    const normalized = label.trim();
    if (!normalized || normalized.length > 200) {
      throw new IdentityAuthenticationError(400, "invalid_label", "Passkey label is invalid");
    }
    let result;
    try {
      result = await this.pool.query(
        `update webauthn_credentials
            set label = $3
          where id = $1 and account_id = $2 and revoked_at is null
        returning id, label`,
        [credentialId, session.account.id, normalized]
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new IdentityAuthenticationError(409, "passkey_label_conflict", "Passkey label already exists");
      }
      throw error;
    }
    this.requireSingleRow(
      result,
      () => new IdentityAuthenticationError(404, "passkey_not_found", "Passkey not found")
    );
    return result.rows[0];
  }

  /** Revokes one passkey and every session established through it. */
  async revokePasskey(authority: RegistrationRequestAuthority, credentialId: string) {
    const session = await this.resolveSessionAuthority(authority, true);
    const now = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.requireActiveAccount(client, session.account.id);
      const target = await client.query<{ id: string }>(
        `select id from webauthn_credentials
          where id = $1 and account_id = $2 and revoked_at is null
          for update`,
        [credentialId, session.account.id]
      );
      this.requireSingleRow(
        target,
        () => new IdentityAuthenticationError(404, "passkey_not_found", "Passkey not found")
      );
      const alternatives = await client.query(
        `select 1
           where exists (
             select 1 from webauthn_credentials
              where account_id = $1 and revoked_at is null and id <> $2
           ) or exists (
             select 1 from totp_credentials
              where account_id = $1 and verified_at is not null and revoked_at is null
           )`,
        [session.account.id, credentialId]
      );
      this.requireSingleRow(
        alternatives,
        () => new IdentityAuthenticationError(409, "last_authentication_method", "Another authentication method is required")
      );
      await client.query(`update webauthn_credentials set revoked_at = $3 where id = $1 and account_id = $2`, [credentialId, session.account.id, now]);
      await this.revokeCredentialSessions(client, session.account.id, credentialId, now);
      await this.insertSecurityEvent(client, {
        eventType: "passkey_revoked",
        actorKind: "account",
        actorAccountId: session.account.id,
        accountId: session.account.id,
        sessionId: session.sessionId,
        correlationId: credentialId
      });
      await client.query("commit");
      return { revoked: true, currentSessionRevoked: session.credentialId === credentialId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Lists active browser sessions for the authenticated account. */
  async listSessions(authority: RegistrationRequestAuthority) {
    const session = await this.resolveSessionAuthority(authority, false);
    const result = await this.pool.query(
      `select id, webauthn_credential_id as "credentialId",
              authenticated_at as "authenticatedAt",
              last_activity_at as "lastActivityAt", expires_at as "expiresAt"
         from oauth_sessions
        where account_id = $1 and revoked_at is null and expires_at >= now()
        order by last_activity_at desc, id`,
      [session.account.id]
    );
    return {
      sessions: result.rows.map((row: Record<string, unknown>) => ({
        ...row,
        current: row.id === session.sessionId
      }))
    };
  }

  /** Revokes one browser session owned by the authenticated account. */
  async revokeSession(authority: RegistrationRequestAuthority, sessionId: string) {
    const session = await this.resolveSessionAuthority(authority, true);
    const now = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const revoked = await client.query(
        `update oauth_sessions set revoked_at = $3
          where id = $1 and account_id = $2 and revoked_at is null
        returning id`,
        [sessionId, session.account.id, now]
      );
      this.requireSingleRow(
        revoked,
        () => new IdentityAuthenticationError(404, "session_not_found", "Session not found")
      );
      await this.revokeSessionDependents(client, session.account.id, [sessionId], now);
      await this.insertSecurityEvent(client, {
        eventType: "oauth_session_revoked",
        actorKind: "account",
        actorAccountId: session.account.id,
        accountId: session.account.id,
        sessionId,
        correlationId: sessionId
      });
      await client.query("commit");
      return { revoked: true, currentSessionRevoked: session.sessionId === sessionId };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Resolves the active passkey session used by an OAuth interaction page. */
  async getOAuthBrowserSession(
    authority: RegistrationRequestAuthority
  ): Promise<OAuthBrowserSession> {
    return this.toOAuthBrowserSession(
      await this.resolveSessionAuthority(authority, false)
    );
  }

  /**
   * Binds an OAuth interaction to the exact CSRF-authorized passkey session.
   *
   * @param authority - Cookie and session-bound CSRF authority from the page.
   * @param interactionCredential - Opaque provider interaction identifier.
   * @returns The exact session metadata used for provider login completion.
   * @throws IdentityAuthenticationError when authority or interaction is invalid.
   */
  async bindOAuthInteractionSession(
    authority: RegistrationRequestAuthority,
    interactionCredential: string
  ): Promise<OAuthBrowserSession> {
    const session = await this.resolveSessionAuthority(authority, true);
    const result = await this.pool.query(
      `update oauth_interactions
          set account_id = $2, session_id = $3
        where credential_hash = $1
          and status = 'pending' and expires_at >= now()
          and (account_id is null or account_id = $2)
          and (session_id is null or session_id = $3)
      returning id`,
      [hashBearerValue(interactionCredential), session.account.id, session.sessionId]
    );
    if (result.rowCount !== 1) {
      throw new IdentityAuthenticationError(
        400,
        "invalid_oauth_interaction",
        "OAuth interaction is invalid or expired"
      );
    }
    return this.toOAuthBrowserSession(session);
  }

  /** Starts authenticated TOTP enrollment and returns its setup URI once. */
  async createTotpSetup(authority: RegistrationRequestAuthority, loginHandle: string) {
    const keyRing = this.requireTotpKeyRing();
    const session = await this.resolveSessionAuthority(authority, true);
    const normalizedHandle = loginHandle.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(normalizedHandle)) {
      throw new IdentityAuthenticationError(400, "invalid_login_handle", "Login handle is invalid");
    }
    const secret = randomBytes(20);
    const encrypted = encryptTotpSecret(secret, keyRing);
    const factorId = randomUUID();
    const now = new Date();
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`update identity_accounts set login_handle = $2, updated_at = $3 where id = $1`, [session.account.id, normalizedHandle, now]);
      await client.query(`update totp_credentials set revoked_at = $2 where account_id = $1 and verified_at is null and revoked_at is null`, [session.account.id, now]);
      await client.query(
        `insert into totp_credentials
           (id, account_id, secret_ciphertext, secret_nonce, secret_tag, key_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [factorId, session.account.id, encrypted.ciphertext, encrypted.nonce, encrypted.tag, encrypted.keyId, now]
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      if ((error as { code?: string }).code === "23505") {
        throw new IdentityAuthenticationError(409, "login_handle_conflict", "Login handle is unavailable");
      }
      throw error;
    } finally {
      client.release();
    }
    const label = `${this.config.WEBAUTHN_RP_NAME}:${normalizedHandle}`;
    const query = new URLSearchParams({ secret: encodeBase32(secret), issuer: this.config.WEBAUTHN_RP_NAME, algorithm: "SHA1", digits: "6", period: "30" });
    return { factorId, loginHandle: normalizedHandle, otpauthUri: `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}` };
  }

  /** Confirms a pending TOTP factor with its first valid code. */
  async confirmTotpSetup(authority: RegistrationRequestAuthority, code: string) {
    const keyRing = this.requireTotpKeyRing();
    const session = await this.resolveSessionAuthority(authority, true);
    const row = await this.getTotpCredential(session.account.id, false);
    const now = new Date();
    const step = verifyTotpCode(this.decryptTotp(row, keyRing), code, now, null);
    if (step === null) throw new IdentityAuthenticationError(400, "invalid_totp_code", "TOTP code is invalid");
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.requireActiveAccount(client, session.account.id);
      await client.query(`update totp_credentials set revoked_at = $2 where account_id = $1 and verified_at is not null and revoked_at is null`, [session.account.id, now]);
      const activated = await client.query(
        `update totp_credentials
            set verified_at = $3, last_accepted_step = $4
          where id = $1 and account_id = $2 and verified_at is null and revoked_at is null
        returning id`,
        [row.id, session.account.id, now, step]
      );
      this.requireSingleRow(activated, () => this.denied());
      await this.insertSecurityEvent(client, {
        eventType: "totp_factor_enrolled",
        actorKind: "account",
        actorAccountId: session.account.id,
        accountId: session.account.id,
        sessionId: session.sessionId,
        correlationId: row.id
      });
      await client.query("commit");
      return { enabled: true };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Exchanges a valid TOTP code for a narrow replacement-passkey authority. */
  async startTotpRecovery(loginHandle: string, code: string) {
    const keyRing = this.requireTotpKeyRing();
    const normalizedHandle = loginHandle.trim().toLowerCase();
    const result = await this.pool.query<TotpRow>(
      `select t.*
         from totp_credentials t
         join identity_accounts a on a.id = t.account_id
        where a.login_handle = $1 and a.status = 'active'
          and t.verified_at is not null and t.revoked_at is null`,
      [normalizedHandle]
    );
    const row = result.rows[0];
    const now = new Date();
    if (!row || (row.locked_until && row.locked_until > now)) throw this.denied();
    let step: number | null = null;
    try {
      step = verifyTotpCode(this.decryptTotp(row, keyRing), code, now, row.last_accepted_step === null ? null : Number(row.last_accepted_step));
    } catch {
      throw this.denied();
    }
    if (step === null) {
      await this.recordTotpFailure(row, now);
      throw this.denied();
    }
    const token = createOpaqueToken();
    const recoverySessionId = randomUUID();
    const expiresAt = new Date(now.getTime() + totpRecoveryLifetimeMs);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const accepted = await client.query(
        `update totp_credentials
            set last_accepted_step = $3, failed_attempts = 0,
                attempt_window_started_at = null, locked_until = null
          where id = $1 and account_id = $2 and revoked_at is null
            and (locked_until is null or locked_until <= $4)
            and (last_accepted_step is null or last_accepted_step < $3)
        returning id`,
        [row.id, row.account_id, step, now]
      );
      this.requireSingleRow(accepted, () => this.denied());
      await client.query(`update totp_recovery_sessions set invalidated_at = $2 where account_id = $1 and completed_at is null and invalidated_at is null`, [row.account_id, now]);
      await client.query(
        `insert into totp_recovery_sessions
           (id, account_id, totp_credential_id, token_hash, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [recoverySessionId, row.account_id, row.id, hashBearerValue(token), now, expiresAt]
      );
      await this.insertSecurityEvent(client, { eventType: "totp_recovery_started", actorKind: "anonymous", accountId: row.account_id, correlationId: recoverySessionId });
      await client.query("commit");
      return { recoveryToken: token, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
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
      if (row) {
        return {
          account: row,
          enrollmentId: row.enrollment_id,
          sessionId: null,
          recoverySessionId: null
        };
      }
      const recovery = await this.pool.query<
        AccountRow & { recovery_session_id: string }
      >(
        `select a.id, a.subject, a.webauthn_user_handle, a.display_name,
                r.id as recovery_session_id
           from totp_recovery_sessions r
           join identity_accounts a on a.id = r.account_id
          where r.token_hash = $1 and r.completed_at is null
            and r.invalidated_at is null and r.expires_at >= now()
            and a.status = 'active'`,
        [hashBearerValue(bearer)]
      );
      const recoveryRow = recovery.rows[0];
      if (!recoveryRow) throw this.denied();
      return {
        account: recoveryRow,
        enrollmentId: null,
        sessionId: null,
        recoverySessionId: recoveryRow.recovery_session_id
      };
    }
    const session = await this.resolveSessionAuthority(input, true);
    return {
      account: session.account,
      enrollmentId: null,
      sessionId: session.sessionId,
      recoverySessionId: null
    };
  }

  private async resolveSessionAuthority(
    input: RegistrationRequestAuthority,
    requireCsrf: boolean
  ): Promise<SessionAuthority> {
    const sessionToken = this.readCookie(input.cookie, identitySessionCookieName);
    if (!sessionToken || (requireCsrf && !input.csrfToken)) throw this.denied();
    const result = await this.pool.query<
      AccountRow & {
        acr: string;
        amr: string[];
        authenticated_at: Date;
        csrf_token_hash: Buffer;
        provider_uid: string;
        session_id: string;
        webauthn_credential_id: string | null;
      }
    >(
      `select a.id, a.subject, a.webauthn_user_handle, a.display_name,
              s.id as session_id, s.csrf_token_hash, s.webauthn_credential_id,
              s.provider_uid, s.authenticated_at, s.acr, s.amr
         from oauth_sessions s
         join identity_accounts a on a.id = s.account_id
        where s.credential_hash = $1 and s.revoked_at is null
          and s.expires_at >= now() and a.status = 'active'`,
      [hashBearerValue(sessionToken)]
    );
    const row = result.rows[0];
    if (
      !row ||
      (requireCsrf &&
        (!input.csrfToken || !bearerValueMatches(input.csrfToken, row.csrf_token_hash)))
    ) {
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
    return {
      account: row,
      sessionId: row.session_id,
      credentialId: row.webauthn_credential_id,
      providerUid: row.provider_uid,
      authenticatedAt: row.authenticated_at,
      acr: row.acr,
      amr: row.amr
    };
  }

  private toOAuthBrowserSession(session: SessionAuthority): OAuthBrowserSession {
    return {
      accountId: session.account.id,
      subject: session.account.subject,
      displayName: session.account.display_name,
      sessionId: session.sessionId,
      providerUid: session.providerUid,
      authenticatedAt: session.authenticatedAt,
      acr: session.acr,
      amr: session.amr
    };
  }

  private requireTotpKeyRing(): TotpKeyRing {
    if (!this.totpKeyRing) {
      throw new IdentityAuthenticationError(503, "totp_unavailable", "TOTP recovery is unavailable");
    }
    return this.totpKeyRing;
  }

  private async getTotpCredential(accountId: string, verified: boolean): Promise<TotpRow> {
    const result = await this.pool.query<TotpRow>(
      `select * from totp_credentials
        where account_id = $1 and revoked_at is null
          and (($2 and verified_at is not null) or (not $2 and verified_at is null))`,
      [accountId, verified]
    );
    const row = result.rows[0];
    if (!row) throw new IdentityAuthenticationError(404, "totp_not_found", "TOTP factor not found");
    return row;
  }

  private decryptTotp(row: TotpRow, keyRing: TotpKeyRing): Buffer {
    return decryptTotpSecret(
      {
        ciphertext: row.secret_ciphertext,
        nonce: row.secret_nonce,
        tag: row.secret_tag,
        keyId: row.key_id
      },
      keyRing
    );
  }

  private async recordTotpFailure(row: TotpRow, now: Date): Promise<void> {
    await this.pool.query(
      `update totp_credentials
          set failed_attempts = case
                when attempt_window_started_at is null
                  or attempt_window_started_at <= $2::timestamptz - interval '15 minutes'
                  then 1
                else least(failed_attempts + 1, 5)
              end,
              attempt_window_started_at = case
                when attempt_window_started_at is null
                  or attempt_window_started_at <= $2::timestamptz - interval '15 minutes'
                  then $2
                else attempt_window_started_at
              end,
              locked_until = case
                when attempt_window_started_at is not null
                  and attempt_window_started_at > $2::timestamptz - interval '15 minutes'
                  and failed_attempts + 1 >= 5
                  then $2::timestamptz + interval '15 minutes'
                else null
              end
        where id = $1 and revoked_at is null`,
      [row.id, now]
    );
  }

  private async revokeCredentialSessions(
    client: PoolClient,
    accountId: string,
    credentialId: string,
    now: Date
  ): Promise<void> {
    const sessions = await client.query<{ id: string }>(
      `update oauth_sessions set revoked_at = $3
        where account_id = $1 and webauthn_credential_id = $2 and revoked_at is null
      returning id`,
      [accountId, credentialId, now]
    );
    await this.revokeSessionDependents(client, accountId, sessions.rows.map((row) => row.id), now);
  }

  private async revokeAccountSessions(client: PoolClient, accountId: string, now: Date): Promise<void> {
    const sessions = await client.query<{ id: string }>(
      `update oauth_sessions set revoked_at = $2
        where account_id = $1 and revoked_at is null returning id`,
      [accountId, now]
    );
    await this.revokeSessionDependents(client, accountId, sessions.rows.map((row) => row.id), now);
  }

  private async revokeSessionDependents(
    client: PoolClient,
    accountId: string,
    sessionIds: readonly string[],
    now: Date
  ): Promise<void> {
    if (sessionIds.length === 0) return;
    await client.query(
      `update oauth_session_authorizations set revoked_at = $3
        where account_id = $1 and session_id = any($2::uuid[]) and revoked_at is null`,
      [accountId, sessionIds, now]
    );
    await client.query(
      `update oauth_refresh_token_families set revoked_at = $3
        where account_id = $1 and session_id = any($2::uuid[]) and revoked_at is null`,
      [accountId, sessionIds, now]
    );
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
    purpose: "registration" | "authentication" | "recovery_registration"
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
    let decoded: Buffer;
    try {
      decoded = Buffer.from(value, "base64url");
    } catch {
      throw new IdentityAuthenticationError(400, "invalid_webauthn_response", "Credential id is invalid");
    }
    if (!decoded.length || decoded.toString("base64url") !== value) {
      throw new IdentityAuthenticationError(400, "invalid_webauthn_response", "Credential id is invalid");
    }
    return decoded;
  }

  private requireSingleRow(
    result: { readonly rowCount: number | null },
    createError: () => IdentityAuthenticationError
  ): void {
    if (result.rowCount !== 1) throw createError();
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
      readonly eventType:
        | "initial_passkey_enrollment_created"
        | "passkey_registered"
        | "passkey_authentication"
        | "passkey_revoked"
        | "totp_factor_enrolled"
        | "totp_recovery_started"
        | "passkey_recovery_completed"
        | "oauth_session_revoked";
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
