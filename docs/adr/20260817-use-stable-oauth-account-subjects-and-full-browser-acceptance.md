---
id: "decisions-20260817-use-stable-oauth-account-subjects-and-full-browser-acceptance"
kind: adr
title: "Use stable OAuth account subjects and full browser acceptance"
status: accepted
date: 2026-08-17
supersedes: []
superseded_by: null
tags:
  - "authorization"
  - "browser"
  - "identity"
  - "testing"
---

# Use stable OAuth account subjects and full browser acceptance

## Context

The Web OAuth flow can authenticate an Identity account successfully while the
API still rejects the callback because that exact external subject does not
resolve to one active authorized Person. Availability smoke tests, isolated
OAuth tests, API tests with injected resolvers, and Web tests with mocked HTTP
responses cannot prove the complete browser path.

The API owns User, PersonAccessGrant, and external subject mappings. Identity
owns accounts and their OAuth identifiers. Code delivery must not inspect,
grant, revoke, or restore business authorization. Operators nevertheless need
an explicit bootstrap path that preserves API invariants and does not require
cross-service SQL.

## Decision

The immutable Identity account UUID is the public OAuth `sub`. ID tokens and
resource access tokens use that same identifier under `oidc-provider`. The
separate database `subject` value remains an account-local WebAuthn username
and is not a second OAuth identifier.

The API exposes a service-owned operational CLI for explicit Person-access
bootstrap and lifecycle operations. It receives the exact issuer and OAuth
subject, connects only to the API-owned database, and supports `inspect`,
`ensure`, `revoke`, and `restore`. Operators may run it through an explicitly
controlled database connection such as an SSH tunnel. It is not part of build,
deployment, migration, or application startup.

`ensure` is idempotent and fail-closed:

- an already complete active mapping remains unchanged;
- when the API has no real Person, it creates the initial User, real Person,
  owner grant, and mapping atomically;
- when the API has exactly one active real Person, it creates a distinct API
  User and owner grant for that Person, preserving existing fitness data;
- archived, multiple, partial, disabled, revoked, or otherwise ambiguous state
  is rejected without repair;
- revoked access is restored only by the separate explicit `restore` action.

Add a disposable full-browser acceptance test that uses separate API and
Identity databases, ephemeral keys and certificates, a virtual WebAuthn
authenticator, real HTTP OAuth redirects and code exchange, the API-owned
browser cookie, and a real daily projection read. Test authorities are created
only in process-scoped temporary files and are deleted during cleanup.

An authenticated but unauthorized browser callback redirects to a static,
credential-free access-required page instead of exposing a raw JSON error.

## Considered alternatives

- **Grant or inspect owner access during deployment:** reproducible but couples
  business authorization to code delivery and adds environment-specific
  variables to CI/CD. Rejected.
- **Grant owner access on first login:** convenient, but an authenticated
  account would become a Person owner without a separate authorization
  decision. Rejected.
- **Create a new Person for every unbound subject:** preserves isolation but
  can send the same human to an empty duplicate profile. Rejected for the
  single-owner staging environment.
- **Use direct SQL as the normal path:** technically possible but bypasses
  service-owned invariants and atomic conflict handling. Retained only as a
  break-glass operator capability, not the supported workflow.
- **Add a protected administrative HTTP API now:** suitable for Postman and a
  future admin UI, but requires a separate authorization and audit contract.
  Deferred to separate scope; the CLI remains the initial bootstrap boundary.
- **Allow several Identity subjects to map to one API User:** requires a
  schema-policy change. Separate API Users may already hold grants to the same
  Person, so the persistence change is unnecessary. Rejected.

## Consequences

- OAuth tokens and API mappings use one stable subject contract.
- CI/CD remains responsible only for validation, packaging, and delivery.
- Initial authorization remains an explicit operator action outside delivery.
- A replacement Identity account can reach the existing Person without
  duplicating fitness data and can be revoked independently.
- The sole-active-real-Person rule is a bootstrap policy, not a general
  multi-user invitation model.
- CI is slower because one browser test starts two databases, both services,
  TLS proxies, and Chromium. This cost is accepted for the auth boundary.

## Verification

- API integration tests pin create, link, repeat, revoked, archived, partial,
  concurrent, and ambiguous owner-access states.
- Deployment contract tests confirm the delivery controller has no Person
  authorization operation or account-specific input.
- Disposable Playwright acceptance completes enrollment, passkey login,
  consent, callback, browser session creation, and daily projection read using
  real service HTTP boundaries.
- Web tests pin the credential-free access-required page and API tests pin the
  exact redirect without subject or OAuth material.

## Related material

- [API-owned browser session cookies](20260812-use-api-owned-browser-session-cookies.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [Local development](../wiki/architecture/local-development.md)
