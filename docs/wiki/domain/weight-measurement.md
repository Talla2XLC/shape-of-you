---
id: "domain-weight-measurement"
kind: domain
title: "WeightMeasurement"
status: draft
tags:
  - "domain"
  - "measurement"
  - "weight"
---

# WeightMeasurement

## Кратко

`WeightMeasurement` — принадлежащий `Person` неизменяемый факт измерения веса с
абсолютным временем, локальной датой, typed provenance и стабильной
deduplication identity.

## Содержание

Поля факта: UUID `id`, `personId`, `measuredAt`, derived `localDate`, IANA
`timezone`, `weightKg`, typed `sourceReference`, `dedupeKey`, nullable
`confidence`, nullable `supersedesId`/`correctionReason` и `createdAt`.

Инварианты первой вертикали:

- `weightKg` находится в диапазоне `0.500..700.000` kg и хранится как
  `numeric(6,3)`; диапазон является защитой качества данных, не медицинской
  нормой;
- `confidence` при наличии находится в диапазоне `0..1`;
- `measuredAt` хранится как `timestamptz`;
- сервер вычисляет `localDate` из `measuredAt` в проверенной IANA `timezone`;
- unique `(person_id, source, dedupe_key)` делает create idempotent в границе
  владельца и source channel;
- `SourceReference` содержит typed channel, optional external identity,
  source timestamp и ingestion timestamp; private raw snapshot не входит в
  публичный контракт;
- correction создаёт новый факт с новым UUID, `supersedes_id`, причиной и
  собственной provenance, не изменяя исходную запись;
- один факт не может иметь две конкурирующие замены, а cross-person
  supersession запрещён database constraints;
- current-state query исключает заменённые факты, history возвращает полную
  линейную цепочку.

## Основания

- `apps/api/src/database/schema.ts`.
- `apps/api/src/domain/weight-measurement.ts`.
- Условия DEV-023 и integration tests.

## Решения

- Google Sheets остаётся authoritative source; API не выполняет dual-write,
  backfill или cutover.
- Внутри workbook лист `Weight` является authoritative журналом веса, а
  `Daily_Log.Weight` — legacy projection и reconciliation evidence. Зеркало не
  создаёт второй domain fact.
- Несколько настоящих измерений одного `Person` за локальный день разрешены;
  unique constraint по `localDate` отсутствует.
- Проекции не заменяют исходный факт.
- Временный synthetic `Person` используется только для test/staging до
  реализации authentication и не является authorization precedent.

## Открытые вопросы

- Точная idempotency identity multi-event Google Sheets importer.

## Связанные материалы

- [API WeightMeasurement](../api/weight-measurements.md)
- [Provenance и identifiers](../data/provenance-and-identifiers.md)
- [Source of truth и authority](../data/source-of-truth-and-authority.md)
- [Сеансы замеров тела и физические цели](../../adr/20260730-model-body-measurement-sessions-and-versioned-physical-goals.md)
