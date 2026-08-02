---
id: "decisions-20260728-use-fastify-for-initial-http-api"
kind: adr
title: "Use Fastify for the initial HTTP API"
status: superseded
date: 2026-07-28
supersedes: []
superseded_by: "decisions-20260729-use-nestjs-with-fastify-and-nuxt"
tags:
  - "api"
  - "runtime"
  - "technology"
---

# Use Fastify for the initial HTTP API

## Context

DEV-023 required one mature minimal HTTP runtime with runtime validation,
structured logging, one error handler, graceful shutdown, and OpenAPI from the
same schemas that validate requests and responses. A framework spike or custom
HTTP layer would distract from the first vertical slice.

## Decision

Use Fastify for the initial deployable API in `apps/api`.

Define route JSON Schemas in `packages/contracts`. Fastify uses them for
validation and serialization, a Type Provider infers TypeScript types, and the
Swagger plugin builds OpenAPI. Use built-in Pino structured logging and
`fastify.close()` as the graceful-shutdown boundary.

This decision applied only to the initial modular backend. It completed that
slice and was later superseded by NestJS as the application framework while
retaining Fastify through `FastifyAdapter`.

## Considered alternatives

- Express: mature ecosystem, but validation, typed schemas, logging, and
  OpenAPI require more separate composition and synchronization points.
- Hono: compact and portable, but the task benefited more from mature server
  plugins and direct JSON Schema, Pino, and PostgreSQL lifecycle integration.
- Custom Node.js HTTP: fewer dependencies but unjustified implementation of
  routing, validation, errors, and shutdown.

## Consequences

- API receives one validation, error, logging, and lifecycle model.
- Contracts remain transport schemas and contain no domain implementation.
- Fastify plugins must be upgraded as a compatible set.
- A replacement HTTP stack requires another ADR.

## Verification

- Build and typecheck verify Type Provider integration.
- Tests verify validation, error shape, OpenAPI, and PostgreSQL routes.
- Docker smoke verifies startup and graceful lifecycle when Docker is
  available.

## Related material

- [DEV-023 plan](../../plans/2026/07/completed/2026-07-28-backend-bootstrap-and-weight-vertical.md)
- [Repository and runtime](../wiki/architecture/repository-and-runtime.md)
- [Node.js, TypeScript, and pnpm](20260728-use-nodejs-typescript-and-pnpm-workspaces.md)
- [NestJS with FastifyAdapter and Nuxt](20260729-use-nestjs-with-fastify-and-nuxt.md)
