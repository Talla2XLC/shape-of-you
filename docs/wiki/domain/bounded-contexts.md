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
- На этом этапе не объединять Physical State and Goals с Recovery and Readiness в контекст `Observations`.
- Распределение по сервисам или базам данных не утверждено.

## Открытые вопросы

- Принадлежит ли wearable ingestion контексту Recovery или integration boundary.
- Принадлежит ли Load Risk контексту Recovery или Coaching.
- Какой контекст владеет policy закрытия дня и разрешением corrections.
- Оправдают ли вспомогательные capabilities независимые bounded contexts.

## Связанные материалы

- [Обзор домена](overview.md)
- [Владение данными](../architecture/data-ownership.md)
- [Репозиторий и runtime](../architecture/repository-and-runtime.md)
- [Границы продукта](../product/scope.md)
