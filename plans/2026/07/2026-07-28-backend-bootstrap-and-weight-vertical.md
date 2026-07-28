---
title: Backend bootstrap и вертикаль WeightMeasurement
status: active
created: 2026-07-28
updated: 2026-07-28
related_roadmap_items:
  - DEV-023
related_board_items:
  - TASK-0001
---

# Backend bootstrap и вертикаль WeightMeasurement

## Цель

Получить запускаемый modular backend Shape of You с одним deployable API,
PostgreSQL persistence и первой полной вертикалью `WeightMeasurement` от
runtime-validated HTTP contract до миграции и integration tests.

## Архитектурная позиция

- Сохраняется один deployable backend в `apps/api`; bounded contexts не
  превращаются в microservices.
- Используются принятые Node.js, TypeScript, pnpm workspace, PostgreSQL,
  Drizzle ORM/Kit и Docker Compose.
- HTTP framework — Fastify: его JSON Schema lifecycle, Pino logging,
  централизованный error handler и graceful shutdown дают требуемый bootstrap
  без дополнительного framework layer. Решение фиксируется отдельным ADR.
- API schemas в `packages/contracts` являются runtime JSON Schema и источником
  TypeScript inference и OpenAPI; domain implementation туда не попадает.
- Google Sheets остаётся authoritative source. PostgreSQL в DEV-023 хранит
  только новые факты API и не включает dual-write, backfill или cutover.

## Scope

### В объёме

- Root pnpm workspace и строгая TypeScript-конфигурация.
- Реально используемые packages `contracts` и `config`.
- Fastify API с structured logging, единым error handler, graceful shutdown,
  `/health` и PostgreSQL-aware `/ready`.
- Drizzle schema и версионируемая SQL migration.
- `POST /v1/weight-measurements`,
  `GET /v1/weight-measurements`,
  `GET /v1/weight-measurements/:id`.
- Идемпотентность по `dedupeKey`.
- Stable cursor pagination по `(measuredAt DESC, id DESC)`.
- Dockerfile API и Docker Compose для API/PostgreSQL.
- Unit и integration tests с изолированным PostgreSQL container.
- Только необходимые canonical Markdown страницы и ADR.

### Вне объёма

- Auth, frontend, Garmin, питание, тренировки, Coach Planner.
- Несколько deployable services, event bus, Kafka, Kubernetes.
- Dual-write, backfill, переключение source of truth и изменение Google Sheets.
- Corrections через overwrite, универсальный repository framework или generic
  CRUD layer.
- Production deployment, secrets, staging и Git commit.

## Зафиксированные доменные решения

- `weightKg` хранится как `numeric(6,3)` и принимается в диапазоне
  `0.500..700.000` kg. Это защитный диапазон данных, не медицинская норма.
- `confidence` nullable, хранится как `numeric(4,3)` и при наличии находится в
  диапазоне `0..1`.
- `timezone` проверяется как IANA zone через `Intl.DateTimeFormat`.
- `localDate` вычисляется сервером из `measuredAt` в указанной `timezone`;
  клиент не управляет этим derived field.
- Unique constraint по `dedupeKey` обеспечивает идемпотентность. Повторный POST
  возвращает исходный факт и не выполняет overwrite.
- `sourceRecordId` nullable; `provenance` обязателен как JSON object.

## Этапы

1. Принять ADR выбора Fastify и проверить согласованность с существующими ADR.
2. Создать workspace manifests, TypeScript config и реальные packages
   `contracts`/`config`.
3. Создать `apps/api` с конфигурацией, logging, lifecycle и health/readiness.
4. Добавить Drizzle schema, SQL migration и migration runner.
5. Реализовать `WeightMeasurement` repository и HTTP routes.
6. Генерировать OpenAPI из тех же route schemas и проверить документ тестом.
7. Добавить Dockerfile, Compose и integration tests с PostgreSQL.
8. Обновить runtime/backend overview, локальный запуск, модель,
   API contract и migration notes в canonical Markdown.
9. Выполнить lint, typecheck, build, tests, migration-on-clean-database,
   documentation validator и, если Docker доступен, Compose smoke.
10. Выполнить независимый Quality Review и Architecture Review.

## Критерии готовности

- `docker compose up --build` описывает и при доступном Docker поднимает
  PostgreSQL и API.
- `/health` не зависит от БД; `/ready` возвращает non-2xx при недоступной БД.
- Миграция создаёт `weight_measurements` на чистой PostgreSQL.
- API создаёт, повторно получает по `dedupeKey`, читает по ID и возвращает
  стабильный paginated list.
- Некорректные `weightKg`, `timezone` и derived-date input отклоняются.
- OpenAPI строится из runtime schemas без отдельного ручного контракта.
- `lint`, `typecheck`, `build`, tests и `scripts/validate-docs.ps1` проходят.
- Непроверенные из-за отсутствующего локального Docker действия явно
  перечислены, а не считаются пройденными.

## Риски и восстановление

- Актуальные major versions dependencies могут потребовать совместимых API;
  версии фиксируются lockfile, а несовместимость выявляется build/tests.
- Integration tests и Compose smoke требуют Docker daemon. При его отсутствии
  код, manifests и unit-level checks выполняются, а container checks остаются
  видимым blocker для полного acceptance.
- Изменения только добавляют новый runtime; rollback до commit выполняется
  удалением добавленных implementation artifacts. Production data и
  production infrastructure не затрагиваются.

## Architecture Review

- Избыточная сложность не выявлена: реализация ограничена одним deployable API,
  двумя используемыми workspace packages и одним доменным модулем без generic
  repository или дополнительного framework layer.
- Преждевременные microservices и новые deployable boundaries не добавлены.
  PostgreSQL, migrations, credentials и integration tests принадлежат
  `apps/api`.
- Доменная модель сохраняет `WeightMeasurement` как неизменяемый факт;
  идемпотентность не превращена в скрытый overwrite.
- Authority не дублируется: ADR фиксирует выбор Fastify, Wiki описывает текущее
  состояние, а этот план — выполнение и проверку.
- Упростить решение без потери заданных гарантий можно только удалением
  обязательных частей vertical slice. Event bus, abstractions для будущих
  сервисов и универсальные CRUD-слои сознательно не добавлены.
- Architecture Review не выявил оснований менять принятую архитектуру или
  создавать superseding ADR.

## Результат

- Созданы pnpm workspace, packages `config` и `contracts`, Fastify API,
  PostgreSQL/Drizzle persistence, версионируемая migration, OpenAPI,
  Dockerfile и Docker Compose.
- Реализованы health/readiness и полный HTTP vertical `WeightMeasurement`:
  создание, идемпотентный повтор, чтение по ID и cursor pagination.
- Добавлены unit и PostgreSQL integration tests, canonical Wiki и ADR выбора
  HTTP framework. `apps/api/AGENTS.md` оформлен на английском согласно правилу
  workspace.
- Успешно выполнены `typecheck`, `build`, `lint`, четыре unit-теста,
  `scripts/validate-docs.ps1` и process smoke: `/health` вернул `200`, а
  `/ready` при недоступной БД — `503`.
- Production-like deploy artifact проверен отдельно: он запускается без
  devDependencies; Vitest в него не входит.
- В текущей среде отсутствует Docker daemon. Поэтому integration tests,
  migration на чистой PostgreSQL и `docker compose up --build` не могли быть
  фактически выполнены и остаются blocker полного quality acceptance. План
  сохраняет статус `active` до выполнения этих проверок в Docker-capable среде.
