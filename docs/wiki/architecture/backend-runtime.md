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
предметные вертикали `WeightMeasurement`, `BodyMeasurementSession` и
`PhysicalGoal`, а также Nutrition catalog, `Meal` и Training and Performance,
Recovery, Coaching и асинхронный Intake, сохраняя один deployable modular
backend.

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
application boundaries, но не становятся microservices. Первый асинхронный
workflow Intake использует очередь в той же PostgreSQL: worker забирает задания
через lease и `SKIP LOCKED`, повторяет временные ошибки с задержкой и завершает
исчерпанные задания безопасным кодом. Kafka, внешний broker, отдельный worker
service и новая database в текущую topology не входят.

Модуль Intake принимает исходный текст с `202 Accepted`, сохраняет request и
первое задание atomically, а затем обрабатывает независимые typed items.
Clarification и confirmation выполняются по одному item. Первый маршрут одной
transaction создаёт `WeightMeasurement`, завершает item и дописывает audit
timeline. Production parser adapter пока отсутствует; в таком режиме durable
jobs остаются в базе и не влияют на API readiness.

Модули Physical State предоставляют append-only body corrections, stable
current/history queries, versioned goals и optimistic lifecycle transitions.
Transport validation не преобразует типы request body или response; безопасное
coercion включено только для URL params и query strings.

Модуль Nutrition предоставляет shared/private versioned catalog, Person-owned
overlays, immutable Meal snapshots/corrections и query-only daily totals.
Source-neutral catalog ingestion ограничен staged database records: network
adapter, scheduler и отдельный deployable отсутствуют.

Модуль Training предоставляет shared/private версионируемый справочник
упражнений, person-owned версии программ с явным включением, неизменяемые
тренировочные сессии с отдельными подходами и полными corrections. Личные
рекорды и предложения прогрессии вычисляются запросами; принятие предложения
создаёт новую неактивную версию программы.

## Основания

- Реализация в `apps/api/src/`.
- Unit tests в `apps/api/test/app.unit.test.ts`.
- Integration tests в `apps/api/test/weight-measurements.integration.test.ts`.
- Integration tests в `apps/api/test/nutrition.integration.test.ts`.
- Integration tests в `apps/api/test/training.integration.test.ts`.
- Integration tests в `apps/api/test/intake.integration.test.ts`.

## Решения

- [NestJS с FastifyAdapter и Nuxt](../../adr/20260729-use-nestjs-with-fastify-and-nuxt.md).
- [PostgreSQL outbox до Kafka](../../adr/20260729-use-postgresql-outbox-before-kafka.md).
- [PostgreSQL-очередь и типизированные элементы Intake](../../adr/20260802-use-durable-postgresql-intake-queue-and-typed-items.md).
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
- [API BodyMeasurementSession](../api/body-measurement-sessions.md)
- [API PhysicalGoal](../api/physical-goals.md)
- [API Nutrition catalog](../api/nutrition-catalog.md)
- [API Meal](../api/meals.md)
- [API тренировок](../api/training.md)
- [API Intake](../api/intake.md)
