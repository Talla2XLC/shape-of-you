---
id: "architecture-api-physical-goals"
kind: architecture
title: "PhysicalGoal API"
status: draft
tags:
  - "api"
  - "contract"
  - "goals"
  - "physical-state"
---

# PhysicalGoal API

## Summary

Stores stable PhysicalGoal roots and immutable intent/criteria versions with
optimistic lifecycle concurrency and same-Goal/Person version ownership.

## Content

- `POST /v1/physical-goals` — draft root and version 1.
- `POST /v1/physical-goals/:id/versions` — immutable draft version.
- `POST /v1/physical-goals/:id/versions/:version/activate` — select current.
- `POST /v1/physical-goals/:id/complete` and `/cancel` — terminal lifecycle.
- `GET /v1/physical-goals/:id` — current/latest version.
- `GET /v1/physical-goals/:id/history` — versions ascending.
- `GET /v1/physical-goals?status=active` — Person list ordered by creation/id.

Commands accept narrative intent, optional dates, SourceReference, dedupe key,
and `directional|exact|range|dynamic` criteria. Narrative/dynamic goals need no
invented number. Lifecycle commands require `expectedLockVersion`; stale
writes return `409`. `completed` and `cancelled` are terminal.

## Evidence

- Goal contracts/module and Physical State integration tests.

## Decisions

- Versions are append-only. Composite foreign keys protect same Goal/Person.
- Progress derives from authoritative physical facts.

## Open questions

- Primary-goal cardinality and automatic draft-version proposal policy.

## Related material

- [PhysicalGoal](../domain/physical-goal.md)
- [Backend runtime](../architecture/backend-runtime.md)
