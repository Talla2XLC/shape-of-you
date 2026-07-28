---
id: "architecture-overview"
kind: architecture
title: "Обзор архитектуры"
status: draft
tags: []
---

# Обзор архитектуры

## Кратко

Shape of You — долгосрочная production-платформа, развиваемая по принципу architecture-first и организованная как modular monorepo. Начальный runtime представлен одним deployable Fastify API с PostgreSQL и первой вертикалью `WeightMeasurement`.

## Содержание

### Текущее состояние

Репозиторий содержит workspace 4DreamTeam, canonical Markdown, версионируемые планы, pnpm workspace и один deployable backend в `apps/api`. PostgreSQL хранит факты, созданные новым API, но Google Sheets остаётся authoritative source fitness-данных до отдельного dual-run и cutover.

### Принятый фундамент

- Modular monorepo с единым корнем репозитория и workspace.
- Node.js, TypeScript и pnpm workspaces.
- PostgreSQL с Drizzle ORM и Drizzle Kit.
- Docker Compose для локальной разработки.
- Единый backend как authority бизнес-правил для web- и mobile-клиентов.
- Строгие границы deployable service и владения данными, когда появление deployables обосновано.
- Запрет межсервисного SQL; взаимодействие через API, события или опубликованные read model.

### Текущая позиция

Bounded contexts — логические границы, а не deployable services. Текущая реализация — один modular backend; внутри него первая предметная вертикаль отделяет transport schemas, domain validation и PostgreSQL repository без generic CRUD abstraction. Новая deployable boundary по-прежнему требует отдельного driver и ADR.

## Основания

- Baseline, предоставленный оператором 2026-07-28.
- Принятые ADR.
- Проверка репозитория подтверждает отсутствие runtime реализации.

## Решения

- Подробные решения и обоснования находятся в связанных ADR.
- Крупные задачи проходят Architecture Review по правилам корневого `AGENTS.md`.

## Открытые вопросы

- Модульные границы следующих предметных вертикалей внутри одного backend.
- Контракты будущих API и событий за пределами `WeightMeasurement`.
- Production hosting, security, observability, data policy и измеримые SLO.

## Связанные материалы

- `drivers.md`
- `quality-attributes.md`
- `data-ownership.md`
- `repository-and-runtime.md`
- `migration-strategy.md`
- `../domain/bounded-contexts.md`
