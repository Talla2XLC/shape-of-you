---
id: "decisions-20260729-use-nestjs-with-fastify-and-nuxt"
kind: adr
title: "Use NestJS with FastifyAdapter and Nuxt for the web client"
status: accepted
date: 2026-07-29
supersedes: "decisions-20260728-use-fastify-for-initial-http-api"
superseded_by: null
tags:
  - "api"
  - "frontend"
  - "runtime"
  - "technology"
---

# Use NestJS with FastifyAdapter and Nuxt for the web client

## Context

The first DEV-023 slice used Fastify directly and verified HTTP, PostgreSQL,
migrations, contracts, tests, and staging delivery. Later work adds domain
modules, workflows, policy evaluation, guards, background processing, and
cross-module projections. The operator selected NestJS for the long-term
backend and Nuxt for the future web client.

Existing `@shape-of-you/contracts` schemas define runtime validation and
TypeScript types. Framework adoption must not create duplicate DTO or OpenAPI
authorities.

## Decision

Use the latest compatible stable NestJS as the backend application framework;
NestJS 11 was current at the decision date. Use
`@nestjs/platform-fastify` and `FastifyAdapter`, not Express without a new
driver and ADR.

Preserve:

- one deployable backend in `apps/api`;
- PostgreSQL, Drizzle ORM, and Drizzle Kit;
- schema-first `@shape-of-you/contracts`;
- one runtime-validation and OpenAPI source;
- existing URLs, status codes, and error contracts;
- Fastify-compatible logging, shutdown, health, and readiness semantics.

Nest modules are logical application boundaries inside the modular monolith,
not deployable services.

Use the latest stable Nuxt when DEV-025 implementation starts; Nuxt `4.5.1`
was current at the decision date. Nuxt calls only the published backend API and
does not own business rules. Nitro routes must not duplicate domain logic.

Exact framework versions are locked. “Latest stable” does not authorize
automatic production upgrades without CI and compatibility verification.

## Considered alternatives

- Keep direct Fastify: lowest immediate cost, but Nest offers the preferred
  application model for modules, DI, guards, lifecycle, and background work.
- NestJS with Express: broad middleware ecosystem but needlessly replaces the
  verified Fastify transport.
- NestJS with FastifyAdapter: adds the Nest model and preserves the HTTP
  engine. Selected.
- Use Nuxt/Nitro as the primary backend: fewer frameworks for web only, but
  mixes frontend delivery with domain authority and harms future mobile use.
- Duplicate contracts in Nest DTO classes: decorator-friendly but creates two
  validation and OpenAPI sources. Rejected.

## Consequences

- Bootstrap, routes, errors, lifecycle, and tests migrate into Nest modules,
  controllers, and providers.
- Fastify details stay in transport adapters; domain and application code do
  not depend on Nest or Fastify.
- JSON Schema integration must avoid duplicated contract definitions.
- Drizzle schema and data do not change because of framework migration.
- Nuxt is added only under an approved DEV-025 plan.
- Deployment remains one API image.

## Verification

- Endpoint behavior and OpenAPI pass regression tests before and after
  migration.
- Unit/integration tests start Nest without a required network listener.
- `FastifyAdapter` binds `0.0.0.0` in containers.
- Health, readiness, shutdown, and pool lifecycle semantics remain stable.
- Docker image and synthetic staging smoke pass without schema changes.
- Nuxt version is rechecked against official releases before DEV-025.

## Related material

- [Superseded Fastify ADR](20260728-use-fastify-for-initial-http-api.md)
- [Backend runtime](../wiki/architecture/backend-runtime.md)
- [Repository and runtime](../wiki/architecture/repository-and-runtime.md)
- [Completed NestJS migration plan](../../plans/2026/07/completed/2026-07-29-migrate-api-runtime-to-nestjs.md)
- [DEV-023 completion plan](../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
