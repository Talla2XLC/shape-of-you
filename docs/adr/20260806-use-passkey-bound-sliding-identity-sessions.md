---
id: "decisions-20260806-use-passkey-bound-sliding-identity-sessions"
kind: adr
title: "Use passkey-bound sliding Identity sessions"
status: accepted
date: 2026-08-06
supersedes: []
superseded_by: null
tags:
  - "authentication"
  - "identity"
  - "oauth"
  - "security"
  - "sessions"
  - "webauthn"
---

# Use passkey-bound sliding Identity sessions

## Context

The Identity architecture selected passkey-first login but left challenge,
attestation, signature-counter, credential-management, and session-lifetime
policies unresolved. Requiring a passkey assertion for every API request would
make normal authenticated use impractical. A fixed absolute session lifetime
would also force active users through periodic login without a demonstrated
security or product requirement.

At the same time, a lost passkey must be removable from another authenticated
device, and sessions established with that passkey must not survive its
revocation. Resource servers validate short-lived JWT access tokens locally,
so ordinary API requests are not a reliable Identity-session activity signal.

## Decision

Use discoverable WebAuthn credentials with user verification `required` and
attestation conveyance `none`. An account can register multiple passkeys.
Registration, authentication, and recovery-registration challenges are random,
stored only as SHA-256 hashes, single-use, and valid for no more than five
minutes. RP ID and origin are exact environment configuration.

Persist authenticators' signature counters and evaluate counter regressions as
a secondary risk and audit signal. Do not reject an otherwise valid assertion
solely because a synchronized multi-device passkey reports an unsupported,
unchanged, or reset counter.

Create a browser/OAuth session only after successful passkey authentication or
the approved recovery flow. A passkey-authenticated session records the exact
WebAuthn credential and account that established it. Its `expires_at` value is
a sliding inactivity deadline, initially 30 days after authentication. There
is no separate absolute maximum lifetime.

Only activity observed and authenticated by Identity extends the inactivity
deadline: successful use of the browser session or successful refresh-token
rotation. A resource-server request authenticated only by a short-lived JWT
does not touch Identity state and therefore does not extend the deadline.
Session and refresh-family deadlines are advanced transactionally to 30 days
after accepted activity. Expired, revoked, disabled-account, or refresh-reuse
state is never revived by a later touch.

Users can list, rename, and revoke their passkeys, and list and revoke active
sessions. Revoking a passkey also revokes every session and refresh-token
family established through that credential. Completing passkey recovery
revokes existing sessions. The service refuses removal of the last usable
authentication method unless another active passkey or a valid approved
recovery path remains.

## Considered alternatives

- **Require a passkey assertion for every request:** minimizes bearer-session
  use but creates unacceptable interaction friction and is incompatible with
  normal OAuth resource access. Rejected.
- **Use a 30-day inactivity limit plus a 90-day absolute limit:** bounds a
  continuously active stolen session, but also forces every legitimate active
  user to sign in on a calendar schedule. Rejected for the initial policy.
- **Use non-expiring sessions:** simplest for active users, but abandoned
  credentials would remain useful indefinitely. Rejected in favor of a
  sliding inactivity deadline.
- **Treat every API request as session activity:** accurately reflects product
  use only by adding synchronous calls or activity events from every resource
  server to Identity. Rejected because it couples resource availability to
  session bookkeeping.
- **Hard-fail every signature-counter regression:** can detect some cloned
  authenticators, but produces false lockouts for synchronized passkeys whose
  counter behavior is not a reliable monotonic device signal. Rejected.
- **Revoke all sessions whenever one passkey is removed:** simpler persistence,
  but unnecessarily signs out unaffected devices. Reserved for recovery and
  account-wide security actions; normal passkey removal is credential-scoped.

## Consequences

- Active users can remain signed in indefinitely, while sessions unused for
  30 days expire.
- Access-token activity alone does not keep a session alive. Long-running OAuth
  clients remain active through refresh rotation.
- Session persistence needs the last Identity-observed activity timestamp and
  the originating WebAuthn credential. Refresh families retain their session
  binding and share the sliding deadline.
- Passkey removal becomes a transactional security operation across the
  credential, its sessions, their authorizations, and refresh families.
- A continuously used stolen session can remain valid until detected or
  revoked. Short access-token lifetime, refresh rotation/reuse detection,
  account disablement, user-visible session management, and credential-scoped
  revocation mitigate this accepted risk.

## Verification

- WebAuthn tests verify exact RP ID/origin, required user verification,
  attestation `none`, hashed single-use challenges, and the five-minute maximum.
- Session tests verify the 30-day sliding deadline, no absolute lifetime cap,
  monotonic activity updates, and refusal to revive expired or revoked state.
- Credential-management tests verify list, rename, removal safety, and
  credential-scoped session and refresh-family revocation.
- Counter tests verify audit/risk recording without false rejection of valid
  synchronized-passkey assertions.
- Migration tests verify account-consistent credential binding and typed
  relational persistence without JSON.

## Related material

- [Identity service and protocol libraries](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Identity relational model](20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
