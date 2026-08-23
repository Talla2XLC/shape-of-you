---
id: "decisions-20260821-use-relational-import-batches-and-explicit-weight-temporal-precision"
kind: adr
title: "Использовать единый relational importer и явную временную точность Weight"
status: accepted
date: 2026-08-21
supersedes: []
superseded_by: null
tags:
  - "data-migration"
  - "google-sheets"
  - "provenance"
  - "weight"
---

# Использовать единый relational importer и явную временную точность Weight

## Context

TASK-0044 реализовала общее read-only ядро импорта и Weight dry-run. Следующий
шаг должен превратить его в единый `Fitness Tracker importer`, а не создавать
отдельные скрипты для Weight, Body, Nutrition, Training и Recovery/Garmin.

Для записывающего `apply` не хватает двух контрактов. Во-первых, запуск и его
результаты должны сохраняться реляционно, чтобы повторный запуск не создавал
дубли и чтобы можно было доказать, какие source records были созданы,
подтверждены, заблокированы или отклонены. Во-вторых, `Weight` содержит только
дату, тогда как текущий `weight_measurements.measured_at` требует точный
момент. Подстановка полуночи запрещена как выдуманное значение.

## Decision

### Единая команда и ядро

Использовать одну one-shot команду:

```text
fitness-tracker:import --domain <domain> --mode <dry-run|apply>
```

`dry-run` и `apply` используют один source reader, нормализацию, source
identity, checksum, reconciliation и классификацию. Domain adapter остаётся
типизированным. Weight является первым adapter, но не отдельным мигратором.
Следующие домены подключаются к тому же lifecycle и common contracts.

`dry-run` сохраняет прежнюю гарантию нулевых записей. `apply` получает writer
только после классификации и использует одну PostgreSQL transaction на batch.
Google Sheets остаётся исключительно read-only.

### Relational import audit

Добавить общую таблицу `import_batches` с Person ownership, domain, mode,
source system/container, source manifest checksum, target-state checksum,
status, четырьмя outcome counts и timestamps. Exact comparison snapshot
идентифицируется уникально по Person, domain, mode, source container, source
manifest и target-state checksum.

Добавить `weight_import_records` как первый domain-specific audit contract. Он
хранит реляционно role/locator, numeric sheet id, source local date, source
checksum, normalized local date/weight, outcome, finding code и optional target
`WeightMeasurement`. Invalid raw cell text и credential не сохраняются.
Будущие adapters получают собственные typed record tables; generic JSON facts,
polymorphic target links и universal import payload запрещены.

`source_references.import_batch_id` получает настоящий foreign key на
`import_batches`. Для созданного Weight provenance содержит точный external
system, source key, checksum и batch id. Row number остаётся locator evidence,
но не identity или dedupe key.

### Weight temporal precision

Расширить существующую `weight_measurements`, а не создавать legacy table:

- добавить `temporal_precision` со значениями `instant` и `local_date`;
- сделать `measured_at` nullable;
- сохранить обязательные `local_date` и `timezone`;
- constraint требует `measured_at IS NOT NULL` для `instant` и
  `measured_at IS NULL` для `local_date`;
- все существующие строки мигрируются как `instant` без изменения значений.

Public output явно возвращает `temporalPrecision`, а `measuredAt` становится
nullable. Существующие create/correct HTTP и MCP commands продолжают принимать
только точный instant. Date-only создание доступно только internal typed import
command. Сортировка становится стабильной по `local_date DESC`, затем exact
instant с `NULLS LAST`, затем UUID; cursor получает версионированный новый
shape.

### Apply semantics

`apply` работает так:

1. читает один bounded Sheets snapshot;
2. получает per-Person/domain advisory transaction lock;
3. повторно читает target state внутри transaction и классифицирует тем же
   adapter;
4. при `conflict` или `invalid` сохраняет blocked batch и typed audit records,
   но не создаёт ни одного domain fact;
5. иначе создаёт только `created` facts, оставляет `unchanged` без изменений и
   сохраняет completed batch/audit;
6. exact retry возвращает существующий batch, а unique domain dedupe остаётся
   последней защитой от дублей.

Importer никогда не обновляет и не удаляет существующий fact, не создаёт
correction автоматически и не использует last-write-wins. Batch и его domain
facts фиксируются атомарно. Ошибка transaction не оставляет частичный batch.

## Considered alternatives

- **Отдельный Weight migrator и отдельные scripts для следующих доменов:**
  отклонено, потому что дублирует lifecycle, audit, retry и reporting.
- **Отдельная `legacy_weight_measurements` table:** отклонено, потому что один
  domain fact оказался бы разделён между двумя моделями и всеми read paths.
- **Синтетическая полночь в `measured_at`:** отклонено как выдуманный факт.
- **Generic `import_records(payload JSONB)`:** отклонено, потому что известные
  структуры и связи должны проверяться columns, constraints и foreign keys.
- **Не сохранять blocked apply attempts:** проще, но не оставляет доказательства
  контролируемой миграции и повторных конфликтов.
- **Создавать все независимые `created` rows при наличии других conflicts:**
  отклонено в первом apply как частичный и труднее проверяемый backfill.

## Consequences

- Один importer обслуживает `dry-run` и `apply`; Weight — первый adapter.
- Существующая Weight API serialization расширяется и требует regression
  updates для nullable `measuredAt`, temporal precision, ordering и cursors.
- Apply создаёт audit rows даже для blocked attempts, но не domain facts.
- Schema migration additive по смыслу, но снимает `NOT NULL` с `measured_at` и
  меняет public output contract; clean/prefix upgrade tests обязательны.
- Body, Nutrition, Training и Recovery/Garmin по-прежнему требуют собственных
  typed mappings, но не нового migration lifecycle.
- ADR не разрешает live credential use, production migration execution,
  recurring dual-run, cutover или смену authority.

## Verification

- Static identifier audit отклоняет PostgreSQL identifiers длиннее 63 UTF-8
  bytes.
- Clean и every-prefix migration tests сохраняют существующие Weight rows как
  `instant` и проверяют temporal constraints.
- Unit tests доказывают общий lifecycle для `dry-run`/`apply`, typed outcome
  mapping и отсутствие writer у dry-run.
- PostgreSQL integration tests покрывают created, exact retry, concurrent
  apply, unchanged, blocked conflict/invalid, atomic failure и Person isolation.
- API/MCP/progress/day regression подтверждает корректную serialization и
  stable ordering для instant и local-date facts.
- Sheets adapter tests продолжают доказывать только token POST и data GET с
  `spreadsheets.readonly`; Sheets mutation отсутствует.

## Related material

- [Pull-based import and exclusive writer cutover](20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Typed provenance and append-only supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [Weight domain](../wiki/domain/weight-measurement.md)
- [Migration strategy](../wiki/architecture/migration-strategy.md)
- [TASK-0045 plan](../../plans/2026/08/completed/2026-08-21-task-0045-unified-fitness-tracker-importer.md)
