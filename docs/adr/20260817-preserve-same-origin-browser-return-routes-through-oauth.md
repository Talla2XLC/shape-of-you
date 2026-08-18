---
id: "decisions-20260817-preserve-same-origin-browser-return-routes-through-oauth"
kind: adr
title: "Preserve same-origin browser return routes through OAuth"
status: accepted
date: 2026-08-17
supersedes: []
superseded_by: "decisions-20260818-make-progress-overview-the-authenticated-default"
tags:
  - "authentication"
  - "browser"
  - "oauth"
  - "routing"
  - "security"
  - "web"
---

# Preserve same-origin browser return routes through OAuth

## Context

The API-owned browser OAuth flow currently redirects every successful callback
to `/`. That loses the route that required authentication, makes a direct visit
to `/day` end on the landing page, and leaves the landing page offering another
sign-in even when the API already holds a valid HttpOnly session cookie.

The static Nuxt client cannot inspect that cookie and must not infer authority
from browser storage. Passing an unchecked callback target through OAuth would
create an open-redirect boundary, while storing the target in local or session
storage would make navigation state mutable by browser scripts and would not be
bound to the OAuth state and PKCE transaction.

The first protected page is `/day`, but the contract should support later
static client routes without moving authentication policy into page
components. Route query parameters can be product state and should survive a
successful sign-in. URL fragments are excluded because the existing enrollment
flow uses a fragment for bearer material and return navigation must never copy
such values into an API request or cookie.

## Decision

Extend the API-owned OAuth transaction with a validated same-origin return
route. `/browser-auth/sign-in` accepts an optional `returnTo` value containing
only an absolute-path reference: a path beginning with one `/`, plus an
optional query string. The API rejects or replaces values that have an origin,
scheme, authority, backslash, fragment, control character, or exceed the
bounded length. The default return route is `/day`.

The validated route is stored only inside the existing short-lived, signed,
HttpOnly OAuth transaction cookie alongside state and PKCE verifier. The OAuth
callback ignores any callback query target and redirects only to the route
recovered from the verified transaction. Invalid, absent, expired, or
legacy transaction route state falls back to `/day`; it never redirects to an
external origin.

Add a credential-free API session-presence endpoint at
`GET /browser-auth/session`. It validates the existing API-owned HttpOnly
session using the same verifier as protected API routes and returns only:

- `204 No Content` for a valid active session;
- `401 Unauthorized` for a missing, expired, malformed, or unverifiable
  session.

The endpoint returns no subject, Person id, roles, expiry, token, or cookie
value and always sets `Cache-Control: no-store`. It does not refresh or extend
the session.

The static Web client uses one browser-auth adapter and reusable client route
middleware for pages that opt into API-session protection. Before rendering a
protected page, the middleware checks session presence. On `401`, it performs
a top-level navigation to `/api/browser-auth/sign-in` with the current
same-origin path and query as `returnTo`. The client never sends a fragment,
never stores the return route in browser storage, and never attempts to read the
HttpOnly cookie.

The landing page performs the same presence check. A valid session changes its
primary action to **Open my day**, linking to `/day`; an absent session keeps
the passkey sign-in action. While the check is pending, the page does not claim
either authenticated or unauthenticated state.

Successful sign-in without an explicit route lands on `/day`. Sign-out and
unauthorized Person mapping behavior remain unchanged. OAuth issuer, client,
PKCE, state, code exchange, Identity account mapping, API cookie format and
Person authorization stay under their existing owners.

## Considered alternatives

- **Always redirect callbacks to `/day`:** fixes the default landing but still
  loses a protected route and its query state. Rejected as incomplete.
- **Put `returnTo` directly in OAuth callback query or state:** avoids extending
  the transaction cookie, but makes validation and integrity easy to get wrong
  and risks turning the callback into an open redirect. Rejected.
- **Store the route in `localStorage` or `sessionStorage`:** simple for the
  client, but is script-mutable, not transaction-bound, and conflicts with the
  credential-minimizing browser boundary. Rejected.
- **Infer session presence by requesting the daily projection:** adds no API
  endpoint, but couples landing-page authentication UI to a domain read and
  performs unnecessary work. Rejected.
- **Expose session details to the client:** could support richer account UI,
  but leaks identifiers and authorization details not needed for navigation.
  Rejected for this slice.
- **Use SSR route guards:** can avoid client-side loading state, but requires a
  new Nuxt runtime and deployable boundary. Rejected under the static-client
  architecture.

## Consequences

- Successful browser OAuth has `/day` as a useful default and can safely return
  to the protected path and query that initiated sign-in.
- The API gains one small read-only session-presence contract and one additional
  signed transaction claim, without schema, migration, session persistence, or
  OAuth protocol changes.
- The landing page can render the correct primary action without JavaScript
  access to the HttpOnly credential.
- Protected routes share one guard instead of duplicating sign-in behavior in
  each page. Client-side static delivery still has a brief indeterminate state
  while session presence is checked.
- Fragments are intentionally not restored; protected product state that must
  survive sign-in belongs in bounded path or query parameters.

## Verification

- API tests pin default `/day`, exact path-and-query restoration, signed
  transaction integrity, legacy fallback, and rejection of external,
  protocol-relative, backslash, fragment, control-character, and oversized
  targets.
- Session-presence tests pin `204/401`, `Cache-Control: no-store`, empty success
  body, expiry handling, and absence of identity or authorization data.
- Web unit tests pin pending, authenticated, and unauthenticated landing states
  and the protected-route guard without browser storage.
- Browser E2E completes real OAuth and proves default `/day`, an authenticated
  return to the landing page with **Open my day**, and restoration of a direct
  protected path and query after sign-in.
- Responsive browser checks cover `/day` at narrow phone, tablet, and desktop
  widths with no horizontal overflow, oversized heading, excessive spacing, or
  empty card height.
- Architecture Review confirms that the static Web client remains a
  presentation consumer, the API remains the browser-session authority, and no
  new deployable or persistence boundary is introduced.

## Related material

- [API-owned browser session cookies](20260812-use-api-owned-browser-session-cookies.md)
- [Static Nuxt delivery](20260807-serve-static-nuxt-client-through-existing-edge.md)
- [Stable OAuth account subjects and full browser acceptance](20260817-use-stable-oauth-account-subjects-and-full-browser-acceptance.md)
- [TASK-0041 implementation plan](../../plans/2026/08/completed/2026-08-17-task-0041-preserve-browser-return-routes.md)
