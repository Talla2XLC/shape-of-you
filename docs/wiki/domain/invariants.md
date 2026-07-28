---
id: "domain-invariants"
kind: domain
title: "Доменные invariants"
status: draft
tags:
  - "domain"
  - "draft"
  - "invariants"
---

# Доменные invariants

## Кратко

Кандидаты в invariants извлечены из явных контрактов workbook. Поведение formulas без явного правила остаётся свидетельством реализации, а не invariant.

## Содержание

Текущие кандидаты:

- неоднозначный ввод не записывается как подтверждённый факт;
- retries не создают дубликаты фактов;
- corrections сохраняют provenance и историю supersession;
- закрытие дня в локальном времени пользователя не передаёт владение связанными фактами;
- выполненные действия не выводятся из plans или permissions;
- рекомендации остаются отдельными от принятых или выполненных действий;
- coaching outputs ссылаются на достаточные свидетельства и не представляют корреляцию как причинность;
- запись в closed day требует явного correction path.

Численные thresholds, readiness scores и progression parameters являются кандидатами в версионируемые policies, а не вечными invariants.

## Основания

Явные контракты NL_Engine, AI_Inbox, Self_Healing, AI_Timeline, AI_Insights, Load_Risk, Weight_Autopilot, Coach_Planner, а также validation DayStatus и cross-sheet formula dependencies.

## Решения

Все пункты остаются draft до domain review. Thresholds и численные targets следует оформлять как версионируемые policies, а не жёстко заданные вечные invariants.

## Открытые вопросы

- Какие invariants критичны для здоровья и безопасности и требуют экспертной валидации?
- Может ли явная пользовательская correction обойти guard Closed day с сохранением истории?
- Являются ли численные scoring thresholds product policy или временной настройкой таблицы?
- Какая duplicate policy допустима для retries устройств и измерений в один день?

## Связанные материалы

- [Целостность и lifecycle](../data/integrity-and-lifecycle.md)
- [Кандидаты в агрегаты](candidate-aggregates.md)
- [Открытые вопросы моделирования](open-modeling-questions.md)
