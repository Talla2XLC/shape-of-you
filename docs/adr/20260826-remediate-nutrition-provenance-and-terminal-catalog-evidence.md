---
id: "decisions-20260826-remediate-nutrition-provenance-and-terminal-catalog-evidence"
kind: adr
title: "Исправить provenance Nutrition-каталога и завершить неполные source-записи без ручного восстановления"
status: accepted
date: 2026-08-26
supersedes: []
superseded_by: null
tags:
  - "nutrition"
  - "data-migration"
  - "google-sheets"
  - "provenance"
---

# Исправить provenance Nutrition-каталога и завершить неполные source-записи без ручного восстановления

## Context

Единая TASK-0055 сверка обнаружила пятнадцать Nutrition conflicts. Три уже
созданных Brand факта имеют правильные значения, но их catalog source ошибочно
содержит numeric sheet ID листа `Foods` вместо `Brands`. Это дефект предыдущего
миграционного capture, а не изменение исходных Brand rows.

Остальные двенадцать conflicts относятся к структурно полным composition rows,
которые ссылаются на присутствующие в том же snapshot, но неимпортируемые
Ingredient/Food rows. Все девятнадцать Ingredients не содержат nutrients.
Семь Foods, напротив, содержат nutrients и отклоняются только потому, что
`Default_portion` является исходным текстовым описанием, а не чистым числом.

Оператор не хочет вручную восстанавливать исторические сведения. Google Sheets
остаётся read-only authority до cutover; факты нельзя перезаписывать, а
отсутствующие nutrients или quantities нельзя вычислять или придумывать.

## Decision

### Exact forward-only provenance remediation

Добавить идемпотентную PostgreSQL data migration только для известного класса
ошибки: private Brand version из exact workbook с source kind `brand`, где
catalog source содержит numeric sheet ID `Foods`, получает новый корректный
`CatalogSourceRecord` под source листа `Brands`. Existing Brand и BrandVersion
не создаются заново и их domain fields не меняются.

Неправильный source record не удаляется. Новый record копирует external ID,
checksum, parser version, status и capture metadata, после чего BrandVersion
перенаправляется на корректную identity. История Drizzle migration и сохранённый
старый record обеспечивают audit и дают данные для отдельного rollback, если он
понадобится. Generic автоматическая correction по имени или semantic similarity
по-прежнему запрещена.

### Source-defined Food serving

Непустой `Foods.Default_portion` означает одну определённую source-системой
порцию, для которой уже записаны calories и macros. Importer нормализует такую
строку как `referenceQuantity = 1`, `referenceUnit = serving` и сохраняет точное
исходное описание в typed `source_default_portion` audit field.

Importer не извлекает из свободного текста граммы, миллилитры или штуки и не
утверждает физический размер порции. Пустая portion или неполные nutrients
остаются `invalid`. Это позволяет создать семь доказуемых private FoodVersion
без выдумывания значений.

### Terminal invalid dependency evidence

Если catalog dependency с точной stable source identity присутствует в том же
snapshot, но сама source row уже классифицирована как structural `invalid`,
зависимая нормализованная row получает terminal `invalid` с typed audit, а не
`conflict`. Это применимо к Food→Brand и composition→Food/Ingredient links.

Если dependency ID отсутствует в snapshot, повторяется или разрешается
неоднозначно, результат остаётся `conflict`. Таким образом missing authority и
неоднозначность не маскируются под принятый historical gap.

Ingredients без nutrients и compositions без quantity не превращаются в
canonical catalog facts. Их известные поля, identity, checksum и причины
остаются typed relational evidence. Terminal invalid считается завершённым
результатом исторической миграции и не требует ручного backfill.

## Considered alternatives

- **Nullable nutrients и partial IngredientVersion:** отклонено как слишком
  широкое изменение catalog model и public contracts ради исторического
  reference evidence.
- **Не импортировать семь Foods:** безопасно, но теряет полные nutrient snapshots
  только из-за свободной формы portion label.
- **Парсить граммы/штуки из текста:** отклонено как хрупкая интерпретация.
  `1 serving` честно сохраняет границу исходной порции.
- **Автоматически исправлять provenance внутри обычного importer apply:**
  отклонено; повторный importer не должен исправлять existing facts или
  provenance без отдельного exact data migration.
- **Удалить неправильные source records:** отклонено из-за потери audit trail.
- **Считать все unresolved links terminal invalid:** отклонено; отсутствующая в
  snapshot dependency остаётся настоящим conflict.

## Consequences

- После deployment migration три Brand facts сохраняют identity и значения, но
  получают правильный catalog provenance.
- Семь Foods становятся private canonical records с source-defined serving и
  полными source nutrients.
- Неполные Ingredients/compositions остаются честным terminal evidence и не
  требуют ручного ввода.
- Финальная all-domain сверка должна иметь `created=0` и `conflict=0`; количество
  `invalid` увеличится, потому что двенадцать ложных conflicts станут terminal
  invalid.
- Решение не выполняет cutover, не меняет authority, не пишет Google Sheets и
  не ослабляет complete-only operational MCP contracts.

## Verification

- Migration integration проверяет clean/every-prefix upgrade, exact source-key
  correction, сохранение старого source record и отсутствие duplicate facts.
- Unit tests проверяют source-defined serving, exact portion audit, distinction
  между present-invalid и absent dependency.
- Nutrition integration проверяет apply семи Foods, terminal invalid audit и
  повторную идемпотентную сверку.
- Controlled staging выполняет migration, bounded read-only capture,
  all-domain dry-run/apply/recheck и сохраняет только safe counts.
- Проверяются PostgreSQL identifiers до 63 UTF-8 bytes.

## Related material

- [Partial Nutrition and source closures](20260825-import-partial-nutrition-and-source-day-closures.md)
- [Nutrition catalog](20260731-use-layered-versioned-nutrition-catalog.md)
- [Pull import and exclusive writer cutover](20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [TASK-0056 plan](../../plans/2026/08/completed/2026-08-26-task-0056-nutrition-provenance-and-terminal-evidence.md)
