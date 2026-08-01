---
id: "domain-coaching-and-decision-support"
kind: domain
title: "Coaching and Decision Support"
status: draft
tags:
  - "coaching"
  - "decisions"
  - "domain"
  - "recommendations"
---

# Coaching and Decision Support

## Кратко

Контекст реализован в API и отделяет неизменяемую рекомендацию, решение
пользователя и выполненный факт. Первый срез ограничен типизированной
корректировкой тренировочного назначения и не применяет её автоматически.

## Содержание

- Shared `CoachingPolicy` имеет неизменяемые типизированные версии.
- `CoachingRecommendation` принадлежит `Person`, закреплена за точной policy
  version и сохраняет срок действия, объяснение и checksum свидетельств.
- Каждый вид рекомендации имеет собственную типизированную detail и явные
  evidence links с внешними ключами. Доменное содержимое не хранится в JSON.
- `RecommendationDecision` отдельно фиксирует `accepted` или `rejected`.
  Recommendation не переписывается при решении пользователя.
- `expired` вычисляется для рекомендации без решения после `expires_at`.
- Принятие не означает выполнение и не меняет owning domain.
- Первый `training_adjustment` читает Recovery assessment и Training evidence,
  но может предложить только удержание назначения, новый целевой вес или новый
  диапазон повторений. Одновременно меняется один параметр.
- Реальное применение требует отдельной команды Training и созданного там
  факта или версии программы.

### Реализованный контракт API

- `POST /v1/coaching/recommendations/training-adjustments` явно рассчитывает
  одну рекомендацию по точной `CoachingPolicyVersion`, существующему
  `RecoveryAssessment` и назначению активной `TrainingProgramVersion`.
- `GET /v1/coaching/recommendations` возвращает ограниченный список и
  поддерживает фильтр по derived state; `GET
  /v1/coaching/recommendations/{id}` читает одну проекцию.
- `GET /v1/coaching/recommendations/{id}/history` возвращает неизменяемую
  рекомендацию и не более одного терминального решения.
- `POST /v1/coaching/recommendations/{id}/decisions` отдельно записывает
  `accepted` или `rejected` с actor, причиной, временем и ключом
  идемпотентности. Противоположное решение и решение после expiration дают
  conflict.
- Повтор evaluation или decision сериализуется person-scoped lock и
  возвращает существующий результат. Другой `Person` не видит рекомендацию и
  не может принять по ней решение.
- Схема хранит policy version, recommendation root, training-adjustment
  detail, Recovery/Training evidence и decision в типизированных реляционных
  таблицах с foreign keys и checks. Доменного JSON/JSONB payload нет.
- Поддерживаются `hold`, `target_weight` и `repetition_range`; один результат
  меняет не более одного параметра. Расчёт и решение не изменяют Recovery или
  Training.

## Основания

- Контракты `AI_Insights`, `Weight_Autopilot` и `Coach_Planner` в
  authoritative workbook.
- [Каталог поведения Google Sheets](../data/google-sheets-behavior-catalog.md).
- [Доменные invariants](invariants.md).

## Решения

- [ADR о рекомендациях и решениях пользователя](../../adr/20260731-model-immutable-coaching-recommendations-and-separate-user-decisions.md).
- [ADR о shared policy definitions](../../adr/20260731-separate-shared-reference-definitions-from-person-owned-state.md).
- [ADR о Recovery assessments](../../adr/20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md).

## Открытые вопросы

- Production policy parameters и право активации общей policy version.
- Типизированная модель сложности и замены упражнения в Training.
- Связь принятой рекомендации с последующим фактом выполнения.
- Nutrition/recovery guidance, insight analytics и daily planner после
  проектирования соответствующих contracts и day lifecycle.

## Связанные материалы

- [Bounded contexts](bounded-contexts.md)
- [Кандидаты в агрегаты](candidate-aggregates.md)
- [Recovery and Readiness](recovery-and-readiness.md)
- [Training and Performance](training-and-performance.md)
- [Завершённый план реализации](../../../plans/2026/07/completed/2026-07-31-coaching-recommendation-lifecycle.md)
