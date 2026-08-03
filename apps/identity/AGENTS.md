# Deployable Identity Rules

## Boundary

`apps/identity` is the project-owned authentication and OAuth/OIDC deployable.
It owns accounts, credentials, consent, OAuth clients and protocol state,
signing keys, token issuance, and authentication audit.

It does not own `Person`, `PersonAccessGrant`, fitness facts, domain roles, or
domain mutation policy. It must not read the API database or share database
credentials with another deployable.

## Protocol and persistence

- Keep `oidc-provider` and SimpleWebAuthn behind project-owned adapters.
- Do not implement OAuth/OIDC, WebAuthn, JOSE, PKCE, or cryptographic
  primitives from scratch.
- Persist protocol and credential state in typed relational tables. JSON
  persistence blobs are forbidden.
- Store authorization codes, refresh credentials, recovery codes, and similar
  bearer secrets only as hashes.
- Fail closed when a protocol-library adapter receives an unknown payload
  field or unsupported model.
- Keep unsupported grants and protocol features disabled.

## Configuration and secrets

- Identity owns its runtime configuration, database, migrations, credentials,
  and signing-key access.
- Credentials and private keys enter only through the runtime environment or
  an approved secret provider.
- Never store or print secrets, raw tokens, credential material, or recovery
  codes in source, logs, snapshots, fixtures, or documentation.
- TLS certificate lifecycle belongs to the edge; OAuth signing keys belong to
  Identity.

## Code documentation

- Document every exported runtime function, class, interface, and type with
  concise English TSDoc.
- Document lifecycle ownership, error behavior, hashing, one-time use,
  rotation, and fail-closed invariants where relevant.

## Validation

- `pnpm --filter @shape-of-you/identity typecheck`
- `pnpm --filter @shape-of-you/identity build`
- `pnpm --filter @shape-of-you/identity test:unit`
- `pnpm --filter @shape-of-you/identity test:integration`
- Verify migrations against a clean, separate PostgreSQL database once schema
  work begins.
- Run the selected OpenID/OAuth conformance profile before production use.
