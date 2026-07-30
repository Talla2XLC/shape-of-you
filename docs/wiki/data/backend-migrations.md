---
id: "data-backend-migrations"
kind: data
title: "Backend migration notes"
status: draft
tags:
  - "drizzle"
  - "migration"
  - "postgresql"
---

# Backend migration notes

## Кратко

Schema PostgreSQL описана Drizzle-кодом в `apps/api/src/database/schema.ts`;
версионируемая SQL migration хранится в `apps/api/drizzle/`.

## Содержание

Migration flow:

```powershell
pnpm db:generate
pnpm db:migrate
```

Compiled migration runner входит в API image, но обычный API process его не
запускает. В local Compose migration выполняет отдельный service `migrate`. Во
временном staging тот же API image digest запускается как one-shot service
перед обновлением API. Drizzle ведёт migration journal и применяет только ещё
не выполненные SQL files.

Первая migration создаёт enum `weight_measurement_source` и исходную таблицу
`weight_measurements`. Вторая migration добавляет `Person`, `User`,
`PersonAccessGrant`, `SourceReference`, person-scoped dedupe и append-only
supersession constraints. Существующие synthetic weight rows получают
фиксированного synthetic `Person`, а прежний JSONB `provenance` переносится в
private raw snapshot соответствующего `SourceReference`.

Обе траектории проверяются integration tests: применение на чистой БД и upgrade
с исходной schema и существующим synthetic fact. Миграция не импортирует Google
Sheets, не выполняет backfill рабочих данных и не меняет authority.

Изменение существующей принятой migration после её применения запрещено.
Следующее изменение schema создаёт новый migration file.

## Основания

- `apps/api/drizzle/20260728183725_real_vermin.sql`.
- `apps/api/drizzle/20260730131840_person_identity_provenance_corrections.sql`.
- `apps/api/src/database/migrate.ts`.
- Drizzle schema и integration test чистой БД.

## Решения

- Используется codebase-first flow `drizzle-kit generate` и
  `drizzle-orm` migrator.
- `drizzle-kit push` не является delivery path.

## Открытые вопросы

- Первая staging migration на отдельной `shape_of_you_api` проверена 2026-07-29.
  Применение второй migration на VM требует отдельного deployment approval;
  локальные clean/upgrade integration tests пройдены.
- Согласованная с владельцем общего cluster retention policy.

## Связанные материалы

- [PostgreSQL с Drizzle](../../adr/20260728-use-postgresql-with-drizzle-orm-and-kit.md)
- [Локальный запуск](../architecture/local-development.md)
- [WeightMeasurement](../domain/weight-measurement.md)
- [Временный deployment](../operations/temporary-vm-deployment.md)
- [Rollback](../operations/temporary-vm-rollback.md)
