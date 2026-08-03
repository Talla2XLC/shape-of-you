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
and domain authority. The boundary is accepted but not implemented yet.

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

### Accepted protocol boundary

The service uses a replaceable, pinned, standards-focused OAuth/OIDC protocol
library behind project-owned adapters. `oidc-provider` is the initial candidate
subject to a conformance and typed-persistence spike. OAuth state must use
typed relational tables; JSON blobs are not accepted as authoritative
persistence.

The initial profile uses authorization code with S256 PKCE, OIDC discovery, a
predefined ChatGPT public client, short-lived audience-bound JWT access tokens,
hashed rotating refresh credentials, and public JWKS. Open DCR and experimental
CIMD are deferred.

Login is passkey-first through WebAuthn. Accounts can register multiple
passkeys. Single-use recovery codes are stored only as hashes and can authorize
a narrowly scoped replacement-passkey enrollment with session revocation. No
password, email-only, or security-question fallback is allowed.

Initial scopes are `person:read`, `weight:write`,
`body-measurement:write`, `meal:write`, and `workout:write`.

### ChatGPT and MCP

The initial MCP resource server remains inside the API deployable and delegates
to existing application contracts. It publishes protected-resource metadata
and declares OAuth scopes per tool. ChatGPT confirms mutations conversationally;
the API still enforces grants, validation, idempotency, provenance, and audit.
No raw prompt or full conversation is stored.

### Operational separation

The edge/ACME layer owns HTTPS certificate issuance and renewal. Identity owns
OAuth signing keys and their rotation. These key lifecycles are separate.

## Evidence

- Operator selected a project-owned Identity service with vetted, replaceable
  protocol libraries on 2026-08-02.
- Current OpenAI plugin authentication requirements were verified on
  2026-08-02.

## Decisions

- [Identity service ADR](../../adr/20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [User and Person separation](../../adr/20260730-separate-user-access-from-person-data-ownership.md)
- [Service autonomy](../../adr/20260728-deployable-service-autonomy.md)

## Open questions

- Final acceptance of `oidc-provider` after the conformance and persistence
  spike.
- Access-token lifetime, refresh-session lifetime, and signing-key rotation
  intervals.
- Production hostname, certificate automation, secret storage, backup RPO/RTO,
  and security monitoring.

## Related material

- [Architecture overview](overview.md)
- [Data ownership](data-ownership.md)
- [Deployment topology](deployment.md)
- [Stateful infrastructure](stateful-infrastructure.md)
