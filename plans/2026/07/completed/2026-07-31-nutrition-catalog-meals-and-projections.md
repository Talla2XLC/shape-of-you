---
title: Реализация Nutrition catalog, Meal snapshots и дневных projections
status: completed
created: 2026-07-31
updated: 2026-07-31
related_roadmap_items:
  - DEV-023
related_board_items:
  - TASK-0015
---

# Реализация Nutrition catalog, Meal snapshots и дневных projections

## Цель

Добавить в существующий NestJS API вертикаль Nutrition: общий
версионируемый catalog без дублирования одинаковых справочников между
пользователями, персональные overlays и private items, неизменяемые факты
`Meal` с nutrient snapshots и дневные фактические totals.

## Утверждённая архитектура

- Решение зафиксировано в
  `docs/adr/20260731-use-layered-versioned-nutrition-catalog.md`.
- `Brand`, `Ingredient`, `Food` и immutable revisions принадлежат общему
  Nutrition catalog.
- Person-owned overlays не копируют canonical content.
- Private foods и recipes имеют явного владельца и private visibility.
- `Meal` является person-owned immutable fact с append-only correction.
- Meal item хранит typed nutrient snapshot независимо от catalog reference.
- Daily totals являются query projection, а не `DayRecord`.
- External ingestion использует staged source records; реальный connector в
  этот план не входит.

## Объём

### Входит

- Runtime JSON Schemas и TypeScript contracts в `packages/contracts`.
- Shared catalog identity и immutable revisions для brands, ingredients и
  foods.
- Immutable composition rows для точной `FoodVersion`.
- Person overlays и private catalog items.
- Source-neutral `CatalogSource`/`CatalogSourceRecord` и staged candidate
  lifecycle без network adapter.
- Person-owned `Meal`, snapshot items, create/read/list/history/correction.
- Query дневных totals по `Person` и `localDate`.
- Additive Drizzle migration и проверки clean/previous schema.
- OpenAPI, unit tests, PostgreSQL integration tests и canonical docs.

### Не входит

- Импорт реальных строк Google Sheets и изменение workbook.
- Выбор либо подключение внешнего API, dataset или scraper.
- Автоматический merge catalog candidates.
- Background scheduler, broker, worker или новый deployable.
- Natural-language intake и clarification.
- Nutrition targets, remaining macros, coaching и safety policies.
- `DayClosure`/`JournalDay`.
- Upload media и object-storage integration.

## Этапы

1. Уточнить implementation contract: exact entities, lifecycle, units,
   numeric ranges, endpoint paths и staged candidate statuses.
2. Добавить contracts и pure domain validation.
3. Добавить schema и одну additive migration с короткими PostgreSQL
   identifiers.
4. Реализовать repositories и transactions для catalog revisions, overlays,
   meals, corrections и daily totals.
5. Подключить Nest modules/controllers и OpenAPI.
6. Добавить synthetic unit и integration vectors без персональных данных.
7. Проверить clean migration и upgrade от текущей schema.
8. Провести independent Quality Review и Architecture Review.
9. После принятия синхронизировать current-state Wiki и перенести этот план в
   `completed/`.

## Критерии приёмки

1. Два `Person` используют одну shared catalog revision без копирования
   canonical ingredient/brand/food content.
2. Personal overlays и private items не изменяют shared revision и не
   раскрываются другому `Person`.
3. `FoodVersion` и composition immutable; новая версия не меняет предыдущую.
4. Meal create идемпотентен в person/source scope.
5. Meal correction создаёт полный replacement fact и сохраняет chain.
6. Каждый meal item сохраняет typed nutrient snapshot; изменение catalog не
   меняет историю.
7. Daily totals суммируют только current meals выбранной локальной даты.
8. Source record повторно импортируется идемпотентно, а похожие names не
   объединяются автоматически.
9. Existing Physical State endpoints и migrations не меняют поведение.
10. Runtime schemas, OpenAPI, unit, integration и documentation checks
    проходят.

## Проверки

- `pnpm lint`
- `pnpm --filter @shape-of-you/api typecheck`
- `pnpm --filter @shape-of-you/api build`
- `pnpm --filter @shape-of-you/api test:unit`
- `pnpm --filter @shape-of-you/api test:integration`
- clean-database migration и upgrade от текущего snapshot
- `node scripts/validate-docs.mjs`
- audit PostgreSQL identifiers: не более 63 bytes

## Риски и ограничения

- Единицы servings и composition нельзя автоматически конвертировать без
  утверждённых conversion rules; snapshot остаётся authority конкретного
  intake.
- Catalog matching по названию создаёт ложные объединения и запрещён как
  единственное условие.
- Shared catalog требует отдельной moderation policy до массового external
  ingestion.
- Private items требуют явных ownership constraints на database и application
  layers.
- Shared catalog moderation и production write authorization остаются
  отдельным security gate до multi-user runtime.

## Architecture Review до реализации

1. **Избыточная сложность:** один Nutrition module; нет generic catalog engine,
   microservice или provider-specific core schema.
2. **DDD:** reference catalog, personal preferences и Meal facts имеют разные
   ownership и lifecycle.
3. **Дублирование:** shared content не копируется по Person; meal nutrient
   snapshot является осознанной исторической фиксацией, а не второй catalog
   authority.
4. **Интеграции:** source-neutral boundary не вводит network dependency до
   выбора конкретного источника.
5. **Упрощение:** daily totals остаются query, пока измеренный workload не
   обоснует persisted projection.
