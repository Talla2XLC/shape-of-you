---
id: "architecture-overview"
kind: architecture
title: "Обзор архитектуры"
status: draft
tags: []
---

# Обзор архитектуры

## Кратко

Shape of You — долгосрочная production-платформа, развиваемая по принципу
architecture-first и организованная как modular monorepo. Текущий runtime
представлен одним deployable NestJS API с `FastifyAdapter`, PostgreSQL и первой
вертикалью `WeightMeasurement`. Будущий web-клиент использует Nuxt и тот же
backend contract.

## Содержание

### Текущее состояние

Репозиторий содержит workspace 4DreamTeam, canonical Markdown, версионируемые планы, pnpm workspace и один deployable backend в `apps/api`. PostgreSQL хранит факты, созданные новым API, но Google Sheets остаётся authoritative source fitness-данных до отдельного dual-run и cutover.

### Принятый фундамент

- Modular monorepo с единым корнем репозитория и workspace.
- Node.js, TypeScript и pnpm workspaces.
- PostgreSQL с Drizzle ORM и Drizzle Kit.
- Docker Compose для локальной разработки.
- Единый backend как authority бизнес-правил для web- и mobile-клиентов.
- NestJS с FastifyAdapter как текущий backend runtime.
- Nuxt как framework будущего web-клиента без дублирования backend logic.
- PostgreSQL transactional outbox до появления измеримых оснований для Kafka.
- PostgreSQL для revocable authentication sessions без обязательного Redis.
- Private S3-compatible object storage для будущих пользовательских media.
- Строгие границы deployable service и владения данными, когда появление deployables обосновано.
- Запрет межсервисного SQL; взаимодействие через API, события или опубликованные read model.

### Текущая позиция

Bounded contexts — логические границы, а не deployable services. Текущая
реализация — один modular backend; Nest modules сохраняют единую deployable
topology. Внутри backend transport schemas, domain validation и PostgreSQL
repositories разделены без generic CRUD abstraction. Новая deployable boundary
или Kafka требуют отдельного подтверждённого driver и ADR.

## Основания

- Baseline, предоставленный оператором 2026-07-28.
- Принятые ADR.
- Проверка фактического NestJS runtime, PostgreSQL integration tests и
  production Docker image.

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
- `stateful-infrastructure.md`
- `migration-strategy.md`
- `../domain/bounded-contexts.md`
