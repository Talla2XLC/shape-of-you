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
authentication and OAuth HTTP flows are not implemented yet.

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
artifact table. Accounts have a distinct immutable public subject. Passkeys,
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
predefined ChatGPT public client, short-lived audience-bound JWT access tokens,
hashed rotating refresh credentials, and public JWKS. Open DCR and experimental
CIMD are deferred.

Login is passkey-first through WebAuthn, initially implemented with pinned
`@simplewebauthn/server` 13.3.2 behind a project-owned adapter. Accounts can
register multiple passkeys. Single-use recovery codes are stored only as
hashes and can authorize a narrowly scoped replacement-passkey enrollment with
session revocation. No password, email-only, or security-question fallback is
allowed.

Initial scopes are `person:read`, `weight:write`,
`body-measurement:write`, `meal:write`, and `workout:write`.

### ChatGPT and MCP

The initial MCP resource server remains inside the API deployable and delegates
to existing application contracts. It publishes protected-resource metadata
and declares OAuth scopes per tool. ChatGPT confirms mutations conversationally;
the API still enforces grants, validation, idempotency, provenance, and audit.
No raw prompt or full conversation is stored.

### Operational separation

The edge/ACME layer owns HTTPS certificate issuance and renewal. Staging uses
`https://identity.staging.shape-of-you.ru` as both the Identity origin and its
WebAuthn RP ID. Identity owns OAuth signing keys and their rotation. These key
lifecycles are separate.

## Evidence

- Operator selected a project-owned Identity service with vetted, replaceable
  protocol libraries on 2026-08-02.
- An isolated Node.js 24 protocol and persistence-shape spike passed on
  2026-08-03; the operator accepted `oidc-provider` and SimpleWebAuthn.
- Current OpenAI plugin authentication requirements were verified on
  2026-08-02.

## Decisions

- [Identity service ADR](../../adr/20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [User and Person separation](../../adr/20260730-separate-user-access-from-person-data-ownership.md)
- [Service autonomy](../../adr/20260728-deployable-service-autonomy.md)
- [Identity relational model](../../adr/20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)
- [Shared Host/SNI ingress](../../adr/20260805-route-shared-vm-ingress-by-host-and-sni.md)

## Open questions

- Access-token lifetime, refresh-session lifetime, and signing-key rotation
  intervals.
- Production hostname, secret storage, backup RPO/RTO, and security monitoring.
- End-to-end OpenID/OAuth conformance results for the implemented HTTP and
  interaction flow before production use.

## Related material

- [Architecture overview](overview.md)
- [Data ownership](data-ownership.md)
- [Deployment topology](deployment.md)
- [Stateful infrastructure](stateful-infrastructure.md)
