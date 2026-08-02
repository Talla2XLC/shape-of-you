---
id: "domain-intake"
kind: domain
title: "Intake requests and typed items"
status: draft
tags:
  - "domain"
  - "intake"
  - "queue"
---

# Intake requests and typed items

## Summary

Intake accepts user text, parses independently confirmable typed items, and
routes confirmed commands to domain owners. It coordinates but does not own
weight, nutrition, training, or recovery facts.

## Content

Person-owned IntakeRequest stores text, locale, timezone, SourceReference,
receipt time, and Person/source-scoped idempotency. Parser output is ordered
IntakeItems with independent clarification, confirmation, rejection, routing,
and terminal states. Request status is derived rather than a second authority.

Only `weight_measurement` is implemented. Proposed fields live in a typed
relational detail. Confirmation atomically creates/finds WeightMeasurement,
links it, completes the item, and appends timeline without copying fact fields.

PostgreSQL jobs use lease, `SKIP LOCKED`, bounded retry/backoff, and terminal
failure. Timeline is append-only audit, not event sourcing. No universal
JSON/JSONB payload or polymorphic fact link exists.

## Evidence

- Intake domain/repository and PostgreSQL integration tests.

## Decisions

- [Durable Intake queue ADR](../../adr/20260802-use-durable-postgresql-intake-queue-and-typed-items.md).

## Open questions

- Production AI parser, remaining typed routes, and queue observability.

## Related material

- [Intake API](../api/intake.md)
- [WeightMeasurement](weight-measurement.md)
- [Backend runtime](../architecture/backend-runtime.md)
