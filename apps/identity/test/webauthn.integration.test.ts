import { randomBytes, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer
} from "@testcontainers/postgresql";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON
} from "@simplewebauthn/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIdentityServer } from "../src/app.js";
import { IdentityAuthenticationService } from "../src/authentication/service.js";
import { createOpaqueToken, hashBearerValue } from "../src/authentication/crypto.js";
import {
  createTotpCode,
  encryptTotpSecret,
  parseTotpKeyRing
} from "../src/authentication/totp.js";
import type {
  StoredPasskey,
  VerifiedPasskeyAuthentication,
  VerifiedPasskeyRegistration,
  WebAuthnAdapter
} from "../src/authentication/webauthn-adapter.js";
import { runIdentityMigrations } from "../src/database/migrate.js";

const publicOrigin = "https://identity.example.test";
const registeredCredentialId = randomBytes(32);
const testTotpKeyRing = parseTotpKeyRing("test", JSON.stringify({
  test: Buffer.alloc(32, 9).toString("base64url")
}));

class FakeWebAuthnAdapter implements WebAuthnAdapter {
  private sequence = 0;

  async createRegistrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    this.sequence += 1;
    return { challenge: `registration-${this.sequence}` } as PublicKeyCredentialCreationOptionsJSON;
  }

  async verifyRegistration(input: {
    readonly response: RegistrationResponseJSON;
    readonly expectedChallenge: (challenge: string) => boolean;
  }): Promise<VerifiedPasskeyRegistration> {
    const challenge = (input.response as unknown as { challenge: string }).challenge;
    if (!input.expectedChallenge(challenge)) throw new Error("challenge mismatch");
    return {
      credentialId: Buffer.from(input.response.id, "base64url"),
      publicKey: randomBytes(64),
      counter: 0,
      deviceType: "multi_device",
      backedUp: true,
      transports: ["internal"]
    };
  }

  async createAuthenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    this.sequence += 1;
    return { challenge: `authentication-${this.sequence}` } as PublicKeyCredentialRequestOptionsJSON;
  }

  async verifyAuthentication(input: {
    readonly response: AuthenticationResponseJSON;
    readonly expectedChallenge: (challenge: string) => boolean;
    readonly credential: StoredPasskey;
  }): Promise<VerifiedPasskeyAuthentication> {
    const challenge = (input.response as unknown as { challenge: string }).challenge;
    if (!input.expectedChallenge(challenge)) throw new Error("challenge mismatch");
    expect(input.credential.credentialId).toEqual(
      Buffer.from(input.response.id, "base64url")
    );
    expect(input.credential.transports).toEqual(["internal"]);
    return { counter: 0, backedUp: true };
  }
}

let container: StartedPostgreSqlContainer;
let pool: Pool;
let server: ReturnType<typeof createIdentityServer>;
let localOrigin: string;
let authentication: IdentityAuthenticationService;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("shape_of_you_identity_webauthn")
    .withUsername("shape_of_you_identity")
    .withPassword("shape_of_you_identity")
    .start();
  await runIdentityMigrations(container.getConnectionUri());
  pool = new Pool({ connectionString: container.getConnectionUri() });
  authentication = new IdentityAuthenticationService(pool, new FakeWebAuthnAdapter(), {
    IDENTITY_PUBLIC_ORIGIN: publicOrigin,
    WEBAUTHN_RP_ID: "identity.example.test",
    WEBAUTHN_RP_NAME: "Shape of You"
  }, testTotpKeyRing);
  server = createIdentityServer({
    readiness: { check: async () => undefined },
    authentication,
    publicOrigin
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  localOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await pool?.end();
  await container?.stop();
});

async function post(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${localOrigin}${path}`, {
    ...init,
    method: "POST",
    headers: {
      origin: publicOrigin,
      "content-type": "application/json",
      ...init.headers
    }
  });
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of value) {
    buffer = (buffer << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

describe("Identity WebAuthn HTTP flow", () => {
  it("enforces Origin, one-time bootstrap authority, and session-bound CSRF", async () => {
    const bootstrap = await authentication.bootstrapAccount("Operator");

    const missingOrigin = await fetch(
      `${localOrigin}/v1/webauthn/authentication/options`,
      { method: "POST" }
    );
    expect(missingOrigin.status).toBe(403);

    const wrongOrigin = await post("/v1/webauthn/registration/options", {
      headers: { authorization: `Bearer ${bootstrap.enrollmentToken}`, origin: "https://evil.test" }
    });
    expect(wrongOrigin.status).toBe(403);

    const disabledBootstrap = await authentication.bootstrapAccount("Disabled operator");
    await pool.query(
      `update identity_accounts
          set status = 'disabled', disabled_at = now(), updated_at = now()
        where id = $1`,
      [disabledBootstrap.accountId]
    );
    const disabledAccount = await post("/v1/webauthn/registration/options", {
      headers: { authorization: `Bearer ${disabledBootstrap.enrollmentToken}` }
    });
    expect(disabledAccount.status).toBe(401);

    const mismatchBootstrap = await authentication.bootstrapAccount("Mismatch operator");
    const mismatchedOptionsResponse = await post("/v1/webauthn/registration/options", {
      headers: { authorization: `Bearer ${mismatchBootstrap.enrollmentToken}` }
    });
    const mismatchedOptions = (await mismatchedOptionsResponse.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const replacementToken = createOpaqueToken();
    await pool.query(
      `update initial_passkey_enrollments
          set invalidated_at = greatest(clock_timestamp(), created_at)
        where account_id = $1 and invalidated_at is null and consumed_at is null`,
      [mismatchBootstrap.accountId]
    );
    await pool.query(
      `insert into initial_passkey_enrollments
         (id, account_id, token_hash, expires_at)
       values ($1, $2, $3, now() + interval '15 minutes')`,
      [randomUUID(), mismatchBootstrap.accountId, hashBearerValue(replacementToken)]
    );
    const mismatchedEnrollment = await post("/v1/webauthn/registration/verify", {
      headers: { authorization: `Bearer ${replacementToken}` },
      body: JSON.stringify({
        challengeId: mismatchedOptions.challengeId,
        response: {
          id: registeredCredentialId.toString("base64url"),
          challenge: mismatchedOptions.options.challenge
        }
      })
    });
    expect(mismatchedEnrollment.status).toBe(401);

    const registrationOptions = await post("/v1/webauthn/registration/options", {
      headers: { authorization: `Bearer ${bootstrap.enrollmentToken}` }
    });
    expect(registrationOptions.status).toBe(200);
    const registration = (await registrationOptions.json()) as {
      challengeId: string;
      options: { challenge: string };
    };

    const registrationVerification = await post("/v1/webauthn/registration/verify", {
      headers: { authorization: `Bearer ${bootstrap.enrollmentToken}` },
      body: JSON.stringify({
        challengeId: registration.challengeId,
        label: "Primary device",
        response: { id: registeredCredentialId.toString("base64url"), challenge: registration.options.challenge }
      })
    });
    expect(registrationVerification.status).toBe(201);

    const replay = await post("/v1/webauthn/registration/verify", {
      headers: { authorization: `Bearer ${bootstrap.enrollmentToken}` },
      body: JSON.stringify({
        challengeId: registration.challengeId,
        response: { id: registeredCredentialId.toString("base64url"), challenge: registration.options.challenge }
      })
    });
    expect(replay.status).toBe(401);

    const authenticationOptions = await post("/v1/webauthn/authentication/options");
    const authenticationChallenge = (await authenticationOptions.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const authenticationVerification = await post("/v1/webauthn/authentication/verify", {
      body: JSON.stringify({
        challengeId: authenticationChallenge.challengeId,
        response: {
          id: registeredCredentialId.toString("base64url"),
          challenge: authenticationChallenge.options.challenge
        }
      })
    });
    expect(authenticationVerification.status).toBe(200);
    expect(authenticationVerification.headers.get("cache-control")).toBe("no-store");
    const login = (await authenticationVerification.json()) as { csrfToken: string };
    const cookie = authenticationVerification.headers.get("set-cookie");
    expect(cookie).toContain("__Host-shape_of_you_identity=");
    expect(cookie).toContain("Secure; HttpOnly; SameSite=Lax");
    expect(cookie).not.toContain("Domain=");

    const missingCsrf = await post("/v1/webauthn/registration/options", {
      headers: { cookie: cookie! }
    });
    expect(missingCsrf.status).toBe(401);

    const wrongCsrf = await post("/v1/webauthn/registration/options", {
      headers: { cookie: cookie!, "x-csrf-token": "wrong" }
    });
    expect(wrongCsrf.status).toBe(401);

    const sessionAuthorized = await post("/v1/webauthn/registration/options", {
      headers: { cookie: cookie!, "x-csrf-token": login.csrfToken }
    });
    expect(sessionAuthorized.status).toBe(200);

    const persisted = await pool.query<{
      active_enrollments: string;
      csrf_hash_length: number;
      session_hash_length: number;
    }>(
      `select
         (select count(*)::text from initial_passkey_enrollments
           where account_id = $1 and consumed_at is null
             and invalidated_at is null) as active_enrollments,
         octet_length(csrf_token_hash)::int as csrf_hash_length,
         octet_length(credential_hash)::int as session_hash_length
       from oauth_sessions`,
      [bootstrap.accountId]
    );
    expect(persisted.rows[0]).toEqual({
      active_enrollments: "0",
      csrf_hash_length: 32,
      session_hash_length: 32
    });
  });

  it("manages passkeys and completes TOTP replacement recovery", async () => {
    const primaryCredentialId = randomBytes(32);
    const replacementCredentialId = randomBytes(32);
    const bootstrap = await authentication.bootstrapAccount("Recovery operator");

    const registrationOptions = await post("/v1/webauthn/registration/options", {
      headers: { authorization: `Bearer ${bootstrap.enrollmentToken}` }
    });
    const registration = (await registrationOptions.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const registered = await post("/v1/webauthn/registration/verify", {
      headers: { authorization: `Bearer ${bootstrap.enrollmentToken}` },
      body: JSON.stringify({
        challengeId: registration.challengeId,
        label: "Lost phone",
        response: {
          id: primaryCredentialId.toString("base64url"),
          challenge: registration.options.challenge
        }
      })
    });
    expect(registered.status).toBe(201);
    const primary = (await registered.json()) as { credentialId: string };

    const authOptions = await post("/v1/webauthn/authentication/options");
    const authChallenge = (await authOptions.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const authenticated = await post("/v1/webauthn/authentication/verify", {
      body: JSON.stringify({
        challengeId: authChallenge.challengeId,
        response: {
          id: primaryCredentialId.toString("base64url"),
          challenge: authChallenge.options.challenge
        }
      })
    });
    const sessionCookie = authenticated.headers.get("set-cookie")!;
    const login = (await authenticated.json()) as { csrfToken: string };
    const authenticatedHeaders = {
      cookie: sessionCookie,
      "x-csrf-token": login.csrfToken
    };

    const listed = await fetch(`${localOrigin}/v1/security/passkeys`, {
      headers: { cookie: sessionCookie }
    });
    expect(listed.status).toBe(200);
    expect((await listed.json()) as object).toMatchObject({
      passkeys: [{ id: primary.credentialId, label: "Lost phone" }],
      currentCredentialId: primary.credentialId
    });

    const renamed = await fetch(
      `${localOrigin}/v1/security/passkeys/${primary.credentialId}`,
      {
        method: "PATCH",
        headers: {
          origin: publicOrigin,
          "content-type": "application/json",
          ...authenticatedHeaders
        },
        body: JSON.stringify({ label: "Old phone" })
      }
    );
    expect(renamed.status).toBe(200);

    const secondAuthOptions = await post("/v1/webauthn/authentication/options");
    const secondAuthChallenge = (await secondAuthOptions.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const secondAuthenticated = await post("/v1/webauthn/authentication/verify", {
      body: JSON.stringify({
        challengeId: secondAuthChallenge.challengeId,
        response: {
          id: primaryCredentialId.toString("base64url"),
          challenge: secondAuthChallenge.options.challenge
        }
      })
    });
    expect(secondAuthenticated.status).toBe(200);

    const sessionsResponse = await fetch(`${localOrigin}/v1/security/sessions`, {
      headers: { cookie: sessionCookie }
    });
    const sessions = (await sessionsResponse.json()) as {
      sessions: Array<{ id: string; current: boolean }>;
    };
    expect(sessions.sessions).toHaveLength(2);
    const currentSession = sessions.sessions.find((item) => item.current)!;
    const otherSession = sessions.sessions.find((item) => !item.current)!;
    const revokedSession = await fetch(
      `${localOrigin}/v1/security/sessions/${otherSession.id}`,
      { method: "DELETE", headers: { origin: publicOrigin, ...authenticatedHeaders } }
    );
    expect(revokedSession.status).toBe(200);

    const refusedLastPasskey = await fetch(
      `${localOrigin}/v1/security/passkeys/${primary.credentialId}`,
      { method: "DELETE", headers: { origin: publicOrigin, ...authenticatedHeaders } }
    );
    expect(refusedLastPasskey.status).toBe(409);

    const setup = await post("/v1/security/totp/setup", {
      headers: authenticatedHeaders,
      body: JSON.stringify({ loginHandle: "recovery.operator" })
    });
    expect(setup.status).toBe(201);
    const setupBody = (await setup.json()) as { otpauthUri: string };
    const secret = decodeBase32(new URL(setupBody.otpauthUri).searchParams.get("secret")!);
    const currentStep = Math.floor(Date.now() / 1_000 / 30);
    const confirmed = await post("/v1/security/totp/verify", {
      headers: authenticatedHeaders,
      body: JSON.stringify({ code: createTotpCode(secret, currentStep) })
    });
    expect(confirmed.status).toBe(200);

    const oauthClientId = `recovery-client-${randomUUID()}`;
    const grantId = randomUUID();
    const refreshFamilyId = randomUUID();
    await pool.query(
      `insert into oauth_clients (id, display_name, refresh_tokens_enabled)
       values ($1, 'Recovery cascade client', true)`,
      [oauthClientId]
    );
    await pool.query(
      `insert into oauth_grants (id, account_id, client_id)
       values ($1, $2, $3)`,
      [grantId, bootstrap.accountId, oauthClientId]
    );
    await pool.query(
      `insert into oauth_session_authorizations
         (session_id, account_id, client_id, grant_id)
       values ($1, $2, $3, $4)`,
      [currentSession.id, bootstrap.accountId, oauthClientId, grantId]
    );
    await pool.query(
      `insert into oauth_refresh_token_families
         (id, account_id, client_id, session_id, grant_id, expires_at)
       values ($1, $2, $3, $4, $5, now() + interval '1 day')`,
      [
        refreshFamilyId,
        bootstrap.accountId,
        oauthClientId,
        currentSession.id,
        grantId
      ]
    );

    const recovery = await post("/v1/recovery/totp", {
      body: JSON.stringify({
        loginHandle: "recovery.operator",
        code: createTotpCode(secret, currentStep + 1)
      })
    });
    expect(recovery.status).toBe(200);
    const recoveryBody = (await recovery.json()) as { recoveryToken: string };

    const recoveryOptions = await post("/v1/webauthn/registration/options", {
      headers: { authorization: `Bearer ${recoveryBody.recoveryToken}` }
    });
    const recoveryRegistration = (await recoveryOptions.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const replacement = await post("/v1/webauthn/registration/verify", {
      headers: { authorization: `Bearer ${recoveryBody.recoveryToken}` },
      body: JSON.stringify({
        challengeId: recoveryRegistration.challengeId,
        label: "Replacement phone",
        response: {
          id: replacementCredentialId.toString("base64url"),
          challenge: recoveryRegistration.options.challenge
        }
      })
    });
    expect(replacement.status).toBe(201);

    const replayedRecovery = await post("/v1/webauthn/registration/options", {
      headers: { authorization: `Bearer ${recoveryBody.recoveryToken}` }
    });
    expect(replayedRecovery.status).toBe(401);

    const persisted = await pool.query<{
      active_passkeys: string;
      completed_recoveries: string;
      active_sessions: string;
      bound_challenges: string;
      revoked_authorizations: string;
      revoked_refresh_families: string;
      seed_plaintext_matches: boolean;
    }>(
      `select
         (select count(*)::text from webauthn_credentials where account_id = $1 and revoked_at is null) as active_passkeys,
         (select count(*)::text from totp_recovery_sessions where account_id = $1 and completed_at is not null) as completed_recoveries,
         (select count(*)::text from oauth_sessions where account_id = $1 and revoked_at is null) as active_sessions,
         (select count(*)::text
            from totp_recovery_challenge_bindings b
            join totp_recovery_sessions r on r.id = b.recovery_session_id
           where r.account_id = $1 and b.challenge_id = $3) as bound_challenges,
         (select count(*)::text from oauth_session_authorizations
           where account_id = $1 and revoked_at is not null) as revoked_authorizations,
         (select count(*)::text from oauth_refresh_token_families
           where account_id = $1 and revoked_at is not null) as revoked_refresh_families,
         exists(select 1 from totp_credentials where account_id = $1 and secret_ciphertext = $2) as seed_plaintext_matches`,
      [bootstrap.accountId, secret, recoveryRegistration.challengeId]
    );
    expect(persisted.rows[0]).toEqual({
      active_passkeys: "2",
      completed_recoveries: "1",
      active_sessions: "0",
      bound_challenges: "1",
      revoked_authorizations: "1",
      revoked_refresh_families: "1",
      seed_plaintext_matches: false
    });

    const primaryAuthOptions = await post("/v1/webauthn/authentication/options");
    const primaryAuthChallenge = (await primaryAuthOptions.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const primaryAuthenticated = await post("/v1/webauthn/authentication/verify", {
      body: JSON.stringify({
        challengeId: primaryAuthChallenge.challengeId,
        response: {
          id: primaryCredentialId.toString("base64url"),
          challenge: primaryAuthChallenge.options.challenge
        }
      })
    });
    expect(primaryAuthenticated.status).toBe(200);

    const replacementAuthOptions = await post("/v1/webauthn/authentication/options");
    const replacementAuthChallenge = (await replacementAuthOptions.json()) as {
      challengeId: string;
      options: { challenge: string };
    };
    const replacementAuthenticated = await post("/v1/webauthn/authentication/verify", {
      body: JSON.stringify({
        challengeId: replacementAuthChallenge.challengeId,
        response: {
          id: replacementCredentialId.toString("base64url"),
          challenge: replacementAuthChallenge.options.challenge
        }
      })
    });
    expect(replacementAuthenticated.status).toBe(200);
    const replacementLogin = (await replacementAuthenticated.json()) as {
      csrfToken: string;
    };
    const removed = await fetch(
      `${localOrigin}/v1/security/passkeys/${primary.credentialId}`,
      {
        method: "DELETE",
        headers: {
          origin: publicOrigin,
          cookie: replacementAuthenticated.headers.get("set-cookie")!,
          "x-csrf-token": replacementLogin.csrfToken
        }
      }
    );
    expect(removed.status).toBe(200);
    expect(removed.headers.get("set-cookie")).toBeNull();

    const revokedPrimarySession = await fetch(`${localOrigin}/v1/security/passkeys`, {
      headers: { cookie: primaryAuthenticated.headers.get("set-cookie")! }
    });
    expect(revokedPrimarySession.status).toBe(401);

    const replacementCookie = replacementAuthenticated.headers.get("set-cookie")!;
    const replacementSessions = await fetch(`${localOrigin}/v1/security/sessions`, {
      headers: { cookie: replacementCookie }
    });
    expect(replacementSessions.status).toBe(200);
    const activeReplacementSession = ((await replacementSessions.json()) as {
      sessions: Array<{ id: string; current: boolean }>;
    }).sessions.find((item) => item.current)!;

    const selfRevoked = await fetch(
      `${localOrigin}/v1/security/sessions/${activeReplacementSession.id}`,
      {
        method: "DELETE",
        headers: {
          origin: publicOrigin,
          cookie: replacementCookie,
          "x-csrf-token": replacementLogin.csrfToken
        }
      }
    );
    expect(selfRevoked.status).toBe(200);
    expect(selfRevoked.headers.get("set-cookie")).toContain("Max-Age=0");

    const remaining = await pool.query<{
      active_passkeys: string;
      active_sessions: string;
    }>(
      `select
         (select count(*)::text from webauthn_credentials
           where account_id = $1 and revoked_at is null) as active_passkeys,
         (select count(*)::text from oauth_sessions
           where account_id = $1 and revoked_at is null) as active_sessions`,
      [bootstrap.accountId]
    );
    expect(remaining.rows[0]).toEqual({
      active_passkeys: "1",
      active_sessions: "0"
    });
  });

  it("returns generic recovery failures and persists the five-attempt lockout", async () => {
    const accountId = randomUUID();
    const factorId = randomUUID();
    const secret = randomBytes(20);
    const encrypted = encryptTotpSecret(secret, testTotpKeyRing);
    await pool.query(
      `insert into identity_accounts
         (id, subject, webauthn_user_handle, display_name, login_handle)
       values ($1, $2, $3, 'Locked recovery account', 'locked.recovery')`,
      [accountId, randomUUID(), randomBytes(32)]
    );
    await pool.query(
      `insert into totp_credentials
         (id, account_id, secret_ciphertext, secret_nonce, secret_tag,
          key_id, verified_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [
        factorId,
        accountId,
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.tag,
        encrypted.keyId
      ]
    );

    const unknown = await post("/v1/recovery/totp", {
      body: JSON.stringify({ loginHandle: "unknown.recovery", code: "000000" })
    });
    const unknownBody = await unknown.json();
    let knownFailureBody: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await post("/v1/recovery/totp", {
        body: JSON.stringify({ loginHandle: "locked.recovery", code: "000000" })
      });
      expect(response.status).toBe(unknown.status);
      knownFailureBody = await response.json();
      expect(knownFailureBody).toEqual(unknownBody);
    }

    const lockedValidCode = await post("/v1/recovery/totp", {
      body: JSON.stringify({
        loginHandle: "locked.recovery",
        code: createTotpCode(secret, Math.floor(Date.now() / 1_000 / 30))
      })
    });
    expect(lockedValidCode.status).toBe(401);
    expect(await lockedValidCode.json()).toEqual(unknownBody);

    const lockState = await pool.query<{
      failed_attempts: number;
      locked: boolean;
    }>(
      `select failed_attempts, locked_until > now() as locked
         from totp_credentials where id = $1`,
      [factorId]
    );
    expect(lockState.rows[0]).toEqual({ failed_attempts: 5, locked: true });
  });

  it("rejects an expired TOTP recovery authority", async () => {
    const accountId = randomUUID();
    const secret = randomBytes(20);
    const encrypted = encryptTotpSecret(secret, testTotpKeyRing);
    await pool.query(
      `insert into identity_accounts
         (id, subject, webauthn_user_handle, display_name, login_handle)
       values ($1, $2, $3, 'Expired recovery account', 'expired.recovery')`,
      [accountId, randomUUID(), randomBytes(32)]
    );
    await pool.query(
      `insert into totp_credentials
         (id, account_id, secret_ciphertext, secret_nonce, secret_tag,
          key_id, verified_at)
       values ($1, $2, $3, $4, $5, $6, now())`,
      [
        randomUUID(),
        accountId,
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.tag,
        encrypted.keyId
      ]
    );

    const recovery = await post("/v1/recovery/totp", {
      body: JSON.stringify({
        loginHandle: "expired.recovery",
        code: createTotpCode(secret, Math.floor(Date.now() / 1_000 / 30))
      })
    });
    expect(recovery.status).toBe(200);
    const body = (await recovery.json()) as { recoveryToken: string };
    await pool.query(
      `update totp_recovery_sessions
          set created_at = now() - interval '20 minutes',
              expires_at = now() - interval '5 minutes'
        where account_id = $1`,
      [accountId]
    );

    const expired = await post("/v1/webauthn/registration/options", {
      headers: { authorization: `Bearer ${body.recoveryToken}` }
    });
    expect(expired.status).toBe(401);
  });
});
