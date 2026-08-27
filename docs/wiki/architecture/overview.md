---
id: "architecture-overview"
kind: architecture
title: "Architecture overview"
status: draft
tags: []
---

# Architecture overview

## Summary

Shape of You is an architecture-first production platform in a modular
monorepo. Current runtime is one NestJS API with `FastifyAdapter`, PostgreSQL,
Drizzle, typed domain modules, an independent Identity service, and a static
Nuxt client using the same backend contract.

## Content

Current foundation:

- one repository and 4DreamTeam workspace;
- Node.js, TypeScript, and pnpm workspaces;
- PostgreSQL with Drizzle ORM/Kit;
- Docker Compose for local development;
- one backend authority for web/mobile business rules;
- NestJS with FastifyAdapter and static Nuxt without duplicated domain logic;
- PostgreSQL queues/outbox before measured Kafka need;
- PostgreSQL revocable sessions without mandatory Redis;
- private S3-compatible storage for future user media;
- strict deployable/data ownership when new deployables are justified;
- no cross-service SQL; integration through APIs, events, or published read
  models.

An accepted but unimplemented Identity boundary adds one project-owned
deployable for shared OAuth/OIDC while keeping Person authorization in the API.
Login is passkey-first; protocol-library adoption remains gated by a technical
spike.

Bounded contexts are logical modeling boundaries, not services. Current
implementation remains one modular backend. Transport schemas, domain
validation, and repositories are separated without generic CRUD abstractions.
New deployables or Kafka require a confirmed driver and ADR.

The authenticated default `/progress` uses one in-process API read-model
coordinator over bounded module-owned range reads. It returns sparse current
facts for at most 366 local dates without a materialized aggregate, new data
owner, cross-service SQL, or expansion of the per-day `DayClosure` boundary.

Staging PostgreSQL is operational authority for fitness data through the typed
API/MCP domain contracts. Google Sheets is a non-authoritative frozen legacy
workbook; it is not a second writer or live projection.

## Evidence

- Operator baseline, accepted ADRs, implemented runtime, integration tests, and
  production image verification.

## Decisions

- Major tasks require Architecture Review under root `AGENTS.md`.

## Open questions

- Remaining module boundaries, future APIs/events, production hosting,
  security, observability, data policy, and measurable SLOs.

## Related material

- [Drivers](drivers.md)
- [Quality attributes](quality-attributes.md)
- [Data ownership](data-ownership.md)
- [Repository and runtime](repository-and-runtime.md)
- [Stateful infrastructure](stateful-infrastructure.md)
- [Identity and external tool access](identity-and-external-tool-access.md)
- [Migration strategy](migration-strategy.md)
- [Progress overview API](../api/progress-overview.md)
- [Bounded contexts](../domain/bounded-contexts.md)
