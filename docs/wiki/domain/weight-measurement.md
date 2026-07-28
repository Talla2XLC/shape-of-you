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

`WeightMeasurement` — неизменяемый факт измерения веса с абсолютным временем,
локальной датой пользователя, provenance и стабильной deduplication identity.

## Содержание

Поля факта: UUID `id`, `measuredAt`, derived `localDate`, IANA `timezone`,
`weightKg`, `source`, nullable `sourceRecordId`, `dedupeKey`, nullable
`confidence`, JSONB `provenance` и `createdAt`.

Инварианты первой вертикали:

- `weightKg` находится в диапазоне `0.500..700.000` kg и хранится как
  `numeric(6,3)`; диапазон является защитой качества данных, не медицинской
  нормой;
- `confidence` при наличии находится в диапазоне `0..1`;
- `measuredAt` хранится как `timestamptz`;
- сервер вычисляет `localDate` из `measuredAt` в проверенной IANA `timezone`;
- unique `dedupeKey` делает create idempotent и не разрешает overwrite;
- `sourceRecordId` не обязателен для `manual`;
- `source` и `provenance` сохраняют путь будущего импорта Google Sheets;
- corrections и supersession пока не реализованы.

## Основания

- `apps/api/src/database/schema.ts`.
- `apps/api/src/domain/weight-measurement.ts`.
- Условия DEV-023 и integration tests.

## Решения

- Google Sheets остаётся authoritative source; API не выполняет dual-write,
  backfill или cutover.
- Проекции не заменяют исходный факт.

## Открытые вопросы

- Correction/supersession contract.
- Dedupe policy будущего Google Sheets importer.

## Связанные материалы

- [API WeightMeasurement](../api/weight-measurements.md)
- [Provenance и identifiers](../data/provenance-and-identifiers.md)
- [Source of truth и authority](../data/source-of-truth-and-authority.md)
