---
id: "decisions-20260803-model-identity-protocol-state-in-typed-lifecycle-tables"
kind: adr
title: "Model Identity protocol state in typed lifecycle tables"
status: accepted
date: 2026-08-03
supersedes: []
superseded_by: null
tags:
  - "authentication"
  - "identity"
  - "oauth"
  - "postgresql"
  - "security"
  - "webauthn"
---

# Model Identity protocol state in typed lifecycle tables

## Context

The accepted Identity service needs durable account, WebAuthn, recovery, OAuth,
signing-key, and security-audit state. Its protocol libraries expose different
adapter models with some nested values. A generic serialized payload would be
easy to persist but would make library internals the effective database model,
weaken constraints, obscure credential lifecycle, and conflict with the
project rule against JSON persistence.

An isolated `oidc-provider` 9.11.1 spike showed that JWT access tokens are
stateless. Authorization codes and refresh tokens have predominantly flat
payloads. Grants, sessions, and interactions contain small nested collections
that can be reconstructed from typed rows and columns. The design must remain
strict enough to detect library payload changes while avoiding needless tables
for immutable protocol snapshots.

## Decision

Use dedicated PostgreSQL lifecycle tables with narrow SQL-native columns. Do
not create a generic `oauth_artifacts` table and do not persist JSON. Use child
tables when a value has independent identity, cardinality, revocation, or
query behavior. Small immutable protocol snapshots may use constrained
PostgreSQL arrays, initially only issued scope sets, authentication-method
references (`amr`), and WebAuthn transports.

The project-owned provider adapters translate between library payloads and the
relational model. Each adapter allowlists supported fields and models. An
unknown field or model fails closed in compatibility tests and at runtime; it
is never silently discarded or serialized as a fallback.

### Account and WebAuthn foundation

- `identity_accounts` owns the internal UUID, a distinct immutable public
  `subject`, a stable binary WebAuthn user handle, display name, status, and
  timestamps. The public subject is not a foreign key into another service.
- `webauthn_credentials` owns the binary credential ID, COSE public key,
  signature counter, device type, backup state, transports, user label, and
  use/revocation timestamps. Credential IDs are globally unique. An account is
  disabled or credentials are revoked; authentication history is not hard
  deleted as an operational shortcut.
- `webauthn_challenges` stores only a SHA-256 hash of a cryptographically random
  challenge, its purpose, optional account, expected RP ID and origin, user-
  verification policy, expiry, and consumption time. Registration and recovery
  registration challenges require an account. Challenges are single-use.
- `recovery_code_batches` groups issuance, expiry, and invalidation. Each
  `recovery_code` stores only the SHA-256 hash of an independently random code
  with at least 128 bits of entropy plus its single-use state.
- `passkey_recovery_sessions` binds exactly one consumed recovery code to a
  short-lived, hashed, single-purpose enrollment credential. Completion
  registers a replacement passkey and triggers session revocation in the same
  application transaction boundary.

### OAuth protocol state

- `oauth_clients`, `oauth_client_redirect_uris`, and
  `oauth_client_allowed_scopes` own administrator-provisioned clients and exact
  allowlists. The initial ChatGPT client is public and permits only
  authorization code plus refresh token behavior.
- `oauth_grants` is the consent aggregate. OIDC scopes and resource-specific
  scopes use typed child rows; there is no duplicate consent aggregate.
- `oauth_sessions` stores only a hash of the browser session credential plus
  the provider UID, account, authentication time, ACR, AMR snapshot, expiry,
  and revocation. `oauth_session_authorizations` maps a session and client to
  its active grant.
- `oauth_interactions` contains the fixed request and prompt columns required
  by the enabled authorization-code profile. It references relational session
  and grant state instead of embedding their payloads.
- `oauth_authorization_codes` stores only a hash of the opaque code, exact
  client and redirect binding, S256 challenge, account/session/grant binding,
  resource, issued scope snapshot, expiry, and consumption.
- `oauth_refresh_token_families` owns family revocation and reuse status.
  `oauth_refresh_tokens` stores only a hash of each opaque token, its family,
  generation, grant/session/client binding, issued scope snapshot, expiry,
  consumption, and replacement relationship. A consumed token presented again
  revokes the family.
- Signed audience-bound JWT access tokens remain stateless and are not stored.

### Signing keys and security audit

- `oauth_signing_keys` stores key identity, algorithm, public SPKI bytes,
  lifecycle timestamps and status, and an opaque approved-secret-provider
  handle. It does not store private key bytes or a JSON JWK. JWKS is derived
  from public key material.
- `identity_security_events` uses typed event, outcome, actor, client, session,
  correlation, and privacy-preserving source columns. It has no generic JSON
  details field. A new event shape that needs durable structured data requires
  explicit typed columns or a separately designed child table.

All UUIDs and bearer values are generated by application cryptographic APIs,
not database extensions. Bearer authorization codes, refresh tokens, browser
session credentials, challenges, recovery codes, and recovery-session tokens
are never stored in plaintext. Timestamps use `timestamptz`. Foreign keys never
cross the Identity database boundary.

Implement the model through three reproducible migration increments:

1. accounts, WebAuthn credentials/challenges, recovery codes, and passkey
   recovery sessions;
2. OAuth clients, grants, sessions, interactions, authorization codes, and
   refresh-token families;
3. signing-key metadata and typed security audit.

## Considered alternatives

- **One generic typed OAuth artifact table:** fewer tables, but unrelated
  nullable columns, weak subtype constraints, broad upgrade coupling, and poor
  lifecycle clarity. Rejected.
- **A separate table for every nested value:** maximizes normalization but
  creates excessive joins for immutable protocol snapshots such as AMR and
  issued scopes. Rejected in favor of constrained SQL-native arrays for those
  narrow cases.
- **Generic JSON payloads per provider model:** follows the library's memory
  adapter shape and makes upgrades superficially easy, but hides schema drift
  and violates the accepted persistence rule. Rejected.
- **Store opaque access tokens and introspect every API request:** centralizes
  access-token state but adds a synchronous Identity dependency to each domain
  request. Deferred by the parent Identity ADR.
- **Expose the account primary key as OIDC subject:** removes one column but
  couples a public security identifier to internal persistence identity.
  Rejected.

## Consequences

- The schema contains more tables and adapter code than generic payload
  persistence, but lifecycle and security invariants are visible and testable.
- Provider upgrades require an explicit compatibility fixture update and may
  require a migration before the dependency pin changes.
- Scope snapshots intentionally duplicate the exact authority issued to an
  artifact. They are historical security evidence, not shared reference data
  that should be deduplicated.
- The separate public subject permits internal key changes and future pairwise
  subject support without changing existing API mappings.
- Recovery codes must be generated with sufficient entropy because their
  hashes are intentionally verifiable without storing plaintext.
- Readiness becomes database-aware when the first persistence increment is
  wired into the runtime.

## Verification

- Clean and upgrade migration tests run against a separate PostgreSQL 17
  database and the production migration runner.
- Schema tests inspect columns and constraints and reject JSON/JSONB columns.
- Adapter compatibility fixtures cover every allowed provider model and fail
  on missing or unknown payload fields.
- WebAuthn tests cover challenge hashing, expiry, purpose/account constraints,
  single consumption, credential uniqueness, counters, and revocation.
- Recovery tests cover batch invalidation, single code use, recovery-session
  expiry, replacement enrollment, and session revocation.
- OAuth tests cover exact redirect binding, S256 PKCE, hashed lookup, code use,
  refresh rotation/reuse, family revocation, and stateless JWT issuance.
- Logging and database inspection confirm that plaintext bearer values,
  private keys, and JSON payloads are absent.

## Related material

- [Identity service and protocol libraries](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [Data ownership](../wiki/architecture/data-ownership.md)
- [Stateful infrastructure](../wiki/architecture/stateful-infrastructure.md)
