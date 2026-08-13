---
id: "decisions-20260812-use-api-owned-browser-session-cookies"
kind: adr
title: "Use API-owned browser session cookies after OAuth code exchange"
status: accepted
date: 2026-08-12
supersedes: []
superseded_by: null
tags:
  - "api"
  - "authentication"
  - "browser"
  - "cookies"
  - "csrf"
  - "oauth"
---

# Use API-owned browser session cookies after OAuth code exchange

## Context

The static Web client is served with the API on `staging.shape-of-you.ru`,
while Identity is on `identity.staging.shape-of-you.ru`. Identity sessions are
host-only cookies and must stay so: sharing them through a parent-domain cookie
would weaken subdomain isolation and is incompatible with the `__Host-` cookie
profile. The API nevertheless needs an authenticated Person context to expose
the DayClosure browser UI.

The existing OAuth protocol supports Authorization Code with S256 PKCE and
public clients. MCP uses OAuth bearer access tokens, but browser UI should not
retain bearer or refresh tokens in JavaScript or browser storage.

## Decision

Add a release-managed public OAuth client for the Web client. Browser sign-in
starts at an API same-origin endpoint, which generates PKCE state and verifier
material in a short-lived, signed, host-only transaction cookie and redirects
the top-level browser to Identity. Identity completes its existing passkey and
consent flow, then redirects the one-time code to the API callback.

The API exchanges the code server-side using the PKCE verifier, validates the
returned OpenID Connect token against Identity's issuer and JWKS, resolves one
authorized Person through its existing local mapping, and sets an API-owned
`__Host-` HttpOnly, Secure, SameSite=Lax session cookie on the API/Web origin.
The session is a signed, short-lived API authorization envelope; it contains
only the authorized Person, subject, and issued/expiry timestamps. It
does not contain Identity OAuth access or refresh tokens.

The API issues a separate readable `__Host-` CSRF cookie tied to the session.
All browser write commands require the matching `X-CSRF-Token` header and
same-origin `Origin`; reads require only the API session cookie. The Web
client uses relative `/api/...` calls and reads the CSRF cookie solely to send
the header. Sign-out clears both API cookies. Expired API sessions restart the
top-level OAuth flow; an active Identity session makes that return flow
frictionless without exposing it to the Web client.

OAuth bearer tokens and MCP authorization remain separate. No Identity cookie
is accepted by the API, and no Web browser credential is accepted by MCP.

## Considered alternatives

- **Keep OAuth bearer tokens in JavaScript memory:** avoids API sessions but
  exposes a bearer credential to browser code and complicates refresh. Rejected
  for the browser product surface.
- **Share an Identity cookie with the API through a parent domain:** simple
  routing, but breaks host-only isolation and expands every sibling host's
  authority. Rejected.
- **Add a server-side session database immediately:** enables immediate
  revocation and richer session management, but introduces a new lifecycle
  table and cross-service revocation design before evidence requires it.
  Deferred; the short-lived signed API envelope is sufficient initially.
- **Make the static Web client a new SSR/BFF deployable:** would add a runtime
  and credential boundary just to proxy existing API calls. Rejected.

## Consequences

- The browser gains same-origin, HttpOnly API authorization without access or
  refresh tokens in JavaScript.
- API session expiry is bounded independently of the longer Identity session;
  Identity revocation is observed no later than the next API browser
  reauthorization.
- The API owns its cookie signing keys and the predefined Web OAuth client
  needs release-managed redirect URIs. These are deployment configuration, not
  browser configuration or source secrets.
- DayClosure UI remains a presentation consumer of published HTTP routes; it
  owns neither day lifecycle state nor Identity security policy.

## Verification

- API unit and integration tests prove state/PKCE validation, token validation,
  Person mapping, host-only cookie attributes, CSRF and Origin rejection,
  expiry, and logout.
- Identity reconciliation tests prove exact predefined Web client redirect
  allowlists.
- Web tests prove relative same-origin API calls, no credential persistence,
  CSRF headers on mutations, and explicit confirmation before close/reopen.
- Disposable browser E2E verifies sign-in, projection read, close, stale view,
  reopen, and sign-out.

## Related material

- [Passkey-bound sliding Identity sessions](20260806-use-passkey-bound-sliding-identity-sessions.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [Versioned Person-local day closures](20260811-model-versioned-person-local-day-closures.md)
