---
id: "decisions-20260824-import-nutrition-as-one-typed-fitness-tracker-domain"
kind: adr
title: "Импортировать Nutrition как один типизированный домен Fitness Tracker"
status: accepted
date: 2026-08-24
supersedes: []
superseded_by: "decisions-20260825-import-partial-nutrition-and-source-day-closures"
tags:
  - "nutrition"
  - "data-migration"
  - "google-sheets"
  - "provenance"
---

# Импортировать Nutrition как один типизированный домен Fitness Tracker

## Context

Единый `Fitness Tracker importer` уже поддерживает Weight и Body через одну
команду, общий `dry-run|apply` lifecycle, неизменяемую source identity и
реляционный audit. Nutrition хранится не в одном изолированном листе, а в
связанном наборе `Brands`, `Ingredients`, `Foods`, `Food_Ingredients` и
`Meals`. Эти листы образуют один migration boundary: Meal может ссылаться на
Food, Food — на Brand и состав из Ingredients.

Google Sheets остаётся живым источником истины. Отдельный ChatGPT-проект
`Фитнес-трекер` продолжает писать operational data только в workbook, поэтому
importer не может считать источник неподвижным и не должен вводить direct
dual-write. 24 августа 2026 года оператор одобрил добавление `Meal_ID`; все 110
существующих Meal rows получили уникальные UUIDv4. Future writer обязан
создавать новый `Meal_ID` для каждой новой строки и никогда не менять или
переиспользовать его.

Лист `Meals` хранит только календарную дату, суммарные nutrients и описание
одной записанной порции. Он не хранит точное время или itemized quantities.
Photo markers не являются API-owned `Media` UUID. Каталожные данные частично
неполны: автоматический importer не может дополнять отсутствующие nutrients,
quantities или связи предположениями.

## Decision

### One Nutrition adapter and bounded snapshot

Добавить `nutrition` в существующую команду:

```text
fitness-tracker:import --domain nutrition --mode dry-run|apply
```

Один Nutrition adapter читает один versioned bounded snapshot ровно пяти
листов: `Brands`, `Ingredients`, `Foods`, `Food_Ingredients` и `Meals`. Это не
пять миграторов и не серия независимых apply. Snapshot содержит exact workbook
ID, numeric sheet IDs, workbook timezone, typed rows и source manifest checksum.

Live reader выполняет bounded reads, затем проверяет source sentinels. Если
живой writer изменил выбранный source rectangle во время чтения, run не
смешивает две версии данных: он завершается безопасным source-drift finding и
не получает право на apply. Google Sheets adapter не содержит write methods.

### Stable identity and provenance

Source identity строится из exact spreadsheet ID, numeric sheet ID и
обязательного стабильного ID соответствующего листа:

- `Brand_ID` для Brand;
- `Ingredient_ID` для Ingredient;
- `Food_ID` для Food;
- пара `Food_ID + Ingredient_ID` для composition row;
- `Meal_ID` для Meal.

Row number остаётся только audit locator. Пустой, некорректный или повторный ID
делает запись `invalid`; importer не заменяет его fingerprint или номером
строки. Content checksum отделён от identity и используется для reconciliation.
Созданные domain facts получают `SourceReference` с channel
`google_sheets`, exact external system/key, checksum и `import_batch_id`.

### Catalog mapping

Brands, Ingredients и Foods импортируются только как Person-owned private
catalog entities. Миграция не продвигает operator data в shared catalog.
Version rows неизменяемы и ссылаются на типизированную source record identity.

`Food_Ingredients` импортируется как composition конкретной Food version.
Food создаётся только когда его собственные nutrients валидны, каждая заявленная
composition reference разрешается однозначно и необходимые quantities/units
поддерживаются. Отсутствующие nutrients, quantity, неизвестная unit, broken
reference или несовместимые повторения становятся `invalid` или `conflict`;
состав не урезается молча.

### Meal mapping and temporal precision

Расширить `Meal` тем же temporal-precision pattern, что Weight и Body:

- добавить `meal_temporal_precision` со значениями `instant` и `local_date`;
- сделать `occurred_at` nullable;
- constraint требует timestamp для `instant` и `NULL` для `local_date`;
- existing Meals сохранить как `instant` без изменения значений;
- public output явно возвращает `temporalPrecision`, а `occurredAt` становится
  nullable;
- public HTTP/MCP create и correction продолжают требовать exact instant;
- date-only создание доступно только internal typed importer.

Одна legacy `Meals` row становится одним immutable `Meal` и одним snapshot
item. Это item представляет записанную строкой порцию: `quantity = 1`,
`unit = serving`, label берётся из `Description`, nutrients — из четырёх
source totals. Это явно зафиксированная единица source record, а не оценка веса
или состава. `Food_ID` превращается в `foodVersionId` только при точном
разрешении в валидный импортируемый Food; иначе Meal получает `conflict`, а
ссылка не отбрасывается.

Только `Breakfast`, `Lunch`, `Dinner` и `Snack` нормализуются в соответствующие
typed kinds без потери смысла. Compound или неизвестные labels не сворачиваются
автоматически в `other`: они дают `unsupported_meal_kind`, пока не появится
явное mapping/remediation решение. Непустой Photo marker даёт
`unsupported_photo_reference`; importer не скачивает media, не создаёт UUID и
не игнорирует marker. Пустые или некорректные nutrients делают Meal invalid.

### Relational audit and atomic apply

Nutrition использует общий `import_batches`, а известная source structure
сохраняется в domain-specific relational audit:

- `nutrition_brand_import_records`;
- `nutrition_ingredient_import_records`;
- `nutrition_food_import_records`;
- `nutrition_food_composition_import_records`;
- `nutrition_meal_import_records`.

Таблицы содержат typed normalized columns, outcome/finding, source checksum и
типизированный target foreign key. Generic fact payload, polymorphic target
link и JSON как замена известной модели запрещены. Existing catalog staging
JSON не становится migration fact model и не требуется для этого adapter.

Apply сохраняет общий all-or-nothing lifecycle. Любой `conflict` или `invalid`
сохраняет blocked batch и typed audit, но не создаёт ни catalog entity, ни Meal.
При чистой классификации одна PostgreSQL transaction создаёт только `created`,
оставляет `unchanged` неизменными и связывает provenance с batch. Retry того же
source/target snapshot возвращает существующий batch; importer не обновляет и
не исправляет existing facts автоматически.

## Considered alternatives

- **Пять отдельных миграторов или поэтапные Nutrition apply:** отклонено,
  потому что нарушает связанную целостность catalog/Meal и дублирует lifecycle.
- **Fingerprint как Meal identity:** отклонено; изменение содержимого выглядело
  бы удалением и новой записью. Durable `Meal_ID` отделяет identity от checksum.
- **Row number или date/kind как identity:** отклонено из-за перемещения строк
  и нескольких Meals одного вида в один день.
- **Подставлять полночь или полдень:** отклонено как выдуманное точное время.
- **Создавать Meal без item:** отклонено, потому что ломает существующий
  immutable snapshot aggregate. Source row честно моделируется как одна serving.
- **Считать неизвестные meal labels значением `other`:** отклонено до явного
  mapping, потому что compound semantics потерялись бы.
- **Игнорировать Photo или broken Food link:** отклонено как тихая потеря
  известного source evidence.
- **Импортировать неполный Food с урезанным composition:** отклонено; это
  создало бы другой факт, которого нет в source.
- **Использовать generic JSON import records:** отклонено; структура пяти
  листов известна и проверяется columns, constraints и foreign keys.
- **Partial apply валидных строк при наличии blockers:** отклонено для первого
  controlled backfill как менее проверяемое промежуточное состояние.

## Consequences

- Nutrition становится третьим adapter единого importer, а не отдельным tool.
- Первый live dry-run ожидаемо может показать blockers из текущих incomplete
  catalog rows, Photo markers и unsupported Meal labels; это корректный
  результат, а не повод выдумывать данные.
- Meal public read contract расширяется nullable `occurredAt` и
  `temporalPrecision`; write contract остаётся exact-instant only.
- Schema migration затрагивает существующие Meals и добавляет несколько typed
  audit tables, поэтому обязательны clean/every-prefix migration tests и
  статическая проверка 63-byte PostgreSQL identifier limit.
- ChatGPT writer contract на обязательный UUIDv4 `Meal_ID` является pre-cutover
  requirement. Сам importer не изменяет отдельный ChatGPT project.
- ADR не разрешает staging apply, recurring dual-run, cutover, authority
  transfer, writer switch или Google Sheets writes.

## Verification

- Unit tests покрывают five-sheet snapshot, source drift, identity, referential
  integrity, normalization и все четыре outcomes.
- Migration tests проверяют clean/every-prefix upgrade, existing Meal как
  `instant`, temporal constraint, relational audit FKs и identifier byte limit.
- PostgreSQL integration tests покрывают created/unchanged/conflict/invalid,
  blocked apply, exact retry, transaction atomicity и Person isolation.
- API/MCP/day/progress regression подтверждает nullable temporal output и
  exact-instant public writes.
- Реальный connector snapshot читает exact workbook только read-only; первый
  staging dry-run публикует только safe counts/findings без personal values.

## Related material

- [Unified importer and Weight temporal precision](20260821-use-relational-import-batches-and-explicit-weight-temporal-precision.md)
- [Pull import and exclusive writer cutover](20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Layered Nutrition catalog](20260731-use-layered-versioned-nutrition-catalog.md)
- [Typed provenance](20260730-use-typed-provenance-and-append-only-supersession.md)
- [Migration strategy](../wiki/architecture/migration-strategy.md)
- [TASK-0049 plan](../../plans/2026/08/completed/2026-08-24-task-0049-nutrition-importer.md)
