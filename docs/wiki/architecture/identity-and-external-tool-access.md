---
id: "architecture-identity-and-external-tool-access"
kind: architecture
title: "Identity and external tool access"
status: draft
tags:
  - "authentication"
  - "identity"
  - "mcp"
  - "oauth"
  - "security"
---

# Identity and external tool access

## Summary

The accepted project-owned Identity service centralizes authentication and
OAuth/OIDC for ChatGPT and future clients. The API retains Person authorization
and domain authority. The deployable scaffold and typed account, WebAuthn,
recovery, OAuth protocol, signing-key metadata, and security-audit persistence
exist. Runtime PostgreSQL ownership and database-aware readiness are wired;
the first-passkey bootstrap, passkey registration/login HTTP flow, secure
browser session, exact-Origin validation, and session-bound CSRF defense are
implemented. TOTP emergency recovery and passkey/session management are also
implemented. The OAuth HTTP profile and the API-owned MCP resource server are
implemented. The first staging key/client provisioning, subject binding, and
external OAuth/MCP smoke are complete. Deployment and reprovisioning of the
durable `offline_access` profile plus an external access-token-expiry check
remain operational steps.
The accepted first Nuxt client preserves this exact Identity origin: edge serves
the static browser shell on otherwise unreserved paths, while Identity keeps
ownership of its metadata, OAuth, `/v1/`, and probe routes.
Browser OAuth now defaults to `/day` and restores only a validated same-origin
path and query from the signed API-owned transaction. The static client learns
only whether its API session is active; it never receives session identity or
credential material.

## Content

### Accepted ownership

Identity owns authentication accounts, credentials, consent, OAuth clients,
authorization codes, refresh sessions, signing keys, token issuance, and
authentication audit. It is an independent deployable with its own PostgreSQL
database and operations lifecycle.

The API owns its local User authorization principal, issuer/subject mapping,
PersonAccessGrant, fitness data, and domain policy. A token never authorizes a
Person solely because it contains a subject or a client supplied a Person id.
Cross-service SQL and shared credentials remain forbidden.

Identity requires its own `DATABASE_URL` at process startup and owns its
bounded PostgreSQL pool. `GET /live` remains process-only; `GET /ready` executes
`select 1` and returns stable `503` JSON without exposing database errors.
Migrations remain an explicit one-shot command and never run during normal
server startup.

### Accepted protocol boundary

The service uses pinned `oidc-provider` 9.11.1 behind a project-owned, strict
protocol adapter. The accepted adapter supports only the enabled protocol
profile and translates provider state into typed relational tables. Unknown
payload fields fail compatibility tests. OAuth state does not use JSON blobs.

Identity state is organized by lifecycle rather than a generic provider
artifact table. The immutable account UUID is the public OAuth `sub`; the
separate account `subject` value is an account-local WebAuthn username, not a
second OAuth identifier. Passkeys,
hashed challenges, recovery-code batches, grants, sessions, interactions,
hashed authorization codes, and refresh-token families have dedicated typed
tables. Small immutable protocol snapshots may use constrained PostgreSQL
arrays. JWT access tokens remain stateless.

The generated Identity migration chain now includes administrator-provisioned
clients with exact redirect and scope allowlists, consent grants, hashed
browser sessions, client authorizations, fixed-column interactions, hashed
authorization codes bound to S256 PKCE, and rotating refresh-token families.
Requested interaction scopes/resources use typed child rows; issued scope and
AMR snapshots use constrained PostgreSQL arrays. Signing-key rows contain only
public SPKI material, lifecycle metadata, and an opaque secret-provider handle;
private key bytes remain outside PostgreSQL. Security events use controlled
types and outcomes, typed account/client/session/key references, correlation
ids, and fixed privacy-preserving source hashes without a generic details
payload.

The initial profile uses authorization code with S256 PKCE, OIDC discovery, a
predefined ChatGPT public client, ten-minute audience-bound ES256 JWT access
tokens, hashed rotating refresh credentials, and public JWKS. Durable clients
must request the allowlisted OIDC `offline_access` scope and have refresh-token
issuance enabled. Protocol scopes remain separate from resource permissions;
MCP access tokens contain only the approved resource scopes. Open DCR and CIMD
are deferred for the first single-operator connection.

The Identity release owns a typed, versioned manifest for reserved predefined
client IDs, display names, refresh-token capability, and exact scope
allowlists. Environment configuration owns the exact external callback.
Deployment applies that split authority through a one-shot transactional
reconcile after Identity migrations; ordinary runtime startup performs no
client writes, and the general operator command cannot manage reserved IDs.

Local development and staging supply private ES256 keys through a versioned
runtime secret key ring. PostgreSQL stores only public SPKI material, lifecycle
metadata, and an opaque handle. Key rotation publishes an overlap key before
changing the active signer. Production remains blocked on a separate Vault/KMS
decision.

Login is passkey-first through WebAuthn, initially implemented with pinned
`@simplewebauthn/server` 13.3.2 behind a project-owned adapter. Accounts can
register multiple passkeys. Emergency recovery uses an optional TOTP factor
from an RFC 6238-compatible authenticator application. It authorizes only a
narrow replacement-passkey enrollment and then revokes existing sessions. No
password, email-only, SMS, or security-question fallback is allowed. Existing
recovery-code tables are retained but are not part of the initial product flow.

Discoverable credentials require user verification and use attestation `none`.
Hashed single-use challenges expire after at most five minutes. Signature
counters are retained as secondary risk and audit evidence rather than a hard
failure condition for synchronized passkeys.

Browser/OAuth sessions use a 30-day sliding inactivity deadline with no
absolute maximum lifetime. Successful browser-session use or refresh-token
rotation extends the deadline; ordinary resource requests using a short-lived
JWT do not contact Identity and do not count as session activity. A session is
bound to the passkey that established it. Users can list, rename, and revoke
passkeys and can list and revoke sessions. Revoking a passkey revokes its
sessions and refresh families; recovery revokes existing sessions. The final
usable authentication method cannot be removed without another active passkey
or valid recovery path.

The first passkey is provisioned through an operator-only CLI that creates an
account and a hashed, single-use enrollment token valid for 15 minutes. It does
not enable public self-registration or require manual SQL. Additional passkeys
require an active session.

TOTP recovery requires a unique normalized login handle. The seed is shown
once as an authenticator QR setup URI and persisted only as AES-256-GCM
ciphertext with an external key identifier. Six-digit, 30-second codes accept
one adjacent time step, reject replay, and are persistently throttled. A valid
code creates a hashed 15-minute recovery authority bound to one WebAuthn
recovery challenge. Completing replacement enrollment revokes all existing
sessions and refresh families but leaves passkeys for explicit user review.

Every browser POST must carry the exact configured Identity `Origin`.
Cookie-authenticated mutations additionally require a session-bound
`X-CSRF-Token`; only its SHA-256 hash is persisted and comparison is constant-
time. The browser session uses a `__Host-`, Secure, HttpOnly, SameSite=Lax
cookie without a Domain attribute. Public login and initial enrollment use
exact Origin plus single-use WebAuthn challenge/token authority rather than an
ambient-cookie CSRF token.

The raw CSRF token is also available to same-origin browser code through a
separate Secure, SameSite=Lax, non-HttpOnly host-only cookie. This lets a newly
opened OAuth consent page reuse the active session; the database still stores
only its hash and the authentication credential remains HttpOnly.

Identity also owns the minimal same-origin browser page required for OAuth
login and consent. It reuses the passkey session and CSRF contract, renders only
validated client/scope information, and completes the provider interaction.
The general product UI and visual design remain outside Identity.

The first general browser UI is an edge-served static Nuxt client. Enrollment,
sign-in, and security-management pages run only on the configured exact
Identity origin and call relative `/v1/...` routes, so no CORS policy or cookie,
CSRF, issuer, origin, or WebAuthn RP migration is introduced. The initial
enrollment bearer is accepted only from a URL fragment, removed before the
first request, held only in tab memory, and sent only in the Authorization
header. TOTP/recovery UI and replacement of the narrow Identity-owned OAuth
interaction page remain outside the first frontend release.

For product API calls, the browser starts a top-level Authorization Code + S256
PKCE navigation at the API. The API exchanges the code server-side, validates
the Identity token and resolves one API-owned Person grant, then sets its own
short-lived host-only session and CSRF cookies. Relative `/api/...` reads use
that API session; writes also require the exact API Origin and matching CSRF
header. The static Web client never receives access or refresh tokens. MCP
continues to use its separate bearer-token contract.

Protected Web routes pass only their path and query to the API sign-in route.
The API rejects external, protocol-relative, backslash, fragment, control-
character, and oversized return targets, then stores the accepted route inside
the signed, short-lived, HttpOnly OAuth transaction cookie with state and PKCE.
The callback ignores any return target in its own query and redirects only from
the verified transaction; absent, invalid, expired, or legacy route state falls
back to `/day`.

`GET /browser-auth/session` reuses the API session verifier and returns an empty,
non-cacheable `204` or `401` without Person, subject, role, expiry, token, or
cookie details. The static client uses that boolean-equivalent result for its
landing action and reusable protected-route middleware. Missing or expired
authority starts top-level OAuth and returns to the original path and query;
the client does not retain authentication or return state in browser storage.

OAuth interaction correlation and resume targets are stored as narrow typed
columns. Authorization resume explicitly binds the interaction's authenticated
passkey session to the provider Session UID; Identity does not create duplicate
browser and protocol session aggregates or guess the newest account session.
The passkey and provider cookie credentials are stored as separate hashes on
that one session row. Rotating the provider cookie replaces only its hash and
does not revoke the passkey session; explicit session revocation remains the
shared lifecycle boundary.

The initial protocol scopes are `openid` and `offline_access`. Resource scopes
are `person:read`, `weight:write`, `body-measurement:write`, `meal:write`, and
`workout:write`.

### ChatGPT and MCP

The initial MCP resource server is a stateless Streamable HTTP module inside
the API deployable. Its internal endpoint is `/mcp`; staging exposes it as
`https://staging.shape-of-you.ru/api/mcp`. The API publishes OAuth
protected-resource metadata, advertises per-tool security schemes, and returns
standards-complete OAuth challenges.

Eight allowlisted tools list or record weight measurements, body measurement
sessions, meals, and workout sessions. Reads require `person:read`; each write
uses its domain-specific scope. Tools delegate to existing application
contracts, so validation, idempotency, provenance, correction policy, and
audit remain domain responsibilities rather than MCP-specific logic.

Every tool call verifies the ES256 signature through Identity JWKS and checks
the exact issuer, audience/resource, expiry, and required scope. The API then
resolves an exact `(issuer, subject)` mapping to an active local User and an
unambiguous active Person grant. Writes require `owner` or `editor`; `viewer`
cannot mutate. Authenticated MCP execution always uses request-scoped Person
context and never falls back to the synthetic compatibility context.

ChatGPT confirms mutations conversationally before invoking a write tool; this
is a client interaction policy, not a replacement for API authorization. No
raw prompt or full conversation is stored.

### Operational separation

The edge/ACME layer owns HTTPS certificate issuance and renewal. Staging uses
`https://identity.staging.shape-of-you.ru` as both the Identity origin and its
WebAuthn RP ID. Identity owns OAuth signing keys and their rotation. These key
lifecycles are separate. Staging transports the TOTP key-ring identifier and
encrypted key-ring secret into the root-owned Identity runtime environment and
validates the key ring before migrations or service replacement.
The same root-owned handoff transports the active OAuth signing-key identifier,
the external signing-key ring, and provider cookie keys. The API receives only
public trust configuration: Identity issuer, JWKS URI, and its own resource
identifier. OAuth signing keys and TLS certificate keys never share storage or
lifecycle.

## Evidence

- Operator selected a project-owned Identity service with vetted, replaceable
  protocol libraries on 2026-08-02.
- An isolated Node.js 24 protocol and persistence-shape spike passed on
  2026-08-03; the operator accepted `oidc-provider` and SimpleWebAuthn.
- Current OpenAI plugin authentication requirements were re-verified on
  2026-08-07 during independent quality review.
- TASK-0041 browser acceptance completed real WebAuthn and OAuth, authenticated
  landing revisit, API-session loss, reconnect, and protected path-and-query
  restoration on 2026-08-17.

## Decisions

- [Identity service ADR](../../adr/20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [User and Person separation](../../adr/20260730-separate-user-access-from-person-data-ownership.md)
- [Service autonomy](../../adr/20260728-deployable-service-autonomy.md)
- [Identity relational model](../../adr/20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)
- [Passkey-bound sliding sessions](../../adr/20260806-use-passkey-bound-sliding-identity-sessions.md)
- [Initial passkey bootstrap and CSRF](../../adr/20260806-bootstrap-first-passkey-and-require-origin-csrf-defense.md)
- [TOTP emergency recovery](../../adr/20260806-use-totp-for-emergency-passkey-recovery.md)
- [Shared Host/SNI ingress](../../adr/20260805-route-shared-vm-ingress-by-host-and-sni.md)
- [Static Nuxt edge delivery](../../adr/20260807-serve-static-nuxt-client-through-existing-edge.md)
- [API-owned browser sessions](../../adr/20260812-use-api-owned-browser-session-cookies.md)
- [Same-origin browser return routes](../../adr/20260817-preserve-same-origin-browser-return-routes-through-oauth.md)
- [Durable OAuth connections](../../adr/20260810-require-offline-access-for-durable-oauth-connections.md)

## Open questions

- Signing-key overlap and rotation intervals.
- Production hostname, secret storage, backup RPO/RTO, and security monitoring.
- End-to-end OpenID/OAuth conformance results for the implemented HTTP and
  interaction flow before production use.

## Related material

- [Architecture overview](overview.md)
- [Data ownership](data-ownership.md)
- [Deployment topology](deployment.md)
- [Stateful infrastructure](stateful-infrastructure.md)
