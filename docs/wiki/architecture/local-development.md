---
id: "architecture-local-development"
kind: architecture
title: "Local backend development"
status: accepted
tags:
  - "development"
  - "docker"
  - "runtime"
---

# Local backend development

## Summary

Full local development uses Node.js 24, pnpm 11, and Docker Compose. API and
Identity retain separate PostgreSQL databases, credentials, migration jobs,
and runtime services.

## Content

Containerized startup:

```sh
pnpm local:up
```

After readiness, API is available at `http://localhost:3000` and Identity at
`http://localhost:3001`:

```sh
curl --fail http://localhost:3000/health
curl --fail http://localhost:3000/ready
curl --fail http://localhost:3001/live
curl --fail http://localhost:3001/ready
```

The Compose databases use project-scoped persistent volumes. Stop services
without deleting data with `pnpm local:down`. `pnpm local:reset` explicitly
deletes both local database volumes.

For host-based watch mode, create service-owned local environment files and
start only the database dependencies first:

```sh
pnpm install
cp apps/api/.env.example apps/api/.env.local
cp apps/identity/.env.example apps/identity/.env.local
pnpm local:dependencies
pnpm local:migrate
pnpm dev
```

The ignored `.env.local` files belong to their service and must contain only
local credentials. Database commands always name their owner:

```sh
pnpm db:generate:api
pnpm db:migrate:api
pnpm db:generate:identity
pnpm db:migrate:identity
```

Package integration tests continue to use isolated PostgreSQL Testcontainers.
They do not apply SQL to developer, staging, or operator databases.

Cross-service smoke uses a separate disposable Compose project:

```sh
pnpm test:e2e
```

The runner assigns ephemeral host ports, waits for both migration chains and
runtime readiness, verifies API and Identity liveness/readiness through their
internal network, and always removes its containers, volumes, networks, and
project-built images. CI executes the same command. Local edge, TLS, OAuth flow
automation, and browser passkey automation remain outside this first E2E
increment.

Validation:

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
node scripts/validate-docs.mjs
```

`pnpm test` includes PostgreSQL integration tests and needs a working container
runtime. `pnpm test:e2e` additionally builds and verifies the disposable local
stack. `pnpm test:unit` runs fast Docker-free checks.

## Evidence

- Workspace manifests, service-owned `.env.example` files, Compose, service
  Dockerfiles, E2E runner, and verified build/typecheck/lint/unit/integration
  checks.

## Decisions

- [Docker Compose for local development](../../adr/20260728-use-docker-compose-for-local-development.md).

## Open questions

- Add an edge-routed OAuth E2E scenario after the OAuth endpoints and
  API-to-Identity trust contract are implemented.

## Related material

- [Backend runtime](backend-runtime.md)
- [Migration notes](../data/backend-migrations.md)
