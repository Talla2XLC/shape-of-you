---
id: "data-provenance-and-identifiers"
kind: data
title: "Provenance и identifiers"
status: draft
tags:
  - "data"
  - "identifiers"
  - "provenance"
---

# Provenance и identifiers

## Кратко

Инвентаризация наблюдаемых identifiers и provenance. В нескольких справочных и AI workflow-листах есть стабильные ID, но основные журналы фактов всё ещё частично зависят от дат, текста, session IDs и координат ячеек.

## Содержание

Справочные и workflow-листы уже предоставляют identifiers для food, ingredient, brand, event, request и session. В журналах фактов меньше единообразия: даты, текстовые labels, строки листа и координаты ячеек иногда выступают неявной identity.

Кандидатам на миграцию нужны долговечные domain identifiers и неизменяемые
legacy references на workbook, sheet, строку или ячейку, где это применимо,
source channel, source timestamp, ingestion timestamp и историю
correction/supersession. Номер строки нестабилен и не должен становиться domain
identity.

Утверждённая модель разделяет `User` и `Person`. Все fitness facts являются
person-scoped. Типизированные provenance-поля остаются индексируемыми columns;
private raw snapshot допускается в JSONB только для import, reconciliation и
воспроизводимости и не входит в обычный публичный contract.

Correction создаёт новый immutable typed fact с новым UUID и `supersedes_id`.
Исходная запись сохраняется. Supersession не пересекает `Person` или fact type,
а default current-state queries исключают superseded facts.

Idempotency key ограничивается как минимум `person_id` и source channel.
Глобальный `dedupe_key` существующего первого vertical является временным
техническим долгом.

## Основания

Заголовки из Foods, Ingredients, Brands, Food_Ingredients, Training, Body, NL_Engine, AI_Inbox, Self_Healing, AI_Timeline, AI_Insights, Load_Risk, Weight_Autopilot и Coach_Planner.

## Решения

- Назначать долговечные ID для MealEntry, WeightMeasurement, observations и
  ProgramVersion, сохраняя legacy source references.
- Не использовать номера строк листа как ID.
- Использовать `Person` как владельца facts и append-only supersession для
  corrections.
- Не создавать универсальную таблицу `facts` или polymorphic revision store.

## Открытые вопросы

- Управляется ли `Exercise_ID` вне этого workbook?
- Может ли `Session_ID` охватывать несколько дат?
- Являются ли `Food_ID` и `Ingredient_ID` глобально уникальными или только локальными для workbook?
- Какой timezone применяется к timestamps внешних устройств до нормализации?
- Какая retention policy применяется к private raw snapshots разных sources?

## Связанные материалы

- [Инвентаризация Google Sheets](google-sheets-inventory.md)
- [Целостность и lifecycle](integrity-and-lifecycle.md)
- [Кандидаты в агрегаты](../domain/candidate-aggregates.md)
- [User, Person и права доступа](../../adr/20260730-separate-user-access-from-person-data-ownership.md)
- [Typed provenance и supersession](../../adr/20260730-use-typed-provenance-and-append-only-supersession.md)
