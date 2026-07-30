---
id: "data-google-sheets-inventory"
kind: data
title: "Инвентаризация Google Sheets"
status: draft
tags:
  - "data"
  - "dev-027"
  - "google-sheets"
---

# Инвентаризация Google Sheets

## Кратко

Инвентаризация таблицы `Fitness Tracker` на основе наблюдаемых данных для
DEV-023. Таблица остаётся текущим operational authority до проверенного
dual-run и cutover. Страница описывает структуру источника; значимое поведение
детализировано в отдельном behavior catalog. Обе страницы не предписывают
схему базы данных.

## Содержание

Наблюдаемые 26 листов образуют пять групп свидетельств:

- configuration и projections: Settings, Dashboard, Daily_Log;
- каталоги питания и intake: Foods, Ingredients, Brands, Food_Ingredients, Meals;
- тренировки и физическое состояние: Training, Program, Weight, Personal Records, Body;
- product governance: Changelog, Roadmap, Ideas, Rules, Decisions;
- workflows ввода, audit, repair и coaching: NL_Engine, AI_Inbox, Self_Healing, AI_Timeline, AI_Insights, Load_Risk, Weight_Autopilot, Coach_Planner.

Workbook смешивает исходные факты, policy, workflow state и projections. Поэтому границы листов являются свидетельствами для discovery, но не будущими границами агрегатов, таблиц, модулей или сервисов. `Daily_Log` преимущественно является legacy projection над независимо принадлежащими фактами.

## Основания

Свидетельства собраны из metadata таблицы и ограниченного чтения всех 26 наблюдаемых листов. Заголовки прочитаны для Settings, Dashboard, Daily_Log, Foods, Ingredients, Brands, Food_Ingredients, Meals, Training, Program, Weight, Personal Records, Body, Changelog, Roadmap, Ideas, Rules, Decisions, NL_Engine, AI_Inbox, Self_Healing, AI_Timeline, AI_Insights, Load_Risk, Weight_Autopilot и Coach_Planner. Чтение формул подтвердило основные зависимости projections. Персональные fitness-значения на страницу не копировались.

## Решения

Extraction baseline остаётся draft. Workbook рассматривается как единая текущая operational system с доменными модулями и adapters, а не как один сервис или одна таблица базы данных на каждый лист. Принятые ограничения моделирования независимыми фактами и пятью контекстами зафиксированы в ADR.

## Открытые вопросы

- Является ли одно измерение веса на календарную дату строгим бизнес-правилом или только текущим соглашением?
- Может ли один приготовленный продукт содержать один ингредиент несколько раз для разных этапов приготовления?
- Является ли `Daily_Log.Weight` намеренно денормализованным кэшем `Weight` или вторым путём ввода?
- Какие правила в `Rules` являются business policy, а какие относятся к операциям и governance таблицы?
- Что является authoritative exercise catalog? Отдельный справочный лист упражнений не обнаружен.
- Какие sheet-level statuses являются controlled vocabularies, а какие — свободным текстом?
- Requiredness полных строк частично остаётся неизвестной: ограниченная проверка не доказывает все исторические состояния валидации.

## Связанные материалы

- [Source of truth и authority](source-of-truth-and-authority.md)
- [Каталог поведения Google Sheets](google-sheets-behavior-catalog.md)
- [Provenance и identifiers](provenance-and-identifiers.md)
- [Целостность и lifecycle](integrity-and-lifecycle.md)
- [Карта извлечения домена](../domain/domain-extraction-map.md)
- [ADR о cutover с Google Sheets](../../adr/20260728-keep-google-sheets-authoritative-until-verified-cutover.md)
