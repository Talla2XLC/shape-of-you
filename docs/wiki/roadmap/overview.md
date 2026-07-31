---
id: "roadmap-overview"
kind: roadmap
title: "Обзор roadmap"
status: draft
tags:
  - "delivery"
  - "roadmap"
---

# Обзор roadmap

## Кратко

Предварительный roadmap последовательно охватывает foundation, извлечение backend, контролируемую миграцию данных, web MVP и mobile client.

## Содержание

### Последовательность

1. **DEV-027 — Workspace and baseline — завершён**: baseline репозитория, canonical Markdown Wiki и ADR, планы и документация Product/Domain/Architecture.
2. **DEV-023 — Backend API and domain extraction — выполняется**: создать
   стабильный backend-контракт и извлечь доменную логику из Google Sheets без
   преждевременного переноса authority данных. Завершены backend bootstrap,
   person/access/provenance foundation и первая вертикаль `WeightMeasurement`
   с corrections, Physical State/Goals, Nutrition catalog/Meals и Training and
   Performance; Recovery, Coaching, Intake и общий day lifecycle ещё не
   реализованы.
3. **DEV-024 — PostgreSQL migration and dual-run**: inventory, mapping, backfill, reconciliation, контролируемое сосуществование, критерии cutover и rollback.
4. **DEV-025 — Web MVP**: выпустить первый web-клиент, использующий стабильный backend-контракт.
5. **DEV-026 — Mobile client**: добавить мобильный доступ через тот же backend-контракт.

### Обязательные gates

- Review продукта и bounded contexts до проектирования конкретных сервисов.
- Утверждение архитектуры и ADR до реализации.
- Стабильный backend-контракт до реализации web или mobile.
- Проверенный dual-run и cutover до передачи authority PostgreSQL.
- Architecture Review перед завершением каждой крупной задачи.

## Основания

- Предварительный roadmap, предоставленный оператором 2026-07-28.

## Решения

- Последовательность принята как предварительный roadmap, а не как детальная оценка сроков.

## Открытые вопросы

- Приоритеты предметных вертикалей внутри DEV-023 после восстановления полного behavior catalog Google Sheets.
- Scope, зависимости, acceptance criteria и оценки DEV-024—DEV-026.
- Связана ли нумерация DEV с внешним tracker.

## Связанные материалы

- [Границы продукта](../product/scope.md)
- [Стратегия миграции](../architecture/migration-strategy.md)
- [Репозиторий и runtime](../architecture/repository-and-runtime.md)
- [План завершения DEV-023](../../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
