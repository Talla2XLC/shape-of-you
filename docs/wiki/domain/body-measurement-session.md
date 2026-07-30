---
id: "domain-body-measurement-session"
kind: domain
title: "BodyMeasurementSession"
status: draft
tags:
  - "body"
  - "domain"
  - "measurement"
  - "physical-state"
---

# BodyMeasurementSession

## Кратко

`BodyMeasurementSession` — принадлежащий `Person` immutable aggregate одного
сеанса замеров тела с общей provenance, заметкой, optional photo reference и
набором типизированных значений.

## Содержание

Aggregate root хранит identity, person ownership, absolute time, derived local
date, IANA timezone, typed provenance, dedupe, confidence и append-only
supersession metadata.

Дочерние `BodyMeasurementValue` принадлежат только session. Первая controlled
vocabulary содержит `waist`, `chest`, `hips`, `thigh` и `biceps` с canonical
unit `cm`. В session допускается не более одного значения каждого metric kind.
Значения хранятся как exact numeric.

Correction создаёт полный replacement session с новым UUID и
`supersedes_id`. Исходный session и values не изменяются. Несколько независимых
sessions одного `Person` за локальный день разрешены.

Photo является nullable reference на private media metadata. Binary content,
upload workflow и retention policy не входят в текущую вертикаль.

## Основания

- Заголовки листа `Body`: дата, пять окружностей, photo, notes,
  `Measurement_ID` и source.
- [ADR о сеансах замеров и физических целях](../../adr/20260730-model-body-measurement-sessions-and-versioned-physical-goals.md).
- [ADR о typed provenance](../../adr/20260730-use-typed-provenance-and-append-only-supersession.md).

## Решения

- Сохранять общую provenance исходной строки на session root.
- Нормализовать metric values в typed child rows внутри одной transaction.
- Не создавать generic measurements/facts table.
- Не вводить unique constraint по `localDate`.

## Открытые вопросы

- Нужны ли отдельные bounds для каждого metric вместо общего технического
  диапазона `1.00..500.00 cm`.
- Privacy, retention и deletion для notes и photo.
- Первый operational workflow загрузки private media.

## Связанные материалы

- [PhysicalGoal](physical-goal.md)
- [WeightMeasurement](weight-measurement.md)
- [API BodyMeasurementSession](../api/body-measurement-sessions.md)
- [Source of truth и authority](../data/source-of-truth-and-authority.md)
- [План Physical State and Goals](../../../plans/2026/07/completed/2026-07-30-physical-state-measurements-and-goals.md)
