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
Recovery, Coaching, asynchronous Intake, in-process Garmin/Intervals adapters,
and an OAuth-protected MCP adapter in one modular deployable.

## Content

Node.js 24 loads runtime-validated `@shape-of-you/config`. NestJS owns modules,
DI, and lifecycle; Fastify provides HTTP and Pino logging. A global exception
filter preserves one public error contract. Shutdown uses
`NestFastifyApplication.close()`.

The API PostgreSQL pool allows 10 connections outside tests and 4 in tests.
Connection acquisition and connection establishment use a bounded 5000 ms
driver timeout. Brief contention can wait for an available connection; sustained
exhaustion still fails. This budget does not bound SQL execution or a complete
composed read. See the [bounded-wait ADR](../../adr/20261009-bound-api-database-connection-waits.md).

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

The Integrations module coordinates direct Garmin personal-key linking and
Garmin-via-Intervals OAuth through scoped adapters in the existing API process.
It owns encrypted per-connection credentials, consent-bound technical inboxes,
sync projections and typed import. Direct availability requires database and
integration encryption settings; Intervals additionally requires its OAuth
client settings. Provider transport and raw payloads end at the adapter.
Recovery and Training retain their existing ownership and typed commands.

PostgreSQL leases and `SKIP LOCKED` scope every claim to the selected provider.
The shared loop alternates providers and uses a fifteen-minute connection
lease for bounded reconciliation plus the shared twenty-FIT download budget;
it does not claim a hard database wall-time guarantee. Direct historical
windows are fourteen days. Disconnect, account binding, callbacks and stale
worker completion are consent-fenced. Local Garmin key removal does not claim
remote revocation. Coach selects the active provider's exact delivery receipts.
Normal domain reads remain independent of provider availability. See the
[Connections contract](../api/connections.md) for current coverage and controls.

The same Integrations module owns scheduled provider transitions in
`integration_cutovers`; no service or database boundary is added. Its worker
commits date-bounded authority only after a sealed journal-v2 policy proof,
then drains the old source within a fixed deadline. Recovery and Training
enforce admission under their existing Person lock. Restore replay disables
import instead of recreating credentials or consent. The
[transition ADR](../../adr/20261120-switch-intervals-to-garmin-with-date-boundary.md)
and [journal ADR](../../adr/20261120-preserve-cutover-bounds-in-erasure-journal-v2.md)
define the authority; this local implementation is not yet delivered.

When all three OAuth trust values are configured, the API also exposes a
stateless Streamable HTTP MCP endpoint at `/mcp` and protected-resource
metadata. Its eight allowlisted tools reuse existing application services.
Every invocation verifies the Identity JWT and then resolves an API-owned
subject mapping and active Person grant into request-scoped Person context.
The synthetic compatibility context is never used for MCP authorization.

The repository also contains the independent `apps/identity` runtime. It owns
its PostgreSQL connection pool, requires a separate `DATABASE_URL`, keeps
`GET /live` dependency-free, and makes `GET /ready` execute `select 1` with a
stable `503` response on database failure. Its migration runner remains a
separate one-shot entrypoint. Identity is deployed to staging; OAuth signing
and API MCP activation remain configuration-gated until the required keys and
operator mappings are provisioned.

## Evidence

- `apps/api/src/` and API unit/integration tests.

## Decisions

- [Direct Garmin Personal API linking](../../adr/20261118-connect-garmin-personal-api.md)
- [NestJS and Nuxt](../../adr/20260729-use-nestjs-with-fastify-and-nuxt.md)
- [PostgreSQL queue](../../adr/20260802-use-durable-postgresql-intake-queue-and-typed-items.md)
- [PostgreSQL with Drizzle](../../adr/20260728-use-postgresql-with-drizzle-orm-and-kit.md)
- [Garmin through Intervals.icu](../../adr/20260907-connect-garmin-through-intervals-icu.md)

## Open questions

- Metrics, tracing, security monitoring, and SLOs.
- Authentication coverage for non-MCP API routes before real-data activation.
- Live Intervals.icu OAuth and data-contract verification after application
  approval and credential provisioning.

## Related material

- [Local development](local-development.md)
- [Repository/runtime](repository-and-runtime.md)
- [Deployment](deployment.md)
- [API documentation](../api/intake.md)
- [Connections API](../api/connections.md)
