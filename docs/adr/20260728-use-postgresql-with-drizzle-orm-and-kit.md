---
id: "decisions-20260728-use-postgresql-with-drizzle-orm-and-kit"
kind: adr
title: "Use PostgreSQL with Drizzle ORM and Drizzle Kit"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "data"
  - "technology"
---

# Use PostgreSQL with Drizzle ORM and Drizzle Kit

## Context

The platform needs relational integrity, transparent SQL, controlled
migrations, PostgreSQL-specific capabilities, and local schema ownership.

## Decision

Use PostgreSQL with Drizzle ORM and Drizzle Kit for application persistence
after controlled migration. Raw SQL remains allowed for CTEs, window
functions, materialized views, specialized indexes, JSONB where explicitly
approved, PostgreSQL extensions, backfills, and complex migrations.

## Considered alternatives

- Prisma: stronger abstraction and ecosystem convenience, but less direct SQL
  control for this project's migration and analytical needs.
- SQL only: maximum transparency but more repetitive mapping and type-safety
  work.

## Consequences

Each future data owner maintains its own Drizzle schema and ordinary SQL
migrations. The ORM must not hide ownership or prevent required PostgreSQL
features. Replacing it requires a superseding ADR with technical evidence.

This ADR does not make PostgreSQL authoritative by itself. Version, hosting,
extensions, backup, and connection management remain operational decisions.

## Verification

- The operator explicitly accepted the decision and rationale on 2026-07-28.
- Authority remains in Google Sheets until an approved cutover.

## Related material

- `../wiki/architecture/data-ownership.md`
- `../wiki/architecture/migration-strategy.md`
