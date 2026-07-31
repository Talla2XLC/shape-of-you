---
id: "domain-candidate-aggregates"
kind: domain
title: "Кандидаты в агрегаты"
status: draft
tags:
  - "aggregates"
  - "domain"
  - "draft"
---

# Кандидаты в агрегаты

## Кратко

Draft-кандидаты в агрегаты выведены из наблюдаемых consistency boundaries. Их намеренно меньше, чем 26 листов, и они не сопоставлены с deployable services.

## Содержание

### Независимые факты

Candidate consistency boundaries узки и принадлежат соответствующим контекстам: измерения веса и тела, записи приёмов пищи, тренировочные сессии и выполненные подходы, observations восстановления и coaching decisions. Дневные projections составляют ссылки на эти факты, но не владеют ими.

В Nutrition `Food` является стабильной catalog identity с immutable
`FoodVersion`, а `Meal` — отдельным person-owned immutable fact. Meal items
могут ссылаться на точную catalog version, но их nutrient snapshot принадлежит
самому факту intake. Shared catalog и personal overlay не образуют один
aggregate: персональная ссылка не копирует и не изменяет canonical content.

### Кандидат lifecycle по дате

`DayClosure` или `JournalDay` остаётся узким draft-кандидатом. Он может владеть календарной датой и timezone пользователя, lifecycle open/closed, временем закрытия, explicit corrections, ссылками на подтверждённые факты и созданием дневной projection. Имя и точные invariants ещё не утверждены.

### Legacy-проекция

`Daily_Log` рассматривается преимущественно как legacy read model и migration projection. Он не доказывает необходимость единого агрегата, охватывающего питание, вес, тренировки, восстановление и coaching.

## Основания

Наблюдаемые grouping по Session_ID; prescription Program и derived columns; Meals со ссылкой на catalog и nutrient snapshot; status Daily_Log со смешанными facts/projections; append-only и recommend-only контракты workflows.

## Решения

Не создавать агрегат на каждый лист или широкий `DayRecord`. Предпочитать
независимые факты и projections по дате. Shared reference catalog не смешивать
с person-owned facts. См. [ADR о независимых фактах](../../adr/20260728-prefer-independent-facts-over-broad-day-record.md)
и [ADR о Nutrition catalog](../../adr/20260731-use-layered-versioned-nutrition-catalog.md).

## Открытые вопросы

- Проверяет ли закрытие дня только ссылки или также создаёт immutable snapshot?
- Могут ли исторические prescriptions Program изменяться или каждое изменение создаёт версию?
- Какой минимальный controlled vocabulary units нужен для catalog composition
  и meal quantities без неявных conversion rules?
- Допустимы ли несколько измерений веса за одну дату?
- Какая moderation policy потребуется перед автоматизацией external catalog
  matching?

## Связанные материалы

- [Карта извлечения домена](domain-extraction-map.md)
- [Invariants](invariants.md)
- [Открытые вопросы моделирования](open-modeling-questions.md)
