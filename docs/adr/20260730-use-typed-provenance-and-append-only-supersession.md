---
id: "decisions-20260730-use-typed-provenance-and-append-only-supersession"
kind: adr
title: "Типизированный provenance и append-only supersession фактов"
status: accepted
date: 2026-07-30
supersedes: []
superseded_by: null
tags:
  - "corrections"
  - "data-integrity"
  - "provenance"
  - "supersession"
---

# Типизированный provenance и append-only supersession фактов

## Контекст

Текущий `WeightMeasurement` сохраняет `source`, `source_record_id`,
`dedupe_key` и произвольный публичный JSONB `provenance`. Это достаточно для
первого synthetic vertical, но не задаёт единый проверяемый контракт для
Google Sheets import, natural-language intake, wearable observations и ручных
corrections.

Живая таблица требует idempotency, source references, append-only chronology и
явного correction path. Скрытый overwrite уничтожил бы историю, а универсальная
таблица `facts` ослабила бы типизацию и ownership доменных модулей.

## Решение

Каждый domain fact остаётся типизированной неизменяемой записью в таблице
своего owning module и обязательно содержит `person_id`.

Provenance разделяется на:

- типизированные и индексируемые поля факта: source channel, source reference,
  source timestamp, ingestion timestamp, confidence и dedupe identity;
- опциональную ссылку на `SourceReference` с внешней системой, внешним
  identifier, import batch и checksum;
- private raw source snapshot в JSONB только там, где он нужен для import,
  reconciliation или воспроизводимости.

Raw snapshot не входит в обычный публичный API contract. Поля, участвующие в
constraints, joins, authorization и частых filters, не прячутся в JSONB.

Идемпотентность direct fact creation ограничивается как минимум `person_id`,
source channel и `dedupe_key`; глобальный `dedupe_key` запрещён. Точный
idempotency owner для сложного multi-event intake проектируется в Intake, но
не меняет person-scoped boundary.

Correction создаёт новый immutable fact с новым UUID, `supersedes_id`, причиной
и собственной provenance. Исходный fact сохраняется. Supersession разрешён
только внутри одного fact type и одного `Person`; один факт не может иметь две
конкурирующие подтверждённые замены. Default current-state queries исключают
superseded facts, а audit/history queries возвращают всю цепочку.

Это не event sourcing. Facts остаются текущей domain authority после будущего
cutover, а timeline и history являются audit/read models.

## Рассмотренные альтернативы

- Mutable overwrite плюс `updated_at`: проще, но уничтожает значение и
  происхождение до correction. Отклонено.
- Database trigger и общая history table: скрывает domain semantics от API и
  усложняет типизированное восстановление. Отклонено.
- Stable fact ID плюс универсальная revision table: сохраняет identity, но
  создаёт polymorphic persistence и слабые foreign keys. Отклонено.
- Универсальная `facts` table с JSONB payload: быстро расширяется, но переносит
  spreadsheet coupling и ослабляет domain constraints. Отклонено.
- Новый typed fact с self-reference `supersedes_id`: явно выражает correction,
  сохраняет историю и остаётся module-owned. Выбрано.

## Последствия

- Existing `WeightMeasurement` contract и unique index требуют совместимой
  migration до появления реальных данных.
- Corrections являются отдельными commands/endpoints, а не `PATCH` со скрытым
  overwrite.
- Current и history queries имеют разную семантику и должны быть явно
  документированы.
- Source snapshots увеличивают storage; retention и redaction задаются по
  source type.
- Для evidence, связывающего несколько facts, используются references, а не
  копирование исходных payloads.
- Google Sheets остаётся authoritative source до отдельного dual-run и cutover.

## Проверка

- Concurrent retry создаёт один fact в person/source dedupe scope.
- Correction сохраняет исходный fact и создаёт проверяемую supersession chain.
- Database запрещает cross-person и cross-type supersession.
- Default list не возвращает superseded facts; history возвращает цепочку в
  стабильном порядке.
- Public response не раскрывает private raw snapshot.
- Synthetic parity tests покрывают manual, Google Sheets, import и correction
  paths без персональных данных.

## Связанные материалы

- [Provenance и identifiers](../wiki/data/provenance-and-identifiers.md)
- [Целостность и lifecycle](../wiki/data/integrity-and-lifecycle.md)
- [Независимые факты вместо DayRecord](20260728-prefer-independent-facts-over-broad-day-record.md)
- [User, Person и права доступа](20260730-separate-user-access-from-person-data-ownership.md)
- [План общих fact-контрактов](../../plans/2026/07/completed/2026-07-30-person-identity-provenance-and-corrections.md)
