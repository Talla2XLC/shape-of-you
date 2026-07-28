---
id: decisions-20260728-retain-five-draft-bounded-contexts
kind: adr
title: "Сохранение пяти draft bounded contexts"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - bounded-contexts
  - domain
  - modular-monolith
---

# Сохранение пяти draft bounded contexts

## Контекст

Инвентаризация источника подтвердила различия в языке и владении для физического состояния, питания, тренировок, восстановления и coaching. Предложенный контекст `Observations` уменьшил бы число границ, но преждевременно объединил бы lifecycle физического состояния и восстановления до понимания различий в privacy, policies и consistency.

## Решение

Сохранить пять draft bounded contexts:

1. Physical State and Goals.
2. Nutrition.
3. Training and Performance.
4. Recovery and Readiness.
5. Coaching and Decision Support.

`Observation` можно использовать как общий conceptual pattern или value structure. Это не bounded context и не граница deployable service.

## Рассмотренные альтернативы

- Объединить Physical State and Goals и Recovery and Readiness в Observations: отложено, поскольку упрощение может скрыть различия во владении, privacy и lifecycle.
- Создать отдельный контекст для каждой таблицы или AI engine: отклонено как проектирование от структуры таблицы и преждевременная декомпозиция.
- Сразу преобразовать пять контекстов в сервисы: отклонено как преждевременная микросервисность.

## Последствия

- Логическая context map остаётся стабильной, пока уточняются агрегаты и policies.
- Один modular backend первоначально может реализовывать несколько контекстов.
- Общие структуры observation не должны создавать совместное владение базой данных.
- Любое объединение, разделение или распределение по deployable units требует следующего ADR.

## Проверка

- Предложения модулей должны относить ответственность к одному из пяти контекстов либо к явно вспомогательной технической capability.
- Architecture Review должен проверять, что Observation не превратился в неявный сервис или общий агрегат.

## Связанные материалы

- [Bounded contexts](../wiki/domain/bounded-contexts.md)
- [Обзор домена](../wiki/domain/overview.md)
- [Репозиторий и runtime](../wiki/architecture/repository-and-runtime.md)
