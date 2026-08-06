---
id: "decisions-20260806-bootstrap-first-passkey-and-require-origin-csrf-defense"
kind: adr
title: "Bootstrap the first passkey and require Origin and CSRF defenses"
status: accepted
date: 2026-08-06
supersedes: []
superseded_by: null
tags:
  - "authentication"
  - "csrf"
  - "identity"
  - "security"
  - "webauthn"
---

# Bootstrap the first passkey and require Origin and CSRF defenses

## Context

Passkey login cannot authorize registration of an account's first passkey.
Allowing anonymous self-registration would expose a public account-creation
surface that is outside the current single-operator scope. Manual SQL would be
non-reproducible and cannot safely construct a WebAuthn credential.

After login, Identity uses a browser session cookie. `SameSite=Lax` reduces
cross-site requests but is not a complete CSRF control, particularly as future
browser clients and endpoint shapes evolve. Registration of additional
passkeys and later credential/session management are security-sensitive cookie-
authenticated mutations.

## Decision

Provide an operator-only CLI that atomically creates an Identity account and a
15-minute, single-use initial-passkey enrollment. The enrollment bearer token
has at least 256 bits of entropy. PostgreSQL stores only its SHA-256 hash. The
CLI delivers plaintext once to the controlling terminal and refuses to expose
it through structured logs. It never edits the database manually or creates a
credential on the user's behalf.

The first-passkey registration endpoints accept that bearer token. Successful
verification consumes the enrollment in the same transaction that persists
the passkey. Expired, consumed, invalidated, disabled-account, or mismatched
enrollments fail closed. Additional passkeys require an active browser session.
Public self-registration and an administrative HTTP API are not enabled.

Every browser `POST` requires an exact match between its `Origin` header and
the configured Identity public origin. Missing, opaque, or mismatched origins
are rejected. This applies to public WebAuthn login and initial enrollment as
well as authenticated mutations.

Identity browser sessions use a `__Host-` cookie with `Secure`, `HttpOnly`,
`SameSite=Lax`, and `Path=/`, without `Domain`. Every cookie-authenticated
mutation also requires an `X-CSRF-Token` value bound to that session. Only the
SHA-256 hash is stored, and verification uses constant-time comparison. The
plaintext token is returned only when the session is created or through a
same-origin session-bootstrap response; it is never placed in the session
cookie, URL, logs, or persistence.

Public authentication and initial enrollment do not rely on an existing
ambient cookie and therefore do not require the session CSRF token. They are
protected by exact Origin validation, WebAuthn RP ID/origin verification, and
single-use five-minute challenges; initial enrollment additionally requires
the single-use bootstrap bearer.

## Considered alternatives

- **Public self-registration:** simplest onboarding, but creates uncontrolled
  accounts and a new abuse surface. Rejected for the current product scope.
- **Administrative HTTP API:** supports remote provisioning, but first requires
  another administrator authentication and authorization boundary. Deferred.
- **Manual database seeding:** avoids an endpoint, but is not reproducible and
  cannot create a user-held passkey safely. Rejected.
- **Reuse recovery codes for first enrollment:** avoids another table, but
  conflates account bootstrap with post-enrollment recovery and creates a
  circular issuance model. Rejected.
- **Rely only on `SameSite=Lax`:** reduces common CSRF attacks but does not bind
  a mutation to a session-held nonce and is sensitive to browser and endpoint
  behavior. Rejected.
- **Double-submit cookie without server binding:** avoids a database column but
  provides weaker session attribution. Rejected for security mutations.

## Consequences

- Initial account creation is reproducible application behavior but remains an
  explicit operator action until public onboarding is separately approved.
- Operators must run the bootstrap CLI interactively and protect the one-time
  token during its 15-minute lifetime.
- Session persistence gains a CSRF-token hash. Legacy sessions without one are
  revoked during migration instead of being silently upgraded with an unknown
  plaintext token.
- Browser clients must send exact Origin and, for cookie-authenticated
  mutations, `X-CSRF-Token`.
- XSS remains able to act as the user; CSRF defenses do not replace output
  encoding, CSP, dependency review, or session revocation.

## Verification

- Migration tests cover token hashing, expiry, one-time consumption, account
  binding, CSRF hash length, and safe legacy-session revocation.
- HTTP tests reject missing/wrong Origin and missing/wrong CSRF tokens.
- Registration tests distinguish bootstrap and active-session authority and
  reject replay, expiry, disabled accounts, and account mismatch.
- Cookie tests verify every required attribute and absence of `Domain`.
- Logging tests confirm that bootstrap, session, CSRF, and challenge plaintext
  are not emitted through structured logs.

## Related material

- [Identity service and protocol libraries](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Identity relational model](20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)
- [Passkey-bound sliding sessions](20260806-use-passkey-bound-sliding-identity-sessions.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
