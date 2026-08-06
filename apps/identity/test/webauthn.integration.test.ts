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
import type {
  StoredPasskey,
  VerifiedPasskeyAuthentication,
  VerifiedPasskeyRegistration,
  WebAuthnAdapter
} from "../src/authentication/webauthn-adapter.js";
import { runIdentityMigrations } from "../src/database/migrate.js";

const publicOrigin = "https://identity.example.test";
const registeredCredentialId = randomBytes(32);

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
      credentialId: registeredCredentialId,
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
    expect(input.credential.credentialId).toEqual(registeredCredentialId);
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
  });
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
});
