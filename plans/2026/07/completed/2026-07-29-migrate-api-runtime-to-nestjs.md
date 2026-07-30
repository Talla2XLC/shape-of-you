---
title: Миграция API runtime на NestJS с FastifyAdapter
status: completed
created: 2026-07-29
updated: 2026-07-30
related_roadmap_items:
  - DEV-023
related_board_items:
  - TASK-0009
---

# Миграция API runtime на NestJS с FastifyAdapter

## Цель

Перевести существующий `apps/api` с прямой композиции Fastify на последний
стабильный NestJS с `FastifyAdapter`, сохранив публичный API, PostgreSQL,
Drizzle, schema-first contracts, tests, Docker image и staging topology.

Миграция выполняется до реализации остальных предметных вертикалей DEV-023,
пока backend содержит только system endpoints и `WeightMeasurement`.

## Утверждённые решения

- NestJS является application framework backend.
- Fastify остаётся HTTP provider через `@nestjs/platform-fastify`.
- Express не добавляется.
- `@shape-of-you/contracts` остаётся единственным источником runtime schemas,
  TypeScript transport types и OpenAPI shapes.
- PostgreSQL и Drizzle не меняются.
- Kafka не добавляется; PostgreSQL outbox реализуется только вместе с первым
  подтверждённым asynchronous workflow.
- Nuxt не входит в эту миграцию и будет добавлен отдельным планом DEV-025.

## В объёме

- Nest bootstrap и root module.
- Config provider поверх текущего runtime-validated config package.
- Database provider и корректный pool lifecycle.
- System module для health, readiness и OpenAPI.
- Physical State module с существующей вертикалью `WeightMeasurement`.
- Controllers, application providers, repositories и exception mapping.
- Интеграция schema-first validation и OpenAPI без duplicate DTO definitions.
- Unit и integration test harness для Nest application.
- Адаптация build, dev, lint, Docker и smoke commands.
- Обновление canonical Wiki после фактической миграции.

## Вне объёма

- Новые domain entities или endpoints.
- Изменение PostgreSQL schema и migrations.
- Import или изменение реальных данных.
- Authentication и authorization.
- Kafka, Redis или новый stateful component.
- Nuxt, web UI и mobile client.
- Изменение deployment topology.

## Последовательность

### 1. Contract integration spike

- Подключить один существующий request/response schema к Nest controller.
- Подтвердить runtime validation входа и выхода.
- Подтвердить генерацию эквивалентного OpenAPI.
- Не принимать решение, создающее параллельные JSON Schema и DTO definitions.
- Зафиксировать выбранный adapter pattern в плане и tests.

### 2. Application bootstrap

- Добавить совместимый набор стабильных Nest packages с точными версиями в
  lockfile.
- Создать `AppModule` и bootstrap с `FastifyAdapter`.
- Сохранить structured logging, global error shape и listen host `0.0.0.0`.
- Подключить graceful shutdown через Nest lifecycle.

### 3. Infrastructure providers

- Предоставить validated config через explicit provider.
- Предоставить database context и ownership-aware pool cleanup.
- Сохранить test overrides без global mutable container state.

### 4. Перенос system endpoints

- Перенести `/health`, `/ready` и `/openapi.json`.
- Сохранить различие liveness и database readiness.
- Проверить status codes и response schemas.

### 5. Перенос WeightMeasurement

- Создать module, controller и application service.
- Сохранить domain validation и repository boundary.
- Сохранить idempotent create, read by UUID и cursor pagination.
- Не добавлять generic CRUD или generic repository framework.

### 6. Regression и delivery

- Перенести unit и integration harness.
- Сравнить OpenAPI и behavior существующих endpoints.
- Проверить build, lint, typecheck и clean-database integration tests.
- Собрать API image локально.
- После отдельного разрешения выполнить synthetic staging deployment и smoke.

## Критерии готовности

- Используются совместимые stable Nest packages и FastifyAdapter.
- В production dependencies отсутствует Express platform.
- Публичные endpoints, status codes, error shapes и pagination не изменились.
- Runtime validation и OpenAPI строятся из единственного contract source.
- Все текущие unit и integration scenarios проходят.
- Database migration не создана и рабочие данные не менялись.
- Docker health и staging smoke сохраняют текущую семантику.
- Canonical Wiki описывает фактический Nest runtime только после его проверки.
- Независимый Quality Review и Architecture Review завершены.

## Rollback

Framework migration не меняет database schema. Application rollback использует
предыдущий проверенный API image. Database rollback не требуется.

До staging новая и старая реализации сравниваются одними contract и integration
tests. Deployment выполняется только после отдельного разрешения.

## Риски

- Nest validation и Swagger integration могут подтолкнуть к duplicate DTO
  definitions; spike должен остановить такой вариант.
- Framework decorators могут протечь в domain layer; разрешены только transport
  и application composition dependencies.
- Неправильный lifecycle provider может закрыть caller-owned test database.
- Fastify plugins требуют проверки совместимости с Nest adapter.
- Механическая замена routes на controllers без module boundaries не даст
  архитектурной пользы.

## Architecture Review

1. **Избыточная сложность:** Nest добавляет framework layer по явному решению
   оператора; собственная abstraction над Nest не создаётся.
2. **Преждевременные microservices:** отсутствуют; modules остаются внутри
   одного deployable backend.
3. **DDD:** domain types и policies не зависят от decorators, controllers или
   Fastify.
4. **Дублирование:** contract source остаётся один; Wiki описывает состояние,
   ADR — решение, план — миграционные шаги.
5. **Упрощение:** миграция выполняется сейчас на одной вертикали, а не после
   реализации всего DEV-023.

## Связанные материалы

- `docs/adr/20260729-use-nestjs-with-fastify-and-nuxt.md`
- `docs/adr/20260729-use-postgresql-outbox-before-kafka.md`
- `plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md`
- `docs/wiki/architecture/backend-runtime.md`
