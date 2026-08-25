---
id: "decisions-20260825-import-partial-nutrition-and-source-day-closures"
kind: adr
title: "Импортировать частичные Nutrition-факты и закрытие дней без ручного восстановления"
status: accepted
date: 2026-08-25
supersedes: ["decisions-20260824-import-nutrition-as-one-typed-fitness-tracker-domain"]
superseded_by: null
tags:
  - "nutrition"
  - "day-closure"
  - "data-migration"
  - "google-sheets"
  - "provenance"
---

# Импортировать частичные Nutrition-факты и закрытие дней без ручного восстановления

## Context

Первый Nutrition dry-run единого `Fitness Tracker importer` подтвердил, что
исторические строки содержат полезные факты, но часть данных неполна: у одной
Meal отсутствуют nutrients, Photo содержит source marker, несколько meal labels
не входят в публичный enum, каталожные Ingredients не имеют nutrients, а часть
composition rows не имеет quantity. Прежнее решение блокировало весь Nutrition
apply при любом таком результате. Это означало бы потерю корректных Meals или
ручное восстановление сведений, которых оператор уже не помнит.

`Daily_Log.DayStatus` также является частью живого operational workflow. После
явного закрытия исторических дней Google Sheets содержит окончательное
пользовательское решение `Closed`. Наличие Workout не является условием
закрытия: Training выполняется только когда пользователь может заниматься.

Google Sheets до cutover остаётся источником истины и отдельный ChatGPT writer
пишет только туда. Importer читает Sheets; direct dual-write запрещён. В рамках
этого решения cutover, переключение writer и изменение Sheets не выполняются.

## Decision

### One importer, identity-scoped reconciliation

Сохранить одну команду и один Nutrition adapter пяти связанных листов. Отменить
глобальное правило «любой blocker запрещает создание всех Nutrition facts».
Каждая стабильная source identity получает собственный результат
`created|unchanged|conflict|invalid`; apply выполняется одной PostgreSQL
transaction, но создаёт все независимые `created` records. Ошибка зависимости
блокирует только зависимый component, а не несвязанные Meals или Brands.

Повторный запуск использует тот же durable source ID и checksum, не создаёт
duplicate и не перезаписывает существующий факт. Пустой или повторный durable ID
остаётся structural `invalid`: fingerprint, row number или date/kind не могут
подменять identity. Автоматический backfill ID в Sheets требует отдельного
явного разрешения оператора.

### Partial legacy Meals without invented values

Internal importer может создать immutable historical Meal, у которого один или
несколько nutrient components неизвестны. В relational model nullable nutrient
columns означают именно `unknown`; ноль остаётся известным числом и никогда не
используется как подстановка. Meal получает explicit completeness
`complete|partial`.

Публичные HTTP/MCP create и correction contracts продолжают требовать полный
набор nutrients. Partial shape является возможностью чтения и controlled import,
а не ослаблением operational writer contract. Meal и daily projections
возвращают nullable exact totals и completeness; если хотя бы один включённый
item не содержит component, exact total этого component равен `null`, а не
сумме известных значений, выданной за полный итог.

Известные legacy labels `All day`, `Evening drink`, `Evening drinks`,
`Lunch add-on` и `Lunch-Dinner` детерминированно отображаются в `other`.
Исходный label сохраняется в typed import evidence. Photo marker сохраняется
как nullable source photo reference; importer не скачивает media и не создаёт
фиктивный Media UUID. Source `Food_ID` сохраняется даже когда target Food нельзя
создать; отсутствие разрешённой catalog-ссылки не блокирует сам Meal.

### Incomplete catalog as typed source evidence

Неполные Ingredient, Food или composition rows не превращаются в придуманные
canonical catalog entities. Их известные columns, completeness, source identity
и reconciliation outcome сохраняются в существующем typed relational audit.
Это принятый конечный результат исторического импорта, а не очередь ручной
доработки. Полные независимые catalog records могут быть созданы автоматически.

### Import source-authoritative DayClosure

Nutrition snapshot расширяется bounded typed read листа `Daily_Log` в той же
source version. Строка с `DayStatus = Closed` создаёт idempotent `DayClosure`
с `source = google_sheets` только после создания всех доступных same-run facts
за эту дату. Snapshot closure фиксирует текущие typed facts и Nutrition
completeness. Partial Nutrition не запрещает closure: закрытие означает
пользовательское завершение дня, а не полноту каждого измерения.

Отсутствие Workout никогда не является blocker. `Open`, `Partial`, пустой или
неподдерживаемый source status не создаёт active closure. Existing active
closure с тем же snapshot является `unchanged`; несовместимый existing closure
даёт `conflict` и не перезаписывается. Source row identity, checksum, locator и
status сохраняются в отдельном typed relational DayClosure import audit.

## Considered alternatives

- **Оставить global all-or-nothing apply:** отклонено, потому что одна неполная
  catalog row или photo marker скрывает десятки независимых корректных Meals.
- **Разделить Meals, catalog и closures на отдельные миграторы:** отклонено;
  нужен один source snapshot, один lifecycle и порядок dependencies внутри
  общего importer.
- **Подставить нули или вычислить остаток по Daily_Log:** отклонено как
  выдумывание. Для неполной даты Daily_Log totals также отсутствуют.
- **Потребовать ручное восстановление:** отклонено оператором; исторические
  неизвестные остаются явно неизвестными и не мешают закрыть день.
- **Не создавать partial Meal и хранить только audit:** отклонено, потому что
  day history потеряет реально записанный приём пищи.
- **Хранить source rows целиком в JSON:** отклонено; структура известна и
  моделируется typed relational columns.
- **Считать отсутствие Training признаком незакрытого дня:** отклонено как
  неверное продуктовое правило.

## Consequences

- Existing complete operational contracts не ослабляются, но read contracts
  явно показывают partial historical evidence.
- Nutrition apply становится dependency-scoped и сохраняет одну транзакцию,
  один adapter и общий batch lifecycle.
- Typed audit schema расширяется raw meal kind, photo reference, unresolved
  Food source key, nullable nutrients и completeness.
- `Daily_Log` входит в Nutrition import snapshot только для lifecycle mapping;
  это не делает Nutrition owner других Daily_Log projections.
- ID-less live Meal останется `invalid` до отдельно разрешённого автоматического
  backfill; остальные факты и закрытые дни импортируются без ручного ремонта.
- Решение не разрешает staging apply, recurring schedule, cutover, writer
  switch, rollback execution или Google Sheets writes.

## Verification

- Unit tests покрывают nullable nutrients, deterministic legacy-kind mapping,
  photo/Food evidence, identity-scoped classification и source statuses.
- Integration tests подтверждают partial Meal persistence, null-not-zero daily
  totals, independent apply, idempotency и imported DayClosure ordering.
- Migration tests покрывают clean/every-prefix upgrade, constraints, typed
  audit foreign keys и 63-byte PostgreSQL identifier limit.
- API/MCP regression подтверждает complete-only public writes и honest partial
  reads.
- Real dry-run читает exact workbook read-only и публикует только safe counts.

## Related material

- [Superseded first Nutrition import decision](20260824-import-nutrition-as-one-typed-fitness-tracker-domain.md)
- [Pull import and exclusive writer cutover](20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Person-local day lifecycle](20260811-model-versioned-person-local-day-closures.md)
- [Typed provenance](20260730-use-typed-provenance-and-append-only-supersession.md)
- [TASK-0050 plan](../../plans/2026/08/completed/2026-08-25-task-0050-partial-nutrition-and-day-closures.md)
