---
id: "architecture-local-development"
kind: architecture
title: "Local backend development"
status: draft
tags:
  - "development"
  - "docker"
  - "runtime"
---

# Local backend development

## Summary

Full local development uses Node.js 24, pnpm 11, and Docker Compose. Compose
starts PostgreSQL, applies migrations, and runs the API.

## Content

Containerized startup:

```powershell
docker compose up --build
```

After readiness, API is available at `http://localhost:3000`:

```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod http://localhost:3000/ready
Invoke-RestMethod http://localhost:3000/openapi.json
```

Host development:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm db:migrate:api
pnpm dev
```

Database commands always name their owner. API commands use the API
`DATABASE_URL`; Identity commands use a separate Identity `DATABASE_URL`:

```powershell
pnpm db:generate:api
pnpm db:migrate:api
pnpm db:generate:identity
pnpm db:migrate:identity
```

The Identity service is not part of local Compose yet. Its migration tests use
an isolated PostgreSQL container and do not apply SQL to an operator database.

Validation:

```powershell
pnpm lint
pnpm typecheck
pnpm build
pnpm test
node scripts/validate-docs.mjs
```

`pnpm test` includes PostgreSQL integration tests and needs a working container
runtime. `pnpm test:unit` runs fast Docker-free checks.

## Evidence

- Workspace manifests, `.env.example`, Compose, API Dockerfile, and verified
  build/typecheck/lint/unit/integration/image checks.

## Decisions

- [Docker Compose for local development](../../adr/20260728-use-docker-compose-for-local-development.md).

## Open questions

- Staging smoke for a new version requires separate deployment authorization.

## Related material

- [Backend runtime](backend-runtime.md)
- [Migration notes](../data/backend-migrations.md)
