---
id: "architecture-backend-runtime"
kind: architecture
title: "Backend runtime"
status: draft
tags:
  - "api"
  - "backend"
  - "runtime"
---

# Backend runtime

## Summary

Current runtime is one NestJS API in `apps/api` using `FastifyAdapter`,
PostgreSQL, and Drizzle. It implements Physical State, Nutrition, Training,
Recovery, Coaching, and asynchronous Intake in one modular deployable.

## Content

Node.js 24 loads runtime-validated `@shape-of-you/config`. NestJS owns modules,
DI, and lifecycle; Fastify provides HTTP and Pino logging. A global exception
filter preserves one public error contract. Shutdown uses
`NestFastifyApplication.close()`.

System endpoints:

- `GET /health` checks the HTTP process without PostgreSQL;
- `GET /ready` runs `select 1` and returns `503` when unavailable;
- `GET /openapi.json` builds OpenAPI from shared JSON Schemas.

`packages/contracts` is the single source for TypeScript transport types,
runtime validation, and OpenAPI. Domain/persistence remain framework-neutral.

Intake uses a PostgreSQL lease queue with `SKIP LOCKED`, bounded retry, and safe
failure codes. Request creation returns `202`; item clarification/confirmation
is independent; the first route atomically creates WeightMeasurement and audit
state. No production parser is configured yet, so durable jobs remain queued
without affecting readiness.

Physical State provides immutable corrections and versioned goals. Nutrition
provides layered catalog, Meal snapshots, and totals. Training provides
versioned exercises/programs, immutable sessions/sets, records, and progression
projections. Recovery and Coaching retain typed facts, policies, evidence, and
ownership boundaries.

The repository also contains the independent `apps/identity` runtime. It owns
its PostgreSQL connection pool, requires a separate `DATABASE_URL`, keeps
`GET /live` dependency-free, and makes `GET /ready` execute `select 1` with a
stable `503` response on database failure. Its migration runner remains a
separate one-shot entrypoint; Identity is not deployed yet.

## Evidence

- `apps/api/src/` and API unit/integration tests.

## Decisions

- [NestJS and Nuxt](../../adr/20260729-use-nestjs-with-fastify-and-nuxt.md)
- [PostgreSQL queue](../../adr/20260802-use-durable-postgresql-intake-queue-and-typed-items.md)
- [PostgreSQL with Drizzle](../../adr/20260728-use-postgresql-with-drizzle-orm-and-kit.md)

## Open questions

- TLS, authentication, authorization, metrics, tracing, observability, and SLOs.

## Related material

- [Local development](local-development.md)
- [Repository/runtime](repository-and-runtime.md)
- [Deployment](deployment.md)
- [API documentation](../api/intake.md)
