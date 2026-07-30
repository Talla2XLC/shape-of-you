---
id: "changelog"
kind: roadmap
title: "Журнал изменений"
status: draft
tags: []
---

# Журнал изменений

## Кратко

Базовый набор проектных знаний создан 2026-07-28. Подготовлены первый backend vertical и repository-local артефакты временного staging-развёртывания; live-проверки PostgreSQL, Docker Compose, VM и GitHub Actions остаются отдельными операционными воротами.

## Содержание

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
