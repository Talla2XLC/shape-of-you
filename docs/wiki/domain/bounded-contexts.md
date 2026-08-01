---
id: "domain-bounded-contexts"
kind: domain
title: "Предлагаемые bounded contexts"
status: draft
tags:
  - "bounded-contexts"
  - "domain"
---

# Предлагаемые bounded contexts

## Кратко

Принятый draft baseline содержит пять логических bounded contexts. Это границы моделирования, а не утверждённые deployable services.

## Содержание

### Сохранённые draft contexts

1. **Physical State and Goals** — цели, вес, состав тела, состояние долгосрочного прогресса и ограничения.
2. **Nutrition** — продукты, ингредиенты, бренды, история intake, нижние границы питания и inputs для рекомендаций.
3. **Training and Performance** — существующая программа, workouts, exercises, рабочие веса, история результатов, personal records и кандидаты на progression.
4. **Recovery and Readiness** — история восстановления, readiness evidence от wearable devices и inputs для оценки риска нагрузки за несколько дней.
5. **Coaching and Decision Support** — insights со ссылками на свидетельства, решения Load Risk и Weight Autopilot, согласованный дневной план.

### Общий conceptual pattern

`Observation` можно использовать как общую value structure или conceptual pattern. Это не отдельный bounded context, не владелец данных и не service boundary.

### Вспомогательные capabilities, а не contexts

- **Observation Intake and Timeline** — parsing естественного языка, clarification/rejection, validation, idempotent routing, provenance и append-only chronology.
- **Data Integrity and Migration** — reconciliation, детерминированный self-healing, backfill, evidence dual-run, integrity reports, cutover и rollback.

Такое представление не превращает технические workflows в DDD-границы до того, как инвентаризация источника выявит их язык, владение и consistency needs. Позднее они могут стать контекстами через review и ADR.

### Отношения контекстов

Coaching потребляет опубликованные свидетельства и решения доменных контекстов и не перезаписывает их факты. Intake направляет валидированные события в owning contexts. Data-integrity workflows сравнивают представления и применяют только явно безопасные corrections. Общая терминология не означает общий persistence.

### Предупреждение о deployment

Карта логическая. В modular monolith один модуль может первоначально реализовывать несколько контекстов. Контексты нельзя механически преобразовывать в microservices один к одному.

## Основания

- Инвентаризация Google Sheets выявила различия языка и владения для физического состояния, питания, тренировок, восстановления и coaching.
- [ADR о пяти draft bounded contexts](../../adr/20260728-retain-five-draft-bounded-contexts.md).

## Решения

- Сохранить пять draft contexts, пока уточняются aggregates и policies.
- В Physical State measurements принадлежат `Person` как immutable facts:
  вес хранится отдельными `WeightMeasurement`, а одна строка `Body` становится
  aggregate `BodyMeasurementSession` с typed values. Physical goals являются
  versioned plans, а не measurements или policies.
- В Nutrition переиспользуемые brands, ingredients и foods образуют общий
  версионируемый catalog, а aliases, preferred servings и private recipes
  остаются person-owned. `Meal` является person-owned immutable fact и
  сохраняет nutrient snapshot, закреплённый за временем intake.
- В Training определения exercises являются shared versioned reference data,
  а overlays, private exercises, program versions, sessions и performed sets
  принадлежат `Person`. Personal records и progression candidates являются
  projections; принятие progression создаёт новую program version.
- В Recovery provider/device model и capabilities являются shared reference
  data, а connection, consent, device instance и observations принадлежат
  `Person`.
- В Recovery observation root неизменяем и имеет типизированную detail для
  сна, числового показателя или субъективной отметки. Readiness и load-risk
  assessments закрепляются за policy version и evidence; Coaching владеет
  последующей рекомендацией, а не самой оценкой состояния.
- В Coaching policy definitions и versions являются shared, а targets,
  разрешённые overrides и decisions принадлежат `Person` и закрепляются за
  точной policy version.
- В Coaching recommendation является неизменяемым person-owned решением с
  типизированной detail и evidence links. Accepted/rejected decision хранится
  отдельно; expiration вычисляется, а execution принадлежит owning context.
- На этом этапе не объединять Physical State and Goals с Recovery and Readiness в контекст `Observations`.
- Распределение по сервисам или базам данных не утверждено.

## Открытые вопросы

- Какой контекст владеет policy закрытия дня и разрешением corrections.
- Оправдают ли вспомогательные capabilities независимые bounded contexts.
- Какой provider adapter и authenticated erasure workflow будут утверждены до
  работы с реальными wearable data.

## Связанные материалы

- [Обзор домена](overview.md)
- [Владение данными](../architecture/data-ownership.md)
- [Репозиторий и runtime](../architecture/repository-and-runtime.md)
- [Границы продукта](../product/scope.md)
- [BodyMeasurementSession](body-measurement-session.md)
- [PhysicalGoal](physical-goal.md)
- [Recovery and Readiness](recovery-and-readiness.md)
- [Coaching and Decision Support](coaching-and-decision-support.md)
- [Слоистый Nutrition catalog](../../adr/20260731-use-layered-versioned-nutrition-catalog.md)
- [Training and Performance](training-and-performance.md)
- [Версионируемые программы и факты тренировок](../../adr/20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
- [Shared reference definitions и person-owned state](../../adr/20260731-separate-shared-reference-definitions-from-person-owned-state.md)
