---
id: "decisions-20260802-use-durable-postgresql-intake-queue-and-typed-items"
kind: adr
title: "Use a durable PostgreSQL queue and typed Intake items"
status: accepted
date: 2026-08-02
supersedes: []
superseded_by: null
tags:
  - "intake"
  - "outbox"
  - "postgresql"
  - "queue"
---

# Use a durable PostgreSQL queue and typed Intake items

## Context

One user message may contain independent facts such as weight, a meal, a
workout, and a recovery observation. An external parser may be slow,
unavailable, or retried. Ambiguity in one fact must not block siblings, and
HTTP/worker retries must not create duplicates.

Intake is a supporting orchestration capability, not a domain-fact owner.
After confirmation, WeightMeasurement remains in Physical State, Meal in
Nutrition, WorkoutSession in Training, and RecoveryObservation in Recovery. A
universal JSON payload would weaken typing, constraints, and ownership.

## Decision

Implement Intake inside the existing API modular monolith using its
PostgreSQL. Create no new deployable, database, or external broker.

Person-owned `IntakeRequest` stores source text, locale, timezone, source
reference, receipt time, and Person/source-scoped idempotency key. Source text
is text, not a generic domain payload.

A parser-neutral port produces ordered `IntakeItem` records. Every item has a
typed lifecycle and a dedicated relational detail table for its domain command.
Do not use JSON/JSONB, polymorphic `(type, id)` references, or a universal fact
table. The created domain fact is linked by a typed foreign key.

Persist a request and its first job in one transaction. Queue jobs contain only
typed request/item references, lease, attempts, next-attempt time, and safe
error code. Workers claim rows with locking and `SKIP LOCKED`, apply bounded
retry/backoff, and terminally fail exhausted jobs.

Call the parser outside database transactions. Persist parser results in one
short transaction with typed items, initial states, and append-only timeline.
Ambiguous items wait for clarification; ready items wait for confirmation.
Confirmation creates a routing job.

Route each item independently. Domain mutation, created-fact link, successful
item state, and timeline entry commit in one transaction through
transaction-aware owning-module command ports. Intake receives no ownership of
those facts.

Request status is a projection over parsing/items, not a second mutable
authority. Timeline is an append-only audit/read model, not event sourcing.

Choose the concrete AI provider separately. Domain model, queue, state machine,
and API remain provider-neutral.

## Considered alternatives

- One synchronous HTTP request/transaction: simple, but parser latency and one
  ambiguity block every fact.
- Independent typed items without durable queue: supports partial progress but
  loses restart recovery and reliable retries.
- PostgreSQL queue with typed items: durable, clarifiable, and idempotent
  without new infrastructure. Selected.
- Kafka, RabbitMQ, or separate Intake service: independently scalable but
  premature before measured load or lifecycle independence.
- Universal JSON/JSONB command envelope: fast type addition but hides contracts
  from PostgreSQL and TypeScript.

## Consequences

- Request creation returns `202 Accepted`; status is queried separately.
- Successful items remain committed when a sibling is ambiguous or fails.
- Lease, locking, and idempotency allow workers in multiple API replicas.
- New Intake kinds require typed contract, detail table, parser mapping,
  owning-module command, and tests.
- Queue observability must cover lag, retries, terminal failures, and stale
  leases.
- Worker extraction or transport replacement remains possible without changing
  domain facts or public Intake lifecycle.

## Verification

- Repeated Person/source/idempotency input returns one IntakeRequest.
- One message creates independently confirmable typed items.
- Ambiguous items do not block successful siblings.
- Concurrent workers do not execute one job twice.
- Retry does not create a second domain fact.
- Domain fact and successful item/timeline state commit atomically.
- Schema contains no universal JSON/JSONB payload or polymorphic fact link.
- API restart loses neither available jobs nor expired leased jobs.

## Related material

- [Typed provenance and append-only supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [PostgreSQL outbox before Kafka](20260729-use-postgresql-outbox-before-kafka.md)
- [Draft bounded contexts](../wiki/domain/bounded-contexts.md)
- [Google Sheets behavior catalog](../wiki/data/google-sheets-behavior-catalog.md)
- [DEV-023 completion plan](../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
