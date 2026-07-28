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

## Кратко

Текущий runtime — один Fastify API в `apps/api`, использующий PostgreSQL через
Drizzle ORM. Он предоставляет system endpoints и первую полную предметную
вертикаль `WeightMeasurement`.

## Содержание

API запускается на Node.js 24 LTS и загружает конфигурацию через
runtime-validated package `@shape-of-you/config`. Fastify предоставляет JSON
structured logging на Pino, единый error handler и graceful shutdown через
`fastify.close()`.

System endpoints:

- `GET /health` проверяет жизнь HTTP process и не зависит от PostgreSQL;
- `GET /ready` выполняет `select 1` и возвращает `503`, если БД недоступна;
- `GET /openapi.json` строит OpenAPI из route schemas.

Transport schemas находятся в `packages/contracts`. Domain и persistence код
остаются в `apps/api`. PostgreSQL connection pool закрывается вместе с
Fastify lifecycle.

## Основания

- Реализация в `apps/api/src/`.
- Unit tests в `apps/api/test/app.unit.test.ts`.
- Integration tests в `apps/api/test/weight-measurements.integration.test.ts`.

## Решения

- [Fastify для начального HTTP API](../../adr/20260728-use-fastify-for-initial-http-api.md).
- [Node.js, TypeScript и pnpm workspaces](../../adr/20260728-use-nodejs-typescript-and-pnpm-workspaces.md).
- [PostgreSQL с Drizzle](../../adr/20260728-use-postgresql-with-drizzle-orm-and-kit.md).

## Открытые вопросы

- TLS termination, authentication, authorization, metrics, tracing и
  измеримые SLO.

## Связанные материалы

- [Локальный запуск](local-development.md)
- [Репозиторий и runtime](repository-and-runtime.md)
- [Deployment topology](deployment.md)
- [API WeightMeasurement](../api/weight-measurements.md)
