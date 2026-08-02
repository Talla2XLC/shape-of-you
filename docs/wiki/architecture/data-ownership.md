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

Google Sheets remains authoritative for operational fitness data. Future
persistence follows domain boundaries and forbids cross-service database access.

## Content

Before verified dual-run, reconciliation, and cutover, backend/PostgreSQL
representations are not operational authority.

Each deployable owns its database, Drizzle schema, migrations, seed data,
credentials, and lifecycle. A shared physical PostgreSQL cluster does not
change logical ownership. Temporary staging gives API its own
`shape_of_you_api` database/login but shares cluster failures and upgrades.

Authentication `User` and domain `Person` are distinct. Fitness facts belong to
Person; User access requires an active `PersonAccessGrant` role (`owner`,
`editor`, `viewer`, or `coach`). Client-supplied `person_id` alone grants
nothing. Until authentication, only explicit synthetic context is allowed.

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
