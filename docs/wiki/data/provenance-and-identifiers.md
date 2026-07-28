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

Кандидатам на миграцию нужны долговечные domain identifiers и неизменяемые legacy references на workbook, sheet, строку или ячейку, где это применимо, source channel, source timestamp, ingestion timestamp и историю correction/supersession. Номер строки нестабилен и не должен становиться domain identity.

## Основания

Заголовки из Foods, Ingredients, Brands, Food_Ingredients, Training, Body, NL_Engine, AI_Inbox, Self_Healing, AI_Timeline, AI_Insights, Load_Risk, Weight_Autopilot и Coach_Planner.

## Решения

Draft-рекомендация: при миграции назначить долговечные ID для MealEntry, WeightMeasurement, observations DailyRecord и ProgramVersion, сохранив legacy source references. Не использовать номера строк листа как ID.

## Открытые вопросы

- Управляется ли `Exercise_ID` вне этого workbook?
- Может ли `Session_ID` охватывать несколько дат?
- Являются ли `Food_ID` и `Ingredient_ID` глобально уникальными или только локальными для workbook?
- Должны ли исправленные факты сохранять identity с revision history или получать superseding identity?
- Какой timezone применяется к timestamps внешних устройств до нормализации?

## Связанные материалы

- [Инвентаризация Google Sheets](google-sheets-inventory.md)
- [Целостность и lifecycle](integrity-and-lifecycle.md)
- [Кандидаты в агрегаты](../domain/candidate-aggregates.md)
