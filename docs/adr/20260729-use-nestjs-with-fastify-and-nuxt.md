---
id: "decisions-20260729-use-nestjs-with-fastify-and-nuxt"
kind: adr
title: "NestJS с FastifyAdapter и Nuxt для web-клиента"
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

# NestJS с FastifyAdapter и Nuxt для web-клиента

## Контекст

Первый срез DEV-023 реализован напрямую на Fastify и подтвердил HTTP,
PostgreSQL, migrations, contracts, tests и staging delivery. Следующий этап
добавляет несколько предметных модулей, application workflows, policy
evaluation, guards, background processing и cross-module projections.

Для долгосрочного backend оператор выбрал NestJS, а для будущего web-клиента —
Nuxt. Переход выгоднее выполнить, пока публичный API ограничен одной
вертикалью `WeightMeasurement`.

Текущие schemas в `@shape-of-you/contracts` одновременно задают runtime
validation и TypeScript types. Переход на framework не должен создавать второй
набор DTO и расходящийся OpenAPI contract.

## Решение

Использовать последний стабильный совместимый NestJS как application framework
backend. На дату решения актуальна линия NestJS 11, а стабильный пакет
`@nestjs/core` имеет версию `11.1.28`.

Использовать `@nestjs/platform-fastify` и `FastifyAdapter` как HTTP provider.
Не переходить на Express без отдельного driver и ADR.

Сохранить:

- один deployable backend в `apps/api`;
- PostgreSQL, Drizzle ORM и Drizzle Kit;
- schema-first package `@shape-of-you/contracts`;
- единый runtime validation и OpenAPI source;
- существующие URL, status codes и error contracts;
- Fastify-compatible logging, graceful shutdown и health/readiness semantics.

Nest modules являются логическими application boundaries внутри modular
monolith, а не deployable services.

Для DEV-025 использовать последний стабильный Nuxt на момент начала
реализации web-клиента. На дату решения актуален Nuxt `4.5.1`. Nuxt обращается
к backend только через опубликованный API contract и не становится вторым
владельцем business rules. Nitro server routes не дублируют backend domain
logic.

Framework versions разрешаются в точные версии lockfile. Обновление stable
versions проходит обычные CI, compatibility и integration gates; формулировка
«последний стабильный» не разрешает автоматический production upgrade без
проверки.

## Рассмотренные альтернативы

- Оставить прямой Fastify API: минимальная стоимость сейчас, но оператор
  предпочитает единый Nest application model для растущего числа modules,
  dependency injection, guards, lifecycle и background workflows.
- NestJS с Express: стандартный Nest setup и широкая middleware ecosystem, но
  требует ненужной замены уже проверенного Fastify transport и его plugins.
- NestJS с FastifyAdapter: добавляет Nest application model и сохраняет
  существующий HTTP engine. Выбрано.
- Использовать Nuxt/Nitro как основной backend: уменьшает число frameworks в
  web-only системе, но смешивает frontend delivery и domain authority,
  усложняет будущий mobile client и нарушает принятое решение о едином backend
  contract.
- Дублировать contracts в Nest DTO-классах: удобно для стандартных decorators,
  но создаёт два источника validation и OpenAPI. Отклонено.

## Последствия

- Потребуется миграция bootstrap, routes, error handling, lifecycle и tests в
  Nest modules/controllers/providers.
- Fastify-specific transport details остаются только в bootstrap и adapters;
  domain и application layers не зависят от Nest или Fastify.
- Необходим небольшой spike интеграции существующих JSON Schemas с Nest
  validation и OpenAPI без дублирования contract definitions.
- Decorators, dependency injection и Nest lifecycle становятся runtime
  dependencies backend.
- Drizzle schema и рабочие данные не требуют изменения из-за framework
  migration.
- Nuxt не добавляется в workspace до утверждённого плана DEV-025.
- Текущий deployment topology с одним API image сохраняется.

## Проверка

- Все существующие endpoint behavior и OpenAPI contracts проходят regression
  tests до и после миграции.
- Unit и integration tests поднимают Nest application без обязательного
  network listener.
- FastifyAdapter слушает `0.0.0.0` в container runtime.
- Health, readiness, graceful shutdown и database pool lifecycle сохраняют
  текущую семантику.
- Docker image и synthetic staging smoke проходят без database migration.
- Nuxt version повторно проверяется по official release channel перед
  реализацией DEV-025.

## Связанные материалы

- [Superseded ADR Fastify](20260728-use-fastify-for-initial-http-api.md)
- [Backend runtime](../wiki/architecture/backend-runtime.md)
- [Репозиторий и runtime](../wiki/architecture/repository-and-runtime.md)
- [Завершённый план миграции backend на NestJS](../../plans/2026/07/completed/2026-07-29-migrate-api-runtime-to-nestjs.md)
- [План завершения DEV-023](../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
