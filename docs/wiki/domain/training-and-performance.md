---
id: "domain-training-and-performance"
kind: domain
title: "Training and Performance"
status: draft
tags:
  - "domain"
  - "training"
---

# Training and Performance

## Кратко

Контекст разделяет общий справочник упражнений, персональную программу,
выполненные тренировки и вычисляемые результаты. Программа не доказывает
выполнение, а принятие рекомендации не меняет программу без отдельной команды
Training.

## Содержание

- `Exercise` имеет стабильную identity и неизменяемые `ExerciseVersion`.
  Общие упражнения переиспользуются, а overlays и private exercises принадлежат
  `Person`.
- `TrainingProgram` и его неизменяемые версии принадлежат `Person`. У человека
  может быть не более одной явно активированной версии.
- Версия программы содержит упорядоченные тренировки и назначения со ссылками
  на точные версии упражнений и целевыми параметрами выполнения.
- `WorkoutSession` — неизменяемый факт. Он содержит выполненные упражнения и
  отдельные подходы с фактическими весом, повторениями и RIR.
- Исправление создаёт полную замену сессии с `supersedes_id`.
- Личный рекорд вычисляется по текущим подходам: максимальный вес, затем число
  повторений. Он ссылается на исходный подход и не хранится как вторая истина.
- Кандидат прогрессии является расчётом. Только принятие кандидата создаёт
  новую версию программы.

Поля `Last_Date`, `Last_Reps`, `Last_RIR`, `Auto_Decision` и
`Recommended_Next` из legacy-листа `Program` относятся к вычисляемым
представлениям, а не к содержимому версии программы.

## Основания

- Заголовки и зависимости листов `Training`, `Program` и `Personal Records`
  в authoritative workbook `Fitness Tracker`.
- [Каталог поведения Google Sheets](../data/google-sheets-behavior-catalog.md).

## Решения

- [ADR о программах и фактах тренировок](../../adr/20260731-model-versioned-training-programs-and-immutable-workout-sessions.md).
- [ADR о shared reference data](../../adr/20260731-separate-shared-reference-definitions-from-person-owned-state.md).

## Открытые вопросы

- Точные controlled values для самочувствия и статусов до переноса реальных
  данных.
- Конкретный внешний источник упражнений, его лицензия и правила сопоставления.
- Материализация тяжёлых проекций после появления измеренной нагрузки.

## Связанные материалы

- [Bounded contexts](bounded-contexts.md)
- [Кандидаты в агрегаты](candidate-aggregates.md)
- [Provenance и identifiers](../data/provenance-and-identifiers.md)
- [План реализации](../../../plans/2026/07/completed/2026-07-31-training-and-performance.md)
