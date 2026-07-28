---
id: "architecture-drivers"
kind: architecture
title: "Архитектурные drivers"
status: draft
tags:
  - "architecture"
  - "drivers"
---

# Архитектурные drivers

## Кратко

Архитектуру определяют безопасная поддержка решений, непрерывность миграции, объяснимость, развитие домена и долгосрочная сопровождаемость, а не ранняя распределённость.

## Содержание

### Продуктовые drivers

- Сохранить и улучшить уже работающую систему Google Sheets.
- Поддерживать единый согласованный backend-контракт для web и mobile.
- Формировать безопасные и объяснимые ежедневные решения из longitudinal evidence.
- Сохранять подтверждение пользователя и provenance фактов и действий.

### Технические drivers

- Постепенная миграция через inventory, mapping, backfill, reconciliation, dual-run, cutover и rollback.
- Строгое владение данными без межсервисного SQL.
- Append-only evidence и idempotent processing там, где они определены.
- Разработка в modular monorepo; независимо выпускаемые deployables — только при наличии обоснования.
- Persistence в PostgreSQL с прозрачным доступом к SQL через Drizzle.

### Ограничения

Приняты Node.js, TypeScript, pnpm workspaces, PostgreSQL, Drizzle ORM/Kit и
Docker Compose для локальной разработки. Для throwaway staging утверждена
временная topology на общей VM; целевые cloud hosting и production topology
не определены. Новые сервисные границы, API capabilities и событийная
инфраструктура требуют отдельного проектирования.

## Основания

- Технический baseline, предоставленный оператором 2026-07-28.
- Существующие архитектурные ADR.

## Решения

- Drivers ограничивают будущие варианты, но не разрешают реализацию.

## Открытые вопросы

- Предположения о масштабе, объёмы данных, concurrency, availability, latency, recovery objectives, hosting и бюджет.
- Privacy, threat model и регуляторные требования.

## Связанные материалы

- `quality-attributes.md`
- `data-ownership.md`
- `deployment.md`
- `migration-strategy.md`
- `../domain/bounded-contexts.md`
