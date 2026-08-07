import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON
} from "@simplewebauthn/browser";

/** Browser projection of one active passkey returned by Identity. */
export interface PasskeySummary {
  readonly id: string;
  readonly label: string | null;
  readonly deviceType: string;
  readonly backedUp: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

/** Server-owned active passkey state for the authenticated account. */
export interface PasskeyList {
  readonly passkeys: readonly PasskeySummary[];
  readonly currentCredentialId: string | null;
}

/** Browser projection of one active Identity session. */
export interface SessionSummary {
  readonly id: string;
  readonly credentialId: string | null;
  readonly authenticatedAt: string;
  readonly lastActivityAt: string;
  readonly expiresAt: string;
  readonly current: boolean;
}

/** Server-owned active session state for the authenticated account. */
export interface SessionList {
  readonly sessions: readonly SessionSummary[];
}

/** Registration challenge and WebAuthn creation options issued by Identity. */
export interface RegistrationOptionsResult {
  readonly challengeId: string;
  readonly options: PublicKeyCredentialCreationOptionsJSON;
}

/** Authentication challenge and WebAuthn request options issued by Identity. */
export interface AuthenticationOptionsResult {
  readonly challengeId: string;
  readonly options: PublicKeyCredentialRequestOptionsJSON;
}

/** Result of revoking a passkey or session through Identity. */
export interface MutationResult {
  readonly revoked: boolean;
  readonly currentSessionRevoked: boolean;
}

/**
 * Bounded Identity HTTP failure safe for client-side control flow.
 *
 * @remarks The error intentionally retains only status and stable error code; backend
 * messages and protocol details are never copied into the browser error surface.
 */
export class IdentityApiError extends Error {
  /**
   * Creates a bounded Identity API error.
   *
   * @param status - HTTP response status.
   * @param code - Stable backend error code used for allowlisted UI mapping.
   */
  public constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super("Identity request was not accepted");
    this.name = "IdentityApiError";
  }
}

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

async function requestJson<T>(
  fetcher: Fetcher,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetcher(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...init.headers
    }
  });
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) {
    throw new IdentityApiError(
      response.status,
      typeof body.error === "string" ? body.error : "request_denied"
    );
  }
  return body as T;
}

/**
 * Creates a same-origin client for the published Identity browser contracts.
 *
 * @param fetcher - Fetch implementation, replaceable by deterministic tests.
 * @returns Typed operations for WebAuthn, passkeys, and sessions.
 * @throws {IdentityApiError} When Identity rejects a request or returns an error status.
 * @remarks Every request uses relative URLs and `credentials: "same-origin"`; callers
 * must supply explicit bearer or CSRF authority only to the operation that needs it.
 */
export function createIdentityApi(fetcher: Fetcher = globalThis.fetch.bind(globalThis)) {
  return {
    /** Requests registration options with either enrollment bearer or session CSRF authority. */
    registrationOptions(authority: { bearer?: string; csrf?: string }) {
      return requestJson<RegistrationOptionsResult>(fetcher, "/v1/webauthn/registration/options", {
        method: "POST",
        headers: {
          ...(authority.bearer ? { authorization: `Bearer ${authority.bearer}` } : {}),
          ...(authority.csrf ? { "x-csrf-token": authority.csrf } : {})
        }
      });
    },
    /** Verifies a completed registration ceremony using the same explicit authority. */
    verifyRegistration(input: {
      bearer?: string;
      csrf?: string;
      challengeId: string;
      label?: string;
      response: RegistrationResponseJSON;
    }) {
      return requestJson<{ accountId: string; credentialId: string }>(
        fetcher,
        "/v1/webauthn/registration/verify",
        {
          method: "POST",
          headers: {
            ...(input.bearer ? { authorization: `Bearer ${input.bearer}` } : {}),
            ...(input.csrf ? { "x-csrf-token": input.csrf } : {})
          },
          body: JSON.stringify({
            challengeId: input.challengeId,
            ...(input.label ? { label: input.label } : {}),
            response: input.response
          })
        }
      );
    },
    /** Requests options for discoverable-passkey authentication. */
    authenticationOptions() {
      return requestJson<AuthenticationOptionsResult>(
        fetcher,
        "/v1/webauthn/authentication/options",
        { method: "POST" }
      );
    },
    /** Verifies authentication and asks Identity to establish its browser cookies. */
    verifyAuthentication(challengeId: string, response: AuthenticationResponseJSON) {
      return requestJson<{ expiresAt: string }>(
        fetcher,
        "/v1/webauthn/authentication/verify",
        { method: "POST", body: JSON.stringify({ challengeId, response }) }
      );
    },
    /** Lists active passkeys from server-owned Identity state. */
    listPasskeys() {
      return requestJson<PasskeyList>(fetcher, "/v1/security/passkeys");
    },
    /** Renames one passkey with the current session-bound CSRF credential. */
    renamePasskey(credentialId: string, label: string, csrf: string) {
      return requestJson<{ id: string; label: string }>(
        fetcher,
        `/v1/security/passkeys/${encodeURIComponent(credentialId)}`,
        {
          method: "PATCH",
          headers: { "x-csrf-token": csrf },
          body: JSON.stringify({ label })
        }
      );
    },
    /** Revokes one passkey with the current session-bound CSRF credential. */
    revokePasskey(credentialId: string, csrf: string) {
      return requestJson<MutationResult>(
        fetcher,
        `/v1/security/passkeys/${encodeURIComponent(credentialId)}`,
        { method: "DELETE", headers: { "x-csrf-token": csrf } }
      );
    },
    /** Lists active sessions from server-owned Identity state. */
    listSessions() {
      return requestJson<SessionList>(fetcher, "/v1/security/sessions");
    },
    /** Revokes one session with the current session-bound CSRF credential. */
    revokeSession(sessionId: string, csrf: string) {
      return requestJson<MutationResult>(
        fetcher,
        `/v1/security/sessions/${encodeURIComponent(sessionId)}`,
        { method: "DELETE", headers: { "x-csrf-token": csrf } }
      );
    }
  };
}

/** Public same-origin Identity client contract returned by {@link createIdentityApi}. */
export type IdentityApi = ReturnType<typeof createIdentityApi>;
