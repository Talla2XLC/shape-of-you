---
id: "decisions-20260728-use-postgresql-with-drizzle-orm-and-kit"
kind: adr
title: "PostgreSQL с Drizzle ORM и Drizzle Kit"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "data"
  - "technology"
---

# PostgreSQL с Drizzle ORM и Drizzle Kit

## Контекст

Будущей платформе нужны реляционная целостность, прозрачный SQL, контролируемые миграции, специфичные возможности PostgreSQL и локальное владение схемой.

## Решение

После контролируемой миграции использовать PostgreSQL с Drizzle ORM и Drizzle Kit для persistence приложения.

Raw SQL разрешён для CTE, window functions, materialized views, специализированных индексов, JSONB, PostgreSQL extensions, backfill и сложных миграций.

## Рассмотренные альтернативы

- Prisma: более сильная абстракция и удобства экосистемы, но меньше прямого контроля SQL для миграционных и аналитических потребностей проекта.
- Только SQL: максимальная прозрачность, но больше повторяющегося mapping и работы с type safety.

## Последствия

Каждый будущий владелец данных поддерживает собственные схемы Drizzle и обычные SQL-миграции. ORM не должен скрывать владение или препятствовать применению необходимых возможностей PostgreSQL. Смена ORM требует заменяющего ADR с техническими доказательствами.

PostgreSQL пока не является authoritative source и этим ADR не создаётся. Версия PostgreSQL, hosting, extensions, backup и управление соединениями пока не определены.

## Проверка

- Решение и обоснование явно приняты оператором 2026-07-28.
- До утверждённой миграции authority остаётся в Google Sheets.

## Связанные материалы

- `../wiki/architecture/data-ownership.md`
- `../wiki/architecture/migration-strategy.md`
