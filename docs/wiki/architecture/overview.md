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
Drizzle, and typed domain modules. A future Nuxt client uses the same backend
contract.

## Content

Current foundation:

- one repository and 4DreamTeam workspace;
- Node.js, TypeScript, and pnpm workspaces;
- PostgreSQL with Drizzle ORM/Kit;
- Docker Compose for local development;
- one backend authority for web/mobile business rules;
- NestJS with FastifyAdapter; future Nuxt without duplicated domain logic;
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

PostgreSQL stores API-created data, but Google Sheets remains authoritative for
operational fitness data until dual-run and cutover.

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
- [Bounded contexts](../domain/bounded-contexts.md)
