---
id: "architecture-data-ownership"
kind: architecture
title: "Data ownership"
status: draft
tags:
  - "architecture"
  - "data"
---

# Data ownership

## Summary

Staging PostgreSQL is authoritative for operational fitness data through
API-owned domain modules. Persistence follows domain boundaries and forbids
cross-service database access.

## Content

TASK-0067 completed the approved authority transfer after reconciliation,
exclusive-writer switch, and bounded observation. Google Sheets is now a
non-authoritative frozen legacy source; governance still prohibits writes, and
its ACL/archive disposition remains separate.

Each deployable owns its database, Drizzle schema, migrations, seed data,
credentials, and lifecycle. A shared physical PostgreSQL cluster does not
change logical ownership. Temporary staging gives API its own
`shape_of_you_api` database/login but shares cluster failures and upgrades.

Authentication `User` and domain `Person` are distinct. Fitness facts belong to
Person; User access requires an active `PersonAccessGrant` role (`owner`,
`editor`, `viewer`, or `coach`). Client-supplied `person_id` alone grants
nothing. Until authentication, only explicit synthetic context is allowed.

The Identity deployable owns its authentication and OAuth persistence boundary.
Its separate Drizzle schema now contains account/WebAuthn/recovery state and
typed OAuth client, grant, session, interaction, authorization-code, and
refresh-family state. Runtime database wiring, passkey/TOTP recovery, and the
initial OAuth protocol flow are implemented.

API-local User remains the authorization principal. The API-owned
`identity_subject_mappings` table binds an exact Identity `(issuer, subject)`
to one User; Identity never writes this table and never owns Person grants or
fitness facts. Each authenticated MCP call resolves that mapping and a current
active `PersonAccessGrant`. No token claim or first login implicitly creates a
Person relationship.

Ownership classes:

- shared immutable reference definitions (brands, ingredients, foods,
  exercises, providers/models, policies);
- Person overlays and private items;
- Person-owned facts, plans, observations, consent, connections,
  recommendations, decisions, and media metadata;
- external source records with provider identity/checksum/parser/review
  lifecycle.

Historical facts pin exact shared versions and relevant snapshots. Recovery
consent governs future collection; revocation is not erasure. Real wearable
data waits for authenticated retention/erasure.

Media binaries live in private S3-compatible storage; PostgreSQL owns metadata
and authorization. Object-key knowledge grants no access.

Forbidden: cross-service SQL/foreign keys, shared multi-service schemas or
migrations, and shared database credentials. Cross-boundary data uses APIs,
events, or owned published read models with explicit freshness contracts.

The progress overview is an API application read model, not a new owner. It
coordinates bounded reads exported by the existing Physical State, Nutrition,
Training, Recovery, and Coaching modules and derives no durable `DayRecord`.
`DayClosure` remains an exact-date lifecycle artifact and is not historical
progress authority.

## Evidence

- Operator authority/boundary rules and linked ADRs.

## Decisions

- Logical ownership matters more than physical cluster separation.
- `User` owns authentication; `Person` owns fitness state.
- Shared definitions, overlays, Person state, and source records have different
  lifecycles; no universal Person-scoped model.

## Open questions

- Final context ownership, read-model transport/lifecycle, retention/erasure,
  encryption/backup/access, media restore, permissions/invitations, actor audit.

## Related material

- [Migration strategy](migration-strategy.md)
- [Bounded contexts](../domain/bounded-contexts.md)
- [Service autonomy ADR](../../adr/20260728-deployable-service-autonomy.md)
- [Identity ADR](../../adr/20260730-separate-user-access-from-person-data-ownership.md)
- [Shared-reference ADR](../../adr/20260731-separate-shared-reference-definitions-from-person-owned-state.md)
- [Identity and external tool access](identity-and-external-tool-access.md)
- [Progress overview API](../api/progress-overview.md)
