---
id: "changelog"
kind: roadmap
title: "Журнал изменений"
status: draft
tags: []
---

# Журнал изменений

## Кратко

Базовый набор проектных знаний создан 2026-07-28. Реализованы основные backend
verticals DEV-023 и основа асинхронного Intake; production parser, общий day
lifecycle и перенос реальных данных Google Sheets остаются отдельными этапами.

## Содержание

### 2026-08-02 — Intake requests, очередь и маршрут WeightMeasurement

- Реализован асинхронный `IntakeRequest`: API принимает исходный текст с
  `202 Accepted`, обеспечивает person/source-scoped idempotency и возвращает
  вычисляемое состояние обработки.
- Добавлены независимые typed items, item-level clarification и confirmation,
  отдельная реляционная detail table для веса и append-only audit timeline без
  универсальных JSON/JSONB payload.
- PostgreSQL-очередь использует lease, `SKIP LOCKED`, ограниченные повторы,
  backoff и terminal state без Kafka, внешнего broker или нового service.
- Первый маршрут atomically создаёт или находит `WeightMeasurement`, завершает
  item и сохраняет типизированную ссылку на доменный факт.
- Полный набор из 64 tests прошёл, включая concurrent dedupe, lease reclaim,
  terminal failure и каждый migration journal prefix; также прошли typecheck,
  build, lint и canonical docs validation.
- Production AI parser и остальные typed routes явно оставлены следующими
  срезами; без parser задания сохраняются и не нарушают readiness API.

### 2026-07-31 — Nutrition catalog, Meal snapshots и daily totals

- Реализован layered catalog: shared immutable brands, ingredients и foods,
  private items и Person-owned food overlays без копирования canonical content.
- `FoodVersion` фиксирует composition по точным Ingredient revisions; shared
  version не может зависеть от private definition.
- Реализованы immutable `Meal` snapshots, idempotent create, append-only
  corrections, current/history reads и query-only daily totals.
- Добавлена source-neutral staging schema для будущих external catalogs без
  network adapter, scraper, scheduler или автоматического merge.
- Clean и upgrade migrations проверены на PostgreSQL 17; пройдены 16 unit и
  16 integration tests, typecheck, build, lint и canonical docs validation.
- Реальные строки Google Sheets, production/staging database и внешние
  источники не изменялись.

### 2026-07-30 — Physical State measurements and versioned goals

- Реализован `BodyMeasurementSession` с typed values, person-scoped
  idempotency, append-only corrections, current list и полной history chain.
- Реализован `PhysicalGoal`: narrative/dynamic criteria, immutable versions,
  optimistic activation и terminal lifecycle.
- Общий PostgreSQL enum переименован в `source_channel`; composite foreign keys
  защищают goal/person ownership.
- Добавлена pure reconciliation policy для `Weight` и `Daily_Log.Weight`,
  которая сообщает mismatch и не создаёт второй domain fact.
- Локально пройдены lint, typecheck, build, 12 unit tests, 11 PostgreSQL 17
  integration tests и проверка canonical documentation.
- Реальные строки Google Sheets не читались тестами и не переносились в БД;
  staging deployment и VM migration не выполнялись.

### 2026-07-30 — Person identity, provenance and corrections

- Разделены authentication `User`, владелец fitness-данных `Person` и
  many-to-many `PersonAccessGrant`.
- `WeightMeasurement` переведён на person-scoped dedupe и typed
  `SourceReference`; произвольный публичный JSONB `provenance` удалён.
- Реализованы append-only corrections, current-state list и полная history
  chain без перезаписи исходных фактов.
- Добавлена data-preserving migration; clean и legacy-upgrade траектории
  проверены PostgreSQL integration tests.
- Google Sheets остаётся authoritative source; рабочие данные не переносились,
  VM migration и deployment не выполнялись.

### 2026-07-29 — Backend Bootstrap and Staging Delivery

- Создан modular monorepo на Node.js, TypeScript и pnpm с одним deployable API.
- Реализован первый `WeightMeasurement` vertical: контракты, HTTP API, доменная модель, PostgreSQL schema и Drizzle migrations.
- Добавлены локальные Dockerfile и Compose topology с отдельным one-shot migration service.
- Подготовлены repository-local staging-артефакты: production Compose, nginx routing, smoke/rollback scripts и GitHub Actions для quality, GHCR и ручного deployment.
- Зафиксировано подключение API к отдельной базе и credentials в существующем PostgreSQL-контейнере без cross-service SQL.
- Локально прошли `lint`, `typecheck`, `build`, unit tests и проверка канонической документации.
- Bootstrap принят с известным ограничением: PostgreSQL integration tests, clean-database migration, Compose runtime, VM deployment и GitHub Actions ещё не подтверждены live-evidence.

### 2026-07-28 — Discovery and Architecture Baseline

- Инициализирован единый Git-репозиторий и workspace 4DreamTeam.
- Зафиксированы решения по modular monorepo, автономности сервисов, межсервисному взаимодействию и обязательному Architecture Review.
- Добавлены vision, product scope, доменный язык, draft bounded contexts, архитектурные drivers, quality attributes, владение данными, ограничения репозитория и runtime, стратегия миграции и roadmap.
- Google Sheets сохранён как authoritative operational source до проверенного dual-run и cutover.
- Каноническими источниками Wiki и ADR стали Markdown-файлы в `docs/wiki/` и `docs/adr/`; 4DreamTeam сохранён для board, memory, sources и workflow.
- Сохранены пять draft bounded contexts; широкий `DayRecord` отклонён в пользу независимо принадлежащих фактов и projections.
- Документация для людей переведена на русский язык с сохранением технических имён, путей и стабильных идентификаторов.
- Бизнес-сервисы, application code, manifests, базы данных и runtime configuration не создавались.

## Основания

- Каноническое состояние Wiki и ADR в этом репозитории.
- [Завершённый план discovery](../../plans/2026/07/completed/2026-07-28-discovery-and-architecture-baseline.md).

## Решения

- Этот журнал кратко описывает состояние документации и не заменяет обоснование в ADR или отчёты о выполнении планов.

## Открытые вопросы

- Получить live-evidence для PostgreSQL integration tests, clean-database migration и Docker Compose.
- Проверить staging topology, migrations, smoke checks и rollback на временной VM после отдельных операционных approvals.

## Связанные материалы

- [Начало работы](start/overview.md)
- [Roadmap](roadmap/overview.md)
- [Обзор архитектуры](architecture/overview.md)
