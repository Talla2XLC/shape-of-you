---
id: "decisions-20260729-use-postgresql-outbox-before-kafka"
kind: adr
title: "Use a PostgreSQL transactional outbox before Kafka is justified"
status: accepted
date: 2026-07-29
supersedes: []
superseded_by: null
tags:
  - "events"
  - "kafka"
  - "postgresql"
  - "runtime"
---

# Use a PostgreSQL transactional outbox before Kafka is justified

## Context

Future Intake, projection, audit, and coaching workflows need reliable
asynchronous processing and typed domain events. The current topology has one
backend, one owned PostgreSQL database, and no independently deployed
consumers.

Kafka now would require broker operations, topics, partitions, retention,
schema compatibility, consumer groups, retries, DLQ, lag monitoring, and a
PostgreSQL/Kafka dual-write solution. Kafka does not remove idempotency needs.

## Decision

Do not introduce Kafka now. When the first confirmed asynchronous command
boundary needs durable processing, use a PostgreSQL transactional outbox:

- create domain mutation and outbox record in one transaction;
- give each event a stable type, version, aggregate/source reference,
  occurrence time, payload, and dedupe identity;
- claim records safely across multiple workers;
- make handlers idempotent;
- persist retry state and safe failure diagnostics;
- never turn the outbox into domain authority.

Do not create speculative outbox tables before a real asynchronous workflow.
Domain code publishes typed events through a transport-neutral application
boundary.

Reconsider Kafka only when a measured driver exists: independently deployable
consumers, mass replay or long-lived log requirements, PostgreSQL throughput
limits, independent consumer scaling/failure isolation, streaming analytics,
or operational readiness for a broker. The outbox remains the atomic
publication source and a relay changes transport to Kafka.

## Considered alternatives

- Synchronous calls only: simplest, but cannot provide durable retries and
  eventual projections for long-running workflows.
- Kafka immediately: durable replayable stream but unjustified operational
  complexity without consumers or load.
- Redis queue: good for jobs but adds a second stateful store and does not make
  PostgreSQL mutation atomic without an outbox.
- PostgreSQL outbox and worker: atomic in one database and evolvable to Kafka.
  Selected.
- Full event sourcing: replayable model but excessive; domain tables remain
  authoritative.

## Consequences

- Staging receives no new stateful component.
- Asynchronous handlers assume at-least-once delivery.
- Event contracts version independently of internal entities.
- Retention, cleanup, retry limits, and observability are defined with the
  first workflow.
- Audit timeline and outbox remain separate concerns and authorities.
- Kafka can be introduced later without rewriting domain policies.

## Verification

- Integration tests prove mutation/outbox atomicity, idempotent redelivery,
  exclusive concurrent claims, and durable retry state.
- Architecture Review before Kafka verifies drivers, load, consumers,
  ownership, and operational readiness.

## Related material

- [API- or event-only communication](20260728-api-or-event-only-cross-service-communication.md)
- [PostgreSQL with Drizzle](20260728-use-postgresql-with-drizzle-orm-and-kit.md)
- [Integrity and lifecycle](../wiki/data/integrity-and-lifecycle.md)
- [DEV-023 completion plan](../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
