---
id: "decisions-20260806-use-totp-for-emergency-passkey-recovery"
kind: adr
title: "Use TOTP for emergency passkey recovery"
status: accepted
date: 2026-08-06
supersedes: []
superseded_by: null
tags:
  - "authentication"
  - "identity"
  - "recovery"
  - "security"
  - "totp"
  - "webauthn"
---

# Use TOTP for emergency passkey recovery

## Context

The passkey-first Identity design originally required textual single-use
recovery codes. The operator rejected that mandatory user experience: keeping
and manually entering opaque strings is not an acceptable default recovery
path. Synced and multiple passkeys remain preferred, but do not cover every
loss scenario. Email, SMS, an operator-only CLI, and a mandatory external
identity provider either weaken, centralize, or fail to scale as the recovery
boundary.

TOTP authenticator applications provide a replaceable RFC 6238 interface. The
user scans one QR code during setup and later enters a short rotating code.
Unlike passkeys, TOTP is phishable and its shared seed must be recoverable by
the server, so it is limited to emergency replacement-passkey enrollment.

This decision amends only the recovery-code clauses in the Identity-service
and passkey-session ADRs. Their remaining decisions remain authoritative.

## Decision

Keep passkeys as the only ordinary interactive login factor. Support multiple
and synchronized passkeys and authenticated passkey/session management.

Use an optional TOTP factor only when no usable passkey is available. Recovery
requires a unique normalized login handle plus a valid code. TOTP uses SHA-1,
six digits, and a 30-second period for broad RFC 6238 compatibility. Accept the
current time step and one adjacent step in either direction, persist the last
accepted step, and reject replay.

Enrollment requires an active browser session, exact Origin, and the
session-bound CSRF token. A pending factor becomes active only after one valid
code. Re-enrollment atomically revokes the previous factor. The raw seed and
`otpauth://` URI are returned only by the setup response and never enter logs,
audit rows, fixtures, or documentation.

Encrypt every persisted seed with AES-256-GCM. Store typed ciphertext, nonce,
authentication tag, key identifier, lifecycle timestamps, and no raw seed.
Encryption keys remain outside PostgreSQL in runtime secrets. A key ring plus
active key identifier permits overlapping decryption during rotation.

Throttle recovery persistently per account: five failed attempts create a
15-minute lockout. Return generic failures so handle existence is not
disclosed. A valid code creates a hashed, single-use recovery authority valid
for 15 minutes and bound to its WebAuthn recovery challenge.

Recovery completes only after registering a new passkey. Completion revokes
all browser sessions, session authorizations, and refresh-token families for
the account. It does not automatically revoke old passkeys; the user removes a
lost credential explicitly. Removing a passkey revokes only sessions and
refresh families established through it. The final active passkey can be
removed only when another passkey or an active TOTP factor remains.

Do not issue textual recovery-code batches in the initial product flow. Keep
the existing unused typed tables until a later explicit removal migration.

## Considered alternatives

- **Textual recovery-code batches:** independent and hashable, but their
  storage and manual-entry experience was rejected.
- **External Google or Yandex identity:** convenient but makes recovery policy
  and availability vendor-owned.
- **Email magic links or SMS:** familiar, but reduce security to email or
  telephone-account recovery.
- **Operator-only recovery CLI:** useful for an administrator, but cannot be
  the recovery contract for future users.
- **No emergency recovery:** strongest boundary, but permanently locks an
  account after loss of every passkey.
- **TOTP as ordinary login:** makes a phishable shared secret routine.
  Rejected; TOTP is recovery-only.

## Consequences

- Users normally retain no textual recovery bundle and enter one six-digit
  code only during emergency recovery.
- Authenticator synchronization may delegate seed recovery to its provider;
  unsynchronized loss of both passkeys and the TOTP seed remains unrecoverable.
- Identity needs encrypted-secret configuration, key rotation, persistent
  throttling, replay prevention, and a memorable login handle.
- A database dump alone cannot recover TOTP seeds, while compromise of both
  the database and encryption key can.
- TOTP weakens emergency recovery relative to origin-bound passkeys. Rate
  limits, narrow authority, revocation, and mandatory new-passkey enrollment
  constrain that accepted risk.

## Verification

- Unit tests cover TOTP windows, constant-time comparison, AES-GCM, wrong-key
  failure, and replay rejection.
- Integration tests cover enrollment, replacement, generic failures,
  persistent lockout, exact authority binding, expiry, one-time use, new
  passkey registration, and account-wide session/refresh revocation.
- Credential-management tests cover listing, renaming, final-factor safety,
  credential-scoped revocation, and session self-revocation.
- Migration tests verify clean and upgrade paths and reject PostgreSQL
  identifiers longer than 63 UTF-8 bytes.
- Deployment validation fails before service replacement when TOTP key
  configuration is missing or invalid.

## Related material

- [Identity service and protocol libraries](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Passkey-bound sliding sessions](20260806-use-passkey-bound-sliding-identity-sessions.md)
- [Initial passkey bootstrap and CSRF](20260806-bootstrap-first-passkey-and-require-origin-csrf-defense.md)
- [TOTP](https://www.rfc-editor.org/rfc/rfc6238)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
