---
id: "domain-physical-goal"
kind: domain
title: "PhysicalGoal"
status: draft
tags:
  - "domain"
  - "goals"
  - "physical-state"
  - "versioning"
---

# PhysicalGoal

## Кратко

`PhysicalGoal` — принадлежащий `Person` versioned plan. Stable goal root
управляет lifecycle и current version, immutable versions сохраняют intent и
criteria, а progress остаётся query projection над physical facts.

## Содержание

Goal root имеет lifecycle `draft`, `active`, `completed` или `cancelled` и
optimistic lock. `PhysicalGoalVersion` хранит последовательный version number,
narrative intent, optional effective/target dates и structured criteria.

Criterion ограничен Physical State metric vocabulary и поддерживает modes
`directional`, `exact`, `range` и `dynamic`. Narrative или dynamic goal не
обязан содержать фиктивный target value. Это сохраняет смысл текущей цели:
изменение состава тела с сохранением мышечной массы и динамически
пересматриваемым весом.

Новая редакция создаётся как immutable draft version. Activation одной
transaction переключает current version с optimistic concurrency check.
Completion и cancellation изменяют lifecycle root, но не исторические versions.

## Основания

- `Settings` содержит primary goal как narrative intent и target weight как
  динамически пересматриваемое значение.
- [ADR о сеансах замеров и физических целях](../../adr/20260730-model-body-measurement-sessions-and-versioned-physical-goals.md).

## Решения

- Не хранить goal как mutable configuration row.
- Не требовать точного numeric target для directional/dynamic intent.
- Не объединять goal criteria с product safety policies или universal rules
  engine.
- Не хранить отдельную authority-копию current goal или progress.

## Открытые вопросы

- Controlled metric vocabulary за пределами weight и текущих body metrics.
- Нужна ли отдельная primary-goal cardinality после появления нескольких goals.
- Кто и при каких условиях сможет автоматически предлагать новую goal version.

## Связанные материалы

- [BodyMeasurementSession](body-measurement-session.md)
- [API PhysicalGoal](../api/physical-goals.md)
- [Кандидаты в агрегаты](candidate-aggregates.md)
- [План Physical State and Goals](../../../plans/2026/07/completed/2026-07-30-physical-state-measurements-and-goals.md)
