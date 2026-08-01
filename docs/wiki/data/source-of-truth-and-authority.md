---
id: "data-source-of-truth-and-authority"
kind: data
title: "Source of truth и authority"
status: draft
tags:
  - "authority"
  - "data"
  - "migration"
---

# Source of truth и authority

## Кратко

Карта authority для текущего workbook `Fitness Tracker`. Она разделяет исходные факты, текущую configuration, производные projections, workflow state и project governance, чтобы будущая миграция не превратила каждый лист в авторитетную таблицу.

## Содержание

### Текущий operational authority

Google Sheets остаётся authoritative source до прохождения принятого gate dual-run, reconciliation и cutover.

### Authority по типам информации

- исходные факты сохраняют provenance и owning domain;
- configuration и business policy не являются историческими измерениями;
- workflow status описывает обработку, а не fitness truth;
- formulas, dashboards, `Daily_Log`, personal records, risk scores и plans могут быть производными projections или решениями;
- явные пользовательские corrections заменяют факты, не стирая историю.

Authority назначается для каждого типа факта или артефакта. Лист, содержащий несколько типов, не становится автоматически авторитетным целиком.

Для Nutrition canonical `Brand`, `Ingredient` и `FoodVersion` являются общими
reference definitions внутри backend после будущего cutover, а персональный
catalog хранит overlays и private items. До cutover Google Sheets остаётся
operational authority для текущих catalog records и meals.

`Meal` всегда фиксирует собственный typed nutrient snapshot. Изменение
catalog food создаёт новую version и не пересчитывает исторический intake.
Daily nutrition totals являются производной projection над current meals.

## Основания

Наблюдаемый двойной путь веса в Weight и Daily_Log; агрегация Meals в Daily_Log; derivation из Training в Personal Records и Program; lifecycle source_text/event/queue/write в NL_Engine и AI_Inbox; контракт repair с read-back в Self_Healing.

## Решения

Authority моделируется по типу поля или записи, а не назначается листу целиком.
Для веса `Weight` является authoritative журналом будущей миграции, а
`Daily_Log.Weight` — legacy projection и reconciliation evidence. Совпадающее
зеркало не создаёт второй `WeightMeasurement`; расхождение блокирует
автоматический import этой записи и требует investigation. Принятое ADR о
cutover с Google Sheets не изменяется.

## Открытые вопросы

- Может ли пользователь намеренно переопределять вычисленные дневные итоги и как представить такой override?
- Как отдельная команда Training применяет принятую recommendation и связывает
  новую program version с исходным решением без объявления acceptance
  выполненным фактом?
- Какая conflict policy применяется к независимым будущим channels, например
  manual API и wearable device?

## Связанные материалы

- [Инвентаризация Google Sheets](google-sheets-inventory.md)
- [ADR о cutover с Google Sheets](../../adr/20260728-keep-google-sheets-authoritative-until-verified-cutover.md)
- [Целостность и lifecycle](integrity-and-lifecycle.md)
- [Доменные invariants](../domain/invariants.md)
- [Слоистый Nutrition catalog](../../adr/20260731-use-layered-versioned-nutrition-catalog.md)
