---
id: "decisions-20260728-api-or-event-only-cross-service-communication"
kind: adr
title: "Allow cross-service communication only through APIs or events"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "architecture"
  - "service-boundaries"
---

# Allow cross-service communication only through APIs or events

## Context

Service data ownership is broken when another service reads or writes its
database directly.

## Decision

Cross-service SQL is forbidden. A service accesses only its own database
boundary. Services communicate through explicit HTTP APIs, events, or
published read models. Every published read model has an owner and a contract
and does not expose direct database access.

## Considered alternatives

- Direct cross-service SQL: simplifies individual queries and reports but
  destroys ownership, increases coupling, and makes independent schema changes
  unsafe.
- One shared database: lowers initial infrastructure cost but prematurely
  couples future deployable lifecycles.

## Consequences

Data contracts become service contracts. Cross-service reporting,
transactions, consistency, and replication are designed explicitly rather
than implemented as joins across service databases.

Sync/async selection, event infrastructure, delivery guarantees, contract
versioning, schema evolution, freshness, consistency, and observability remain
open until needed.

## Verification

- The operator explicitly accepted the decision on 2026-07-28.
- No existing integration needs migration.

## Related material

- `../wiki/architecture/overview.md`
- `20260728-modular-monorepo.md`
- `20260728-deployable-service-autonomy.md`
