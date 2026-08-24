---
id: "decisions-20260824-use-explicit-body-temporal-precision-and-typed-import-records"
kind: adr
title: "Использовать явную временную точность Body и типизированный relational audit"
status: accepted
date: 2026-08-24
supersedes: []
superseded_by: null
tags:
  - "body"
  - "data-migration"
  - "google-sheets"
  - "provenance"
---

# Использовать явную временную точность Body и типизированный relational audit

## Context

Единый `Fitness Tracker importer` уже поддерживает Weight через общий lifecycle
`dry-run|apply`, relational batch audit и неизменяемую source identity. Следующий
vertical slice — Body — должен подключиться к этому же механизму без отдельного
мигратора.

Лист `Body` имеет поля `Date`, пять известных сантиметровых измерений,
`Photo`, `Notes`, `Measurement_ID` и `Source`. Источник не хранит точное время,
тогда как существующий `BodyMeasurementSession` требует `measuredAt`. Подстановка
полуночи нарушила бы запрет на выдуманные данные. `Photo` не является UUID
API-owned media object и поэтому не может быть без потерь записан в
`photo_media_id`.

## Decision

### Temporal precision

Расширить существующий `BodyMeasurementSession`:

- добавить `body_measurement_temporal_precision` со значениями `instant` и
  `local_date`;
- сделать `measured_at` nullable;
- constraint требует exact instant для `instant` и `NULL` для `local_date`;
- существующие строки сохранить как `instant` без изменения фактических данных;
- public output возвращает `temporalPrecision`, а `measuredAt` становится
  nullable;
- HTTP/MCP create и correction продолжают принимать только exact instant;
- date-only создание остаётся внутренней возможностью typed importer.

### Source identity and mapping

Source identity Body состоит из exact spreadsheet ID, numeric `Body` sheet ID
и обязательного `Measurement_ID`. Row locator является только audit evidence.
Пустой, некорректный или повторяющийся `Measurement_ID` не заменяется номером
строки и блокирует автоматический apply.

`Date` импортируется как `local_date` с workbook timezone `Europe/Moscow` и
`measured_at = NULL`. Непустые валидные `Waist_cm`, `Chest_cm`, `Hips_cm`,
`Thigh_cm` и `Biceps_cm` становятся typed child values; необходим хотя бы один
metric. `Notes` сохраняется в domain field, но не попадает в safe report.
Исходный `Source` участвует в source checksum и private relational audit; domain
provenance channel остаётся `google_sheets`.

Непустой `Photo` классифицируется как `conflict` с безопасным code
`unsupported_photo_reference`. Importer не скачивает media, не создаёт UUID и
не отбрасывает ссылку молча. Отдельное media-migration решение сможет снять
этот blocker позднее.

### Snapshot and relational audit

Развить private connector snapshot до versioned workbook envelope с typed
bounded domain subsets, используемого тем же importer command. Weight v1
остаётся read-compatible. V2 содержит ровно один допустимый typed subset:
`body` для Body либо `weight` + `dailyLog` для Weight. Live reader получает
выбранный domain и не читает несвязанные листы. Следующие adapters расширяют
общий envelope новыми typed alternatives, а не создают отдельные форматы,
команды или all-workbook snapshot.

Добавить `body_import_records` для session-level результата и
`body_import_record_values` для известных metric/value pairs. Не использовать
JSON payload, wide domain fact table или polymorphic target link. Apply следует
общему all-or-nothing lifecycle: любой `conflict` или `invalid` сохраняет batch
и typed audit, но не создаёт Body facts.

## Considered alternatives

- **Подставлять полночь:** отклонено как синтетический факт без source evidence.
- **Отдельный Body script или snapshot:** отклонено, потому что дублирует общий
  lifecycle, retry, audit и безопасный reporting.
- **Считать row number identity при пустом `Measurement_ID`:** отклонено, так
  как перемещение строк изменяет locator и создаёт риск дублей.
- **Игнорировать `Photo` и импортировать остальные поля:** отклонено как тихая
  потеря известного source evidence.
- **Хранить Body audit в generic JSONB:** отклонено; структура session и values
  известна и должна проверяться columns, constraints и foreign keys.
- **Пять metric columns в domain session table:** отклонено, потому что
  существующая aggregate model поддерживает расширяемые typed child values.

## Consequences

- Body становится вторым adapter единого importer, а не вторым мигратором.
- Public read contract получает nullable `measuredAt` и explicit
  `temporalPrecision`; existing command contract остаётся exact-instant only.
- Schema migration снимает `NOT NULL` с `body_measurement_sessions.measured_at`,
  поэтому обязательны clean/every-prefix upgrade и regression tests.
- Safe output не раскрывает dates, measurements, notes, source text или photo
  references.
- Текущий пустой Body sheet даст `0/0/0/0`; apply при отсутствии created facts
  не требуется.
- Photo migration остаётся отдельным явно проектируемым capability, а не
  неявной частью Body importer.

## Verification

- Clean и every-prefix migration tests сохраняют existing sessions как
  `instant` и проверяют temporal/audit constraints и 63-byte identifier limit.
- Unit tests покрывают normalization, source identity, duplicate IDs, partial
  metrics, invalid rows, photo conflict, deterministic reports и snapshot v1/v2.
- PostgreSQL integration tests покрывают created, unchanged, mismatch,
  target-only, blocked apply, exact retry, atomicity и Person isolation.
- API/MCP/day/progress regression проверяет nullable output, stable ordering и
  сохранение exact-instant create/correct input.
- Реальный read-only connector snapshot и dry-run подтверждают source metadata
  и нулевые Sheets writes.

## Related material

- [Unified importer and Weight temporal precision](20260821-use-relational-import-batches-and-explicit-weight-temporal-precision.md)
- [Body measurement sessions](20260730-model-body-measurement-sessions-and-versioned-physical-goals.md)
- [Typed provenance](20260730-use-typed-provenance-and-append-only-supersession.md)
- [Migration strategy](../wiki/architecture/migration-strategy.md)
- [TASK-0048 plan](../../plans/2026/08/completed/2026-08-24-task-0048-body-importer.md)
