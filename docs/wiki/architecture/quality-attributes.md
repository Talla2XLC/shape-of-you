---
id: "architecture-quality-attributes"
kind: architecture
title: "Quality attributes"
status: draft
tags:
  - "architecture"
  - "quality"
---

# Quality attributes

## Summary

Safety, integrity, explainability, verifiability, evolvability, and operability
have priority. Numeric targets remain to be defined.

## Content

- **Safety:** deterministic domain rules block dangerous compensation; AI
  cannot invent confirmed facts or bypass safety rules.
- **Integrity:** writes use validation, relevant idempotency, confirmed
  persistence, and critical read-back. Migration requires reconciliation and
  rollback evidence.
- **Explainability:** recommendations link evidence; corrections and reversals
  remain traceable; correlation is not presented as causation.
- **Evolvability:** domain modules/contracts evolve without client rule forks or
  cross-service database coupling; decisions are recorded in ADRs.
- **Operability:** failures are observable and safely retryable. Stateful
  components require owners, backup, retention, restore, and observability.
- **Scalability:** use clear ownership, appropriate stateless interfaces,
  PostgreSQL capabilities, and measured bottlenecks. Do not distribute without
  evidence.

PostgreSQL and object-storage recovery must be coordinated for media metadata.
Redis remains non-authoritative.

## Evidence

- Confirmed safety, migration, and service-boundary constraints.

## Decisions

- Priority order is accepted; measurable scenarios remain open.

## Open questions

- SLO, RPO/RTO, growth, peak load, backups, audit retention, privacy, and
  security targets.

## Related material

- [Drivers](drivers.md)
- [Domain](../domain/overview.md)
- [Migration](migration-strategy.md)
- [Stateful infrastructure](stateful-infrastructure.md)
