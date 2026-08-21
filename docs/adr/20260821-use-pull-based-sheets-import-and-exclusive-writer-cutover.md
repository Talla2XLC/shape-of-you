---
id: "decisions-20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover"
kind: adr
title: "Использовать pull-based импорт из Google Sheets и эксклюзивное переключение writer"
status: accepted
date: 2026-08-21
supersedes: []
superseded_by: null
tags:
  - "cutover"
  - "data-migration"
  - "dual-run"
  - "google-sheets"
  - "mcp"
  - "provenance"
---

# Использовать pull-based импорт из Google Sheets и эксклюзивное переключение writer

## Context

`Fitness Tracker` остаётся operational authority и продолжает изменяться.
Отдельный ChatGPT-проект «Фитнес-трекер» является активным writer: он записывает
факты, включая Garmin/Recovery observations, в Google Sheets. До cutover этот
workflow должен продолжить работу без прямой записи в PostgreSQL.

Текущий API уже содержит типизированные Person-owned факты, provenance,
idempotency и append-only corrections. Для Weight реализована синтетическая
сверка `Weight` с `Daily_Log.Weight`, но общего import-run contract, live Sheets
reader, dry-run, persisted backfill и cutover coordination пока нет.

Прямой dual-write из ChatGPT одновременно в Google Sheets и PostgreSQL создаёт
неустранимую неопределённость при частичном отказе. Отдельный ETL service или
broker до доказанной нагрузки добавил бы преждевременную deployable boundary.
Intake queue также не подходит как importer: Intake координирует пользовательский
текст и confirmation, тогда как migration обрабатывает source snapshots и
сверяет их с domain facts.

Лист `Weight` содержит только `Date` и `Weight_kg`: стабильного
`Measurement_ID` и точного времени измерения нет. Номер строки изменяем и не
может быть domain или source identity. Текущий `WeightMeasurement.measuredAt`
выражает точный instant, поэтому подстановка полуночи без обозначения точности
выдумала бы отсутствующие данные.

## Decision

### Import boundary

Разместить migration capability внутри существующего API modular monolith и
его PostgreSQL. Использовать явную one-shot command boundary; не создавать
отдельный deployable, database, broker или cross-service SQL.

Общий import kernel отвечает только за:

- запуск и mode (`dry_run`, позднее `apply` и `reconcile`);
- чтение immutable source snapshot через read-only adapter;
- детерминированную нормализацию и source identity;
- классификацию `created`, `unchanged`, `conflict`, `invalid`;
- безопасный отчёт и aggregate counts;
- orchestration typed domain adapters.

Каждый domain adapter владеет известной структурой candidate/result и
сопоставлением со своим owning-module command. Известные Weight, Body,
Nutrition, Training и Recovery поля хранятся в relational columns и typed
contracts. Universal JSON/JSONB payload, polymorphic fact link и generic facts
table запрещены. Private raw snapshot допустим только как дополнительное
evidence для воспроизводимости и не заменяет известные поля.

`dry_run` читает Google Sheets и PostgreSQL, но не получает writer port и
выполняет PostgreSQL comparison в read-only transaction. Он не создаёт даже
служебный import row. Run id, source manifest и результаты существуют только в
детерминированном отчёте. Persisted `ImportBatch` и domain-specific import
records появляются только в отдельно утверждённом `apply` этапе.

### Source identity and outcomes

Google Sheets source identity включает spreadsheet id, immutable numeric
sheet id и domain-specific stable source key. Координата строки/ячейки — только
locator evidence. Checksum вычисляется по каноническим исходным полям отдельно
от identity, чтобы изменение значения стало конфликтом, а не новым фактом.

Для текущего `Weight` stable source key — Person-local date внутри
`Fitness Tracker`/`Weight`. Это допустимо только потому, что исходный journal
имеет одно authoritative значение на дату. Повторная дата —
`duplicate_authority` conflict. Перемещение неизменённой строки сохраняет
identity; изменение даты неоднозначно и создаёт missing/new-source conflict,
а не автоматическую correction. Dedupe key для будущего факта выводится из
source identity, а не из checksum.

Outcome semantics едины:

- `created` — valid source fact отсутствует в PostgreSQL; в dry-run это только
  намерение без записи;
- `unchanged` — source identity, normalized domain values и provenance checksum
  совпадают;
- `conflict` — identity занята отличающимся фактом, source row изменена,
  authority/mirror расходятся, обнаружен duplicate или target-only факт;
- `invalid` — исходное значение нельзя честно и детерминированно преобразовать.

Importer никогда не перезаписывает, не удаляет и не создаёт correction
автоматически. Conflict требует отдельного расследования и решения.

### Weight temporal precision

Weight import candidate явно различает `instant` и `local_date` precision.
Дата из Sheets остаётся date-only evidence; importer не создаёт искусственный
timestamp. Первый dry-run сообщает такую строку как valid `local_date`
candidate. До `apply` необходимо отдельно реализовать утверждённый relational
contract, в котором `WeightMeasurement` выражает temporal precision, а exact
`measuredAt` отсутствует для date-only legacy fact. Existing instant-based
facts сохраняют прежнюю семантику. Публичная сериализация и stable ordering
должны раскрывать точность, а не маскировать её.

### Pull-based dual-run

До cutover ChatGPT-проект пишет только в Google Sheets. Backend выполняет
pull-based import/reconciliation:

1. shadow dry-run без PostgreSQL writes;
2. отдельно утверждённый append-only backfill;
3. повторяющийся pull/import и сверку, пока Sheets остаётся authority;
4. финальный catch-up по зафиксированному source manifest.

Это controlled dual-run, но не dual-write: один пользовательский факт сначала
появляется только в Sheets, затем backend независимо импортирует и сверяет его.
Backend никогда не пишет обратно в Sheets в штатном dual-run.

### Writer cutover

Cutover разрешён только после выполнения всех gates:

- все используемые ChatGPT-проектом типы фактов инвентаризированы;
- Shape of You MCP имеет проверенные typed write tools и scopes для каждого
  используемого типа, включая Garmin/Recovery observations;
- historical backfill и повторяющийся dual-run не имеют unresolved conflicts;
- source manifest/checkpoint и final catch-up воспроизводимы;
- OAuth/Person binding, idempotency, provenance и end-to-end write/read-back
  проверены для каждого MCP tool;
- подготовлены, испытаны и одобрены cutover и rollback runbooks.

В каждый момент существует только один активный ChatGPT writer. Переключение
выполняется как контролируемая пауза:

1. остановить ChatGPT Sheets writer;
2. зафиксировать immutable source manifest и cutover checkpoint;
3. выполнить final pull, import и reconciliation;
4. доказать отсутствие новых Sheets writes после checkpoint;
5. переключить ChatGPT-проект на запись только через Shape of You MCP;
6. выполнить bounded MCP write/read-back verification;
7. отдельным operator approval передать authority PostgreSQL;
8. перевести Google Sheets в read-only archive или явно спроектированную
   projection mode.

Конкретная смена ChatGPT-проекта, Sheets permissions и authority не входит в
TASK-0044.

### Rollback

Rollback также сохраняет exclusive writer. Сначала останавливается MCP writer.
Если после checkpoint новых PostgreSQL facts нет, ChatGPT Sheets writer можно
возобновить после проверки. Если новые facts есть, до возобновления выполняется
контролируемый one-time export/replay этих facts в Sheets, затем read-back и
reconciliation. Это не dual-write: writer меняется только после завершения
переноса.

Любая rollback-запись в Google Sheets требует отдельного явного разрешения.
Автоматический reverse sync запрещён. Cutover нельзя начинать, пока export,
replay, idempotency и rollback window не испытаны для всех фактических типов.

## Considered alternatives

- **Отдельный Weight script, напрямую вызывающий repository:** быстрее, но
  дублирует lifecycle, identity и reporting при добавлении Body/Nutrition/
  Training/Recovery и плохо различает unchanged/conflict.
- **Прямой ChatGPT dual-write:** отклонён из-за split-brain при частичном отказе
  и невозможности доказать единственный authority result.
- **Переиспользовать Intake queue:** отклонено из-за другой семантики source
  snapshot, reconciliation и пользовательского confirmation.
- **Отдельный ETL service/broker/database:** отклонено как преждевременная
  deployable и operational complexity.
- **Использовать row number как identity:** отклонено, потому что строки
  перемещаются и вставляются.
- **Вставлять полночь как `measuredAt`:** отклонено, потому что это превращает
  date-only evidence в выдуманный instant.
- **Автоматически исправлять PostgreSQL при изменении Sheets row:** отклонено,
  потому что скрывает конфликт и нарушает append-only correction contract.

## Consequences

- Первый vertical остаётся небольшим: общий kernel и Weight dry-run без database
  mutations, real-data backfill или cutover.
- Live Sheets reader использует отдельную API-owned Google service identity с
  доступом только на чтение к точному workbook. Secret доставляется существующим
  runtime-механизмом и не хранится в repository или отчётах.
- `apply` потребует additive schema migration для import batches, typed records
  и date-precision Weight contract; она не входит в dry-run approval.
- MCP до cutover нужно расширить: текущие tools покрывают Weight, Body, Meal и
  Workout, но не Recovery/Garmin observations.
- Cutover становится наблюдаемой процедурой с manifest, exclusive writer,
  verification и воспроизводимым rollback вместо неявной смены инструкций.
- Google Sheets остаётся authority; этот ADR сам по себе не разрешает cutover.

## Verification

- Dry-run tests доказывают отсутствие PostgreSQL и Google Sheets mutations.
- Golden fixtures покрывают created/unchanged/conflict/invalid, duplicate dates,
  mirror mismatch, row movement, value/date changes и target-only facts.
- Property/concurrency tests подтверждают deterministic identity/checksum и
  одинаковый результат повторных запусков.
- Integration tests используют real PostgreSQL read-only transaction и не
  меняют row counts или checksums целевых таблиц.
- Identifier audit статически отклоняет PostgreSQL identifiers длиннее 63
  UTF-8 bytes при появлении apply schema.
- Перед cutover MCP coverage matrix и end-to-end suite проходят для каждого
  live writer fact type, включая Recovery/Garmin.
- Cutover rehearsal доказывает final checkpoint, отсутствие второго writer,
  read-back и rollback с post-checkpoint facts.
- Architecture Review подтверждает отсутствие generic facts, premature service,
  duplicated authority и лишней persisted dry-run state.

## Related material

- [Google Sheets authority until cutover](20260728-keep-google-sheets-authoritative-until-verified-cutover.md)
- [Typed provenance and append-only supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [Physical State and Weight reconciliation](20260730-model-body-measurement-sessions-and-versioned-physical-goals.md)
- [Migration strategy](../wiki/architecture/migration-strategy.md)
- [Source of truth and authority](../wiki/data/source-of-truth-and-authority.md)
- [TASK-0044 plan](../../plans/2026/08/completed/2026-08-21-task-0044-controlled-sheets-import-and-weight-reconciliation.md)
