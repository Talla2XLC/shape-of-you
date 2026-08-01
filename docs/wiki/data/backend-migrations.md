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

Третья migration переименовывает общий enum в `source_channel` без изменения
значений и добавляет `BodyMeasurementSession`, typed values, `PhysicalGoal`,
immutable goal versions и criteria. Четвёртая усиливает ownership: composite
foreign keys запрещают связать goal с current version другого goal или
`Person`.

Пятая migration добавляет layered Nutrition catalog, immutable versions и
composition, Person-owned food overlays, source-neutral staged catalog
records, `Meal` snapshots и append-only corrections. Checks разделяют shared
и private ownership, composite foreign keys фиксируют принадлежность current
version своему root, а короткие explicit constraint names не превышают предел
PostgreSQL identifier.

Шестая migration добавляет shared/private справочник упражнений, его
неизменяемые версии и персональные настройки, source-neutral staging внешних
записей, person-owned версии программ, тренировочные сессии, выполненные
упражнения и отдельные подходы. Composite foreign keys закрепляют версии за
своими корнями и `Person`, partial unique index допускает не более одной
активной программы, а append-only constraints защищают историю corrections.

Седьмая migration добавляет Recovery and Readiness: providers, connections,
consents, devices, typed observations, versioned assessment policies и
assessments с evidence. Восьмая migration добавляет Coaching: versioned
policies, person-owned recommendations, решения пользователя, training
adjustment details и evidence из Recovery и Training.

Центральный migration integration test проверяет применение полного journal на
чистой БД, повторный idempotent запуск и upgrade каждого зафиксированного
непустого префикса journal до текущего состояния через реальный Drizzle
migrator. После каждого шага проверяются порядок, `created_at` и SHA-256 SQL
files в `drizzle.__drizzle_migrations`. Отдельный WeightMeasurement test
сохраняет проверку переноса synthetic legacy fact. Migration chain не
импортирует Google Sheets, не выполняет backfill рабочих данных и не меняет
authority.

Изменение существующей принятой migration после её применения запрещено.
Следующее изменение schema создаёт новый migration file.

## Основания

- `apps/api/drizzle/20260728183725_real_vermin.sql`.
- `apps/api/drizzle/20260730131840_person_identity_provenance_corrections.sql`.
- `apps/api/drizzle/20260730185405_physical_state_goals.sql`.
- `apps/api/drizzle/20260730191405_enforce_goal_ownership.sql`.
- `apps/api/drizzle/20260731090108_rare_zarda.sql`.
- `apps/api/drizzle/20260731125414_fixed_pete_wisdom.sql`.
- `apps/api/drizzle/20260731152211_hesitant_maggott.sql`.
- `apps/api/drizzle/20260731161722_useful_molten_man.sql`.
- `apps/api/src/database/migrate.ts`.
- `apps/api/test/migrations.integration.test.ts`.
- Drizzle schema и domain integration tests.

## Решения

- Используется codebase-first flow `drizzle-kit generate` и
  `drizzle-orm` migrator.
- `drizzle-kit push` не является delivery path.

## Открытые вопросы

- Staging migration chain до Coaching включительно применена через
  автоматизированный migration service и проверена smoke tests 2026-08-01.
- Согласованная с владельцем общего cluster retention policy.

## Связанные материалы

- [PostgreSQL с Drizzle](../../adr/20260728-use-postgresql-with-drizzle-orm-and-kit.md)
- [Локальный запуск](../architecture/local-development.md)
- [WeightMeasurement](../domain/weight-measurement.md)
- [BodyMeasurementSession](../domain/body-measurement-session.md)
- [PhysicalGoal](../domain/physical-goal.md)
- [Nutrition catalog](../domain/nutrition-catalog.md)
- [Meal](../domain/meal.md)
- [Training and Performance](../domain/training-and-performance.md)
- [Временный deployment](../operations/temporary-vm-deployment.md)
- [Rollback](../operations/temporary-vm-rollback.md)
