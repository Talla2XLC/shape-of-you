---
id: "domain-domain-extraction-map"
kind: domain
title: "Карта извлечения домена"
status: draft
tags:
  - "domain"
  - "extraction"
  - "google-sheets"
---

# Карта извлечения домена

## Кратко

Draft-карта от механизмов таблицы к доменным понятиям. Она отделяет основные fitness-факты и policies от projections, integration workflows и project governance. Это свидетельство для обсуждения архитектуры, а не утверждённая финальная модель.

## Содержание

| Область таблицы | Доменная интерпретация | Форма authority |
| --- | --- | --- |
| Weight, Body, goals | Physical State and Goals | Независимые измерения и факты целей |
| Foods, Ingredients, Brands, Food_Ingredients, Meals | Nutrition | Общий версионируемый catalog, person-owned overlays, факты intake и immutable snapshots |
| Training, Program, Personal Records | Training and Performance | Версионируемые prescriptions, sessions, выполненная работа и derived records |
| Wearable и recovery evidence | Recovery and Readiness | Observations и readiness assessments с сохранением provenance |
| AI Insights, Load Risk, Weight Autopilot, Coach Planner | Coaching and Decision Support | Рекомендации и решения со ссылками на свидетельства |
| Daily_Log и Dashboard | Межконтекстные projections | Legacy read models, а не aggregate roots |

Intake, reconciliation, timeline и self-healing — вспомогательные технические capabilities. Они направляют или сравнивают факты, но не становятся bounded contexts только потому, что workbook выделяет для них отдельные листы.

## Основания

Классификация и зависимости описаны в `../data/google-sheets-inventory.md`, особенно cross-sheet formulas и контракты AI workflows.

## Решения

Использовать пять сохранённых draft bounded contexts внутри первоначально modular backend, а также явные adapters и read models. Governance остаётся вне runtime domain. Это логическая модель, а не решение о service topology.

Nutrition catalog является общим reference knowledge, а не копией на каждого
`Person` и не adapter cache одного provider. External source records проходят
staging и explicit matching, после чего могут создавать новую canonical
revision. Person-owned `Meal` ссылается на точную catalog version и сохраняет
собственный nutrient snapshot.

## Открытые вопросы

- Какой точный lifecycle и invariants обосновывают узкий кандидат `DayClosure` или `JournalDay`?
- Должен ли GoalProfile принадлежать Coaching или отдельному модулю Profile?
- Какие конкретные внешние nutrition sources допустимы по качеству, license,
  attribution и rate limits?
- Требуют ли health-device observations отдельной границы Health Data из-за privacy и consent?

## Связанные материалы

- [Кандидаты в агрегаты](candidate-aggregates.md)
- [Invariants](invariants.md)
- [Source of truth и authority](../data/source-of-truth-and-authority.md)
- [Слоистый Nutrition catalog](../../adr/20260731-use-layered-versioned-nutrition-catalog.md)
