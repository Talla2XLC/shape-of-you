---
id: "decisions-20260729-store-revocable-auth-sessions-in-postgresql"
kind: adr
title: "Store revocable authentication sessions in PostgreSQL without mandatory Redis"
status: accepted
date: 2026-07-29
supersedes: []
superseded_by: null
tags:
  - "authentication"
  - "postgresql"
  - "redis"
  - "security"
---

# Store revocable authentication sessions in PostgreSQL without mandatory Redis

## Context

Future web and mobile clients need one authentication lifecycle across devices:
rotation, expiration, targeted/global revoke, refresh-credential reuse
protection, and audit. The current topology has one backend and PostgreSQL but
no Redis. Redis sessions would add a second stateful component and couple
authentication to it before horizontal scale exists.

## Decision

Store revocable refresh sessions in the backend-owned PostgreSQL database. A
session records stable `User` identity, refresh credential hash, device/client
metadata, created/last-used/expiry/revocation times, and rotation lineage. Raw
refresh credentials are never stored.

`Person` does not own authentication sessions. `User` access to a `Person` is
checked separately through `PersonAccessGrant`.

Web sends refresh credentials only in `HttpOnly`, `Secure`, appropriately
`SameSite` cookies. Mobile uses platform secure storage. A short-lived access
credential is not long-term session authority.

Access-token format, lifetime, signing/key rotation, login, recovery, and
internal versus external OIDC remain separate decisions. This ADR defines
persistence and revocation, not the full protocol.

Do not add Redis for sessions. Reconsider it only for measured distributed rate
limits, realtime coordination, justified cache workloads, unmet job/outbox SLO,
or another explicit ephemeral-state driver with an owner.

## Considered alternatives

- Long-lived stateless JWTs: easy verification but weak targeted revocation,
  device sessions, and safe rotation.
- Redis sessions: suitable at distributed scale but unjustified now.
- Encrypted cookie without server state: no datastore but limited immediate
  revocation and cross-client lifecycle.
- PostgreSQL refresh sessions: durable transactions, revocation, and audit.
  Selected.
- External identity provider: may own part of the lifecycle, but integration
  must preserve these security properties.

## Consequences

- Authentication mutations use ordinary PostgreSQL transactions and backups.
- Lookup and rotation need indexes, cleanup, and secure hash comparison.
- Raw tokens, cookies, and credentials are forbidden in logs, audit payloads,
  and documentation.
- Incident response can revoke one session, all User sessions, or a rotation
  family.
- Redis remains an optional infrastructure adapter, not a domain contract.
- Authentication must be implemented and reviewed before the real-data gate.

## Verification

- Integration tests cover creation, rotation, reuse detection, expiration, and
  revocation.
- Database stores only credential hashes.
- HTTPS web smoke verifies cookie flags and trust proxy.
- Mobile contracts do not require browser cookie semantics.
- Concurrent rotation cannot create two active children.
- Security Review approves the protocol before real data.

## Related material

- [Stateful infrastructure](../wiki/architecture/stateful-infrastructure.md)
- [Data ownership](../wiki/architecture/data-ownership.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [NestJS with FastifyAdapter and Nuxt](20260729-use-nestjs-with-fastify-and-nuxt.md)
- [User, Person, and access rights](20260730-separate-user-access-from-person-data-ownership.md)
