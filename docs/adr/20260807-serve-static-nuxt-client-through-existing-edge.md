---
id: "decisions-20260807-serve-static-nuxt-client-through-existing-edge"
kind: adr
title: "Serve the static Nuxt client through the existing edge"
status: accepted
date: 2026-08-07
supersedes: []
superseded_by: null
tags:
  - "deployment"
  - "frontend"
  - "identity"
  - "nginx"
  - "nuxt"
  - "security"
---

# Serve the static Nuxt client through the existing edge

## Context

Shape of You needs a first browser surface before the deferred ChatGPT client
provisioning and external OAuth/MCP connection. The initial slice needs only a
landing page, first-passkey enrollment, passkey sign-in, and minimal passkey and
session management over the existing Identity HTTP contracts. It does not need
fitness-domain screens, server-side rendering, a browser-specific backend, or a
new data owner.

The existing staging edge already owns both public HTTPS hosts and atomically
ships with the API and Identity images. Identity security depends on the exact
`https://identity.staging.shape-of-you.ru` origin, a host-only `__Host-`
session cookie, exact-Origin and session-bound CSRF checks, and the matching
WebAuthn RP ID. Moving browser calls to another origin would add CORS and cookie
coupling to a security-sensitive boundary.

The first-passkey bootstrap value is a short-lived bearer credential. Putting
it in a path or query would expose it to HTTP access logs, request metadata,
history synchronization, and referrers. URL fragments are not included in HTTP
requests, but browser code must still remove the fragment promptly and must not
persist or report the credential.

## Decision

Create `apps/web` as a Nuxt 4 client package. It is a build-time application,
not an independently deployed service. It has its own `package.json` and
`AGENTS.md`, but it owns no database, credentials, migrations, server routes,
domain rules, or independently versioned runtime. Nuxt/Nitro may participate in
the static build and prerender pipeline, but no Nitro server or API handler runs
after the build.

Build the web client as part of the existing edge image and copy only its
generated static output into the unprivileged nginx runtime image. Keep one
edge digest and the existing atomic staging release. Do not add a Node/Nitro
container, a third backend, a CDN, or object-storage deployment for this slice.
Only public, non-secret frontend configuration may be embedded in the static
artifact.

Partition the two HTTPS hosts at the Shape of You edge:

- `staging.shape-of-you.ru` serves the Nuxt client at `/` and client-owned
  routes. `/api`, `/api/`, `/.well-known/oauth-protected-resource`, and the
  existing edge health endpoint retain their current API or edge behavior.
- `identity.staging.shape-of-you.ru` serves the same Nuxt client by default.
  `/.well-known/`, `/oauth/`, and `/v1/` remain same-origin Identity routes.
  Existing Identity liveness/readiness and edge-health paths also remain
  available for deployment verification.
- Unknown hosts continue to fail closed, HTTP continues to serve ACME and
  redirect to HTTPS, and both shared-ingress and standalone adapters keep the
  same host/SNI ownership.

Identity-facing client routes execute only on the configured exact Identity
origin. Navigation from the product host to `/enroll`, `/sign-in`, or the
security surface uses that Identity origin rather than making cross-origin
credentialed requests. Identity API calls use relative `/v1/...` URLs, so the
session cookie, CSRF cookie/header, Origin validation, and WebAuthn RP binding
remain unchanged. No CORS policy is added.

The first client scope is:

- a public landing page without fitness-domain data;
- `/enroll`, which accepts exactly one `#token` fragment value, removes the
  fragment from the visible URL before contacting Identity, keeps the token
  only in tab memory for the active ceremony, and sends it only as an
  `Authorization: Bearer` header to the existing registration endpoints;
- `/sign-in`, which completes the existing discoverable-passkey
  authentication flow and establishes the existing Identity cookies;
- a minimal authenticated security surface for listing, adding, renaming, and
  revoking passkeys and for listing and revoking sessions through the current
  `/v1/security/...` and WebAuthn registration contracts.

The client does not store bootstrap, session, CSRF, WebAuthn challenge, or OAuth
credentials in `localStorage`, `sessionStorage`, IndexedDB, application logs,
analytics, or error-reporting payloads. Cookie-authenticated mutations read the
existing non-HttpOnly CSRF cookie and send its value in `X-CSRF-Token`; the
HttpOnly session credential remains inaccessible to JavaScript. Static assets
must not include third-party scripts or analytics in this release, and edge
security headers must be verified against the generated artifact.

ChatGPT client provisioning, the external OAuth/MCP connection, fitness-domain
UI, TOTP setup or recovery UI, recovery-code UI, public account registration,
SSR, and a browser-specific backend remain outside this decision.

## Considered alternatives

- **Run Nuxt/Nitro as a third application container:** supports SSR and server
  routes, but adds a deployable, health/rollback/resource ownership, and a new
  runtime failure mode without a requirement for server rendering. Rejected.
- **Serve a separate frontend container behind edge nginx:** keeps nginx image
  smaller, but still adds an internal runtime, Compose lifecycle, health check,
  image coordinate, and rollback coupling for immutable files. Rejected.
- **Publish static files to a CDN or object store:** can improve global asset
  delivery, but introduces another deployment authority and invalidation model
  before traffic or availability requirements justify it. Deferred.
- **Serve all browser UI from `staging.shape-of-you.ru` and call Identity with
  CORS:** provides one visible product origin, but weakens the simple exact-
  origin security model and complicates host-only cookies, CSRF, and WebAuthn.
  Rejected.
- **Move Identity routes under the product host:** simplifies navigation but
  changes the accepted issuer/origin/RP boundary and would require protocol,
  cookie, callback, and client-registration migration. Rejected.
- **Keep handwritten HTML inside Identity:** is sufficient for the existing
  OAuth interaction page, but duplicates a growing general UI and does not
  establish the selected Nuxt frontend. Rejected for product and security
  management screens; the narrow protocol interaction remains Identity-owned.

## Consequences

- The edge image becomes the delivery owner for both nginx configuration and
  the immutable frontend artifact; its build context and contract tests expand
  accordingly.
- A frontend-only change publishes a new edge digest but does not publish or
  run a new service image.
- API, Identity, database, credential, migration, and domain ownership remain
  unchanged. `apps/web` cannot import backend implementation modules or become
  a second source of domain policy.
- Identity UI availability now also depends on the edge static artifact, while
  Identity protocol and API availability continue to depend on the Identity
  service. Reserved-path routing must therefore be tested before release.
- Client-side routing needs an nginx fallback that never captures reserved API,
  metadata, OAuth, probe, or ACME paths.
- The narrow Identity-owned OAuth login/consent page remains served by
  Identity. Replacing that protocol page is not authorized by this decision.
- Future SSR, CDN delivery, a separate frontend runtime, production hostnames,
  or cross-origin clients require new evidence and, when they change this
  boundary, a new or superseding ADR.

Static edge delivery is the initial deployment mode, not a permanent ban on
SSR. Keep `apps/web` independently buildable and keep browser/API adapters
separate from presentation so the same Nuxt application can later use a
stateless Node/Nitro runtime without changing Identity or API contracts. A
separate frontend deployable becomes justified by a concrete driver such as
personalized pre-hydration HTML, server-only integration, dynamic SEO,
runtime tenant or locale configuration, an independent frontend release
cadence, or measured edge-artifact coupling. Horizontal scale by itself is not
such a driver because immutable files already scale without application
compute.

## Verification

- A production build contains only static client output and starts no
  Node/Nitro runtime.
- The edge image serves the landing and client routes on both configured hosts,
  while contract tests prove every reserved path still reaches its current
  owner in both deployment topologies.
- Browser tests cover successful and rejected enrollment, fragment removal and
  non-persistence, passkey sign-in, authenticated passkey/session management,
  CSRF headers, unauthenticated handling, and user-cancelled WebAuthn ceremonies.
- Tests fail if a bootstrap credential appears in a request URL, referrer,
  browser storage, log, generated asset, or rendered error.
- Existing Identity integration tests continue to verify exact Origin,
  WebAuthn RP ID/origin, host-only cookie attributes, and session-bound CSRF.
- Root lint, typecheck, build, tests, local end-to-end checks, staging Compose
  renders, shell deployment contracts, and canonical documentation validation
  pass before quality review.
- Architecture Review confirms that the client introduces no deployable or
  data owner, preserves DDD/domain authority, does not duplicate current-state
  documentation, and cannot be simplified further without losing the exact-
  origin security boundary.

## Related material

- [Nuxt client selection](20260729-use-nestjs-with-fastify-and-nuxt.md)
- [Identity service and protocol libraries](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Initial passkey bootstrap and CSRF](20260806-bootstrap-first-passkey-and-require-origin-csrf-defense.md)
- [Passkey-bound sliding sessions](20260806-use-passkey-bound-sliding-identity-sessions.md)
- [Shared Host/SNI ingress](20260805-route-shared-vm-ingress-by-host-and-sni.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [TASK-0034 implementation plan](../../plans/2026/08/completed/2026-08-07-task-0034-minimal-nuxt-frontend.md)
