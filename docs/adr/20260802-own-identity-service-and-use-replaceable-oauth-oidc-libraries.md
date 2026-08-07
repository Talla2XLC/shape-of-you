---
id: "decisions-20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries"
kind: adr
title: "Own the Identity service and isolate replaceable OAuth/OIDC protocol libraries"
status: accepted
date: 2026-08-02
supersedes: ["decisions-20260729-store-revocable-auth-sessions-in-postgresql"]
superseded_by: null
tags:
  - "authentication"
  - "identity"
  - "mcp"
  - "oauth"
  - "openid-connect"
  - "security"
  - "service-boundaries"
---

# Own the Identity service and isolate replaceable OAuth/OIDC protocol libraries

## Context

Shape of You needs one authentication and authorization-server boundary for
ChatGPT tool access and future web, mobile, and service clients. The initial
ChatGPT integration reads Person data and writes weight measurements, body
measurement sessions, meals, and workout sessions after explicit
conversational confirmation. Domain APIs remain the authority; no LLM is
embedded in the backend.

The current API owns placeholder `User` rows, `PersonAccessGrant`, and the
accepted PostgreSQL refresh-session design. It does not implement login,
OAuth/OIDC, consent, client registration, token issuance, or signing-key
lifecycle. Keeping those responsibilities in every resource service would
duplicate a security-critical protocol and prevent a shared identity space.

OpenAI requires authenticated MCP servers to use an OAuth 2.1-compatible
authorization-code flow with S256 PKCE, protected-resource metadata,
authorization-server discovery, resource/audience binding, and per-tool scope
enforcement. OpenAI supports predefined clients, Client ID Metadata Documents
(CIMD), and Dynamic Client Registration (DCR). The initial single-operator
connection does not justify an open dynamic-registration surface.

The project must own its identity data and public contracts without
reimplementing standardized cryptographic and OAuth/OIDC machinery. Protocol
dependencies must remain replaceable. OAuth state must not become an opaque
JSON persistence model.

## Decision

Create an independently deployable `Identity` service in the modular monorepo.
It owns:

- authentication accounts and their status;
- login credentials and recovery factors;
- consent grants and registered OAuth clients;
- authorization codes, refresh-session families, revocation, and reuse
  detection;
- issuer metadata, signing-key publication, and token issuance;
- authentication and security audit events.

It does not own `Person`, `PersonAccessGrant`, fitness data, domain roles, or
domain mutation policy. The API continues to own its local `User` authorization
principal and maps it uniquely to `(issuer, subject)`. A valid token identifies
a User but never grants access to a Person by itself. Every domain request
still requires an active API-owned `PersonAccessGrant` with a sufficient role.

The Identity service has its own `Dockerfile`, `package.json`, `AGENTS.md`,
PostgreSQL database, credentials, Drizzle schema, migrations, backup/restore
procedure, and integration tests. The API and Identity service communicate
only through OAuth/OIDC HTTP contracts and published metadata/JWKS. Cross-
service SQL and shared credentials are forbidden.

Use a standards-focused OAuth/OIDC authorization-server library behind a
project-owned protocol adapter. Do not implement cryptographic primitives,
token parsing, PKCE verification, or OAuth/OIDC protocol state machines from
scratch. Pin the dependency version, review its release and security policy,
generate an SBOM, run conformance tests, and retain a documented fork/replace
exit path.

Use pinned `oidc-provider` 9.11.1 for the initial authorization-server
implementation. An isolated Node.js 24 spike verified discovery,
Authorization Code and refresh-token grants, mandatory S256 PKCE, resource
indicators, and signed audience-bound JWT access tokens. JWT access tokens do
not require persistence. The provider adapter is implemented as a strict,
model-specific translation into typed relational tables: grant resources,
session client authorizations, and interaction state use dedicated rows or
columns rather than JSON blobs. Unsupported provider models and features stay
disabled, and compatibility tests fail closed on unknown adapter payload
fields.

Use pinned `@simplewebauthn/server` 13.3.2 behind a project-owned WebAuthn
adapter. The spike verified Node.js 24 option generation for discoverable
credentials with required user verification. The adapter owns origin and RP
ID policy, challenge lifecycle, credential persistence, counter handling, and
the replaceability seam; application code does not depend directly on library
response shapes.

Initial protocol profile:

- OAuth authorization code with mandatory S256 PKCE;
- OIDC discovery and a stable issuer;
- an administrator-provisioned ChatGPT public client with exact redirect URI
  allowlisting and token endpoint authentication method `none`;
- no implicit grant, resource-owner password grant, client credentials for the
  ChatGPT user flow, open DCR, or experimental CIMD in the first release;
- ten-minute, ES256-signed, audience-bound JWT access tokens with no sensitive
  Person data;
- opaque authorization codes and rotating refresh credentials stored only as
  hashes in typed PostgreSQL tables;
- public JWKS with planned key overlap and rotation;
- scopes `person:read`, `weight:write`, `body-measurement:write`, `meal:write`,
  and `workout:write`;
- exact issuer, audience/resource, lifetime, and scope validation at every
  resource server.

For local development and staging, private ES256 signing keys enter Identity
through a versioned secret key ring in the runtime environment. PostgreSQL
stores only public SPKI material, lifecycle metadata, and an opaque key-ring
handle. Rotation publishes the next public key before switching the active
signer and retains the previous public key for a bounded verification overlap.
Production use remains blocked until a separate decision selects and operates
a Vault/KMS-grade private-key provider.

The initial single-operator ChatGPT connection continues to use the predefined
public client. CIMD is now the preferred OpenAI registration method for broader
connector fleets, but adopting it would add remote metadata retrieval,
validation, and SSRF controls that are not justified for this first connection.
DCR remains deferred for the same reason.

Identity serves the minimal first-party browser surface required to complete
OAuth login and consent on the Identity origin. It reuses the existing passkey
session and session-bound CSRF authority, displays the validated client and
requested scopes, and submits the explicit decision to the provider
interaction. This security-critical protocol UI does not make Identity the
owner of the general product frontend. Moving it into a future Nuxt frontend
would add cross-origin cookie, CORS, and deployable-availability coupling and
requires another accepted decision.

The provider interaction persists its opaque `cid` and exact `returnTo` in
dedicated typed columns. On authorization resume, the project adapter binds the
exact passkey session authenticated for that interaction to the provider
Session UID and stores only a separate hash of the provider cookie credential
on that same session row. It must not create a second browser-session aggregate
or infer a session by account and recency.

The raw session-bound CSRF token may be held in a separate Secure,
SameSite=Lax, non-HttpOnly host-only cookie so a new same-origin OAuth consent
page can reuse an active session. PostgreSQL still stores only its SHA-256 hash;
the authentication session credential remains in a separate HttpOnly cookie.

The initial MCP resource server remains a module of `apps/api` and delegates
to existing application contracts. It publishes protected-resource metadata
and per-tool OAuth scopes, but it does not create a parallel command model or
generic JSON envelope. Extraction into a separate deployable requires a
measured scaling, isolation, or ownership driver and another ADR.

ChatGPT obtains explicit user confirmation before invoking a mutating tool.
The API cannot treat conversational confirmation as a cryptographic fact; it
still enforces authorization, validation, idempotency, provenance, and audit.
Raw prompts, tokens, credentials, and full conversation text are not logged or
stored.

TLS certificate issuance and renewal remain an edge/ACME responsibility.
Identity owns token-signing keys, not HTTPS certificate lifecycle.

Use passkey-first authentication through WebAuthn. An account can register
multiple passkeys. Initial enrollment produces single-use recovery codes that
are stored only as hashes. A recovery code can start a tightly scoped,
auditable flow to register a replacement passkey and revoke affected sessions.
There is no password fallback, email-only recovery, or security-question
recovery. The exact WebAuthn library remains replaceable. Challenge, counter,
attestation, passkey-management, and sliding session policies are defined by
the dedicated passkey-session ADR.

## Considered alternatives

- **Managed external IdP:** lowest implementation effort and strong operational
  support, but makes availability, pricing, data handling, and protocol
  customization dependent on a vendor. Rejected for the selected ownership
  goal.
- **Self-hosted full IdP product such as Keycloak or ZITADEL:** avoids SaaS and
  provides broad features, but makes Shape of You depend on another product's
  schema, runtime, upgrades, and administration model. Rejected in favor of a
  smaller owned service.
- **Owned service with a replaceable certified protocol library:** preserves
  domain, data, UX, and operational ownership while delegating standardized
  protocol machinery. Selected.
- **OAuth/OIDC and cryptography implemented from scratch:** maximizes source
  ownership but creates a permanent security and conformance burden unrelated
  to the fitness domain. Rejected.
- **Password-first login with later MFA:** familiar but creates password reset,
  credential-stuffing, breach-monitoring, and additional secret-handling
  obligations. Rejected in favor of passkeys.
- **Passkeys with password or email fallback:** improves apparent recovery but
  makes the weaker factor the effective security boundary. Rejected. Recovery
  uses hashed one-time codes and replacement-passkey enrollment instead.
- **Keep authorization-server behavior inside `apps/api`:** initially fewer
  deployables, but couples reusable identity state to one resource service and
  conflicts with the intended shared identity space. Rejected.
- **Separate MCP deployable immediately:** creates an additional deployment and
  service-to-service contract without an independent scaling or ownership
  driver. Rejected for the initial integration.
- **Opaque access tokens with mandatory introspection:** provides immediate
  centralized revocation but makes every resource request depend on Identity.
  Deferred; short-lived JWTs plus API-owned Person-grant checks provide the
  initial balance.
- **Open DCR or experimental CIMD initially:** reduces manual client setup but
  expands registration and remote-metadata attack surfaces. Deferred until a
  multi-connection requirement and stable library support exist.

## Consequences

- Identity becomes the second backend deployable and a security-critical
  stateful service with independent delivery and recovery obligations.
- The earlier PostgreSQL session decision is superseded only in ownership:
  typed hashed refresh sessions move from the API database to the Identity
  database while rotation, reuse detection, revocation, and audit remain.
- API `User` remains a local authorization principal. Mapping by issuer and
  subject avoids sharing Identity primary keys or database constraints.
- Signing-key compromise, library abandonment, and discovery/JWKS outages need
  explicit runbooks, monitoring, and tested rotation/replacement procedures.
- Short-lived JWT revocation is bounded by access-token lifetime. Person access
  revocation remains immediate because the API checks its own active grant on
  every domain operation.
- A predefined ChatGPT client requires operator-managed callback registration.
  CIMD or DCR can be introduced later without changing domain services.
- No real Person data or production credential is exposed before HTTPS,
  authentication, grant mapping, audit, backup/restore, and security review
  gates pass.
- Users must protect more than one passkey or their recovery codes. Losing all
  factors does not silently downgrade authentication to email or password.
- The typed `oidc-provider` adapter deliberately supports only the enabled
  protocol profile. Library upgrades require adapter compatibility tests and a
  schema review before the version pin changes.
- End-to-end conformance testing requires the implemented HTTP authorization
  and interaction flow. It remains a mandatory pre-production gate rather than
  a pre-scaffold spike activity.

## Verification

- OpenID/OAuth conformance tests cover the selected profile and metadata.
- Integration tests cover S256 PKCE, exact redirect matching, code one-time
  use, resource/audience binding, scope denial, refresh rotation/reuse,
  expiration, revocation, and signing-key overlap.
- WebAuthn tests cover RP ID/origin binding, single-use challenges, duplicate
  credentials, counters where available, multiple passkeys, recovery-code
  hashing/consumption, replacement enrollment, and session revocation.
- Persistence tests prove that credentials are hashed and OAuth state uses
  typed relational columns rather than JSON blobs.
- API integration tests reject unknown issuer/subject mappings, wrong audience,
  missing scopes, inactive Users, and missing/revoked Person grants.
- MCP contract tests verify protected-resource metadata, per-tool scopes,
  authentication challenges, allowlisted tools, and idempotent retries.
- Dependency review records the pinned protocol-library version, license,
  security policy, maintainer risk, SBOM, and replacement seam.
- Security review covers login/recovery, consent, SSRF, redirect handling,
  token leakage, logging, rate limits, key storage/rotation, and incident
  response before real-data access.

## Related material

- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
- [OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- [oidc-provider](https://github.com/panva/node-oidc-provider)
- [SimpleWebAuthn](https://simplewebauthn.dev/docs/packages/server)
- [Revocable authentication sessions](20260729-store-revocable-auth-sessions-in-postgresql.md)
- [User and Person separation](20260730-separate-user-access-from-person-data-ownership.md)
- [Deployable service autonomy](20260728-deployable-service-autonomy.md)
- [Cross-service communication](20260728-api-or-event-only-cross-service-communication.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [Passkey-bound sliding sessions](20260806-use-passkey-bound-sliding-identity-sessions.md)
