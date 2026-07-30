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

Текущий реализованный runtime — один NestJS API в `apps/api`, использующий
`FastifyAdapter`, PostgreSQL и Drizzle ORM. Он предоставляет system endpoints
и первую полную предметную вертикаль `WeightMeasurement`, сохраняя прежние
публичные contracts и deployable topology.

## Содержание

API запускается на Node.js 24 LTS и загружает конфигурацию через
runtime-validated package `@shape-of-you/config`. NestJS задаёт modules,
controllers, dependency injection и lifecycle, а Fastify остаётся HTTP
provider и предоставляет structured logging на Pino. Global exception filter
сохраняет единый публичный error contract; graceful shutdown проходит через
`NestFastifyApplication.close()`.

System endpoints:

- `GET /health` проверяет жизнь HTTP process и не зависит от PostgreSQL;
- `GET /ready` выполняет `select 1` и возвращает `503`, если БД недоступна;
- `GET /openapi.json` отдаёт OpenAPI, собранный из shared JSON Schemas.

Transport schemas находятся в `packages/contracts`. Domain и persistence код
остаются в `apps/api` и не зависят от Nest decorators. Один набор JSON Schemas
задаёт TypeScript transport types, runtime validation входов и выходов и
OpenAPI shapes. PostgreSQL connection pool закрывается Nest lifecycle только
если application создал его сам.

Runtime остаётся одним deployable modular backend. Nest modules задают
application boundaries, но не становятся microservices. PostgreSQL
transactional outbox будет добавлен только вместе с первым подтверждённым
асинхронным workflow; Kafka в текущую topology не входит.

## Основания

- Реализация в `apps/api/src/`.
- Unit tests в `apps/api/test/app.unit.test.ts`.
- Integration tests в `apps/api/test/weight-measurements.integration.test.ts`.

## Решения

- [NestJS с FastifyAdapter и Nuxt](../../adr/20260729-use-nestjs-with-fastify-and-nuxt.md).
- [PostgreSQL outbox до Kafka](../../adr/20260729-use-postgresql-outbox-before-kafka.md).
- [Superseded ADR Fastify](../../adr/20260728-use-fastify-for-initial-http-api.md).
- [Node.js, TypeScript и pnpm workspaces](../../adr/20260728-use-nodejs-typescript-and-pnpm-workspaces.md).
- [PostgreSQL с Drizzle](../../adr/20260728-use-postgresql-with-drizzle-orm-and-kit.md).

## Открытые вопросы

- TLS termination, authentication, authorization, metrics, tracing и
  измеримые SLO.
- Метрики, tracing и production observability contract.

## Связанные материалы

- [Локальный запуск](local-development.md)
- [Репозиторий и runtime](repository-and-runtime.md)
- [Deployment topology](deployment.md)
- [API WeightMeasurement](../api/weight-measurements.md)
