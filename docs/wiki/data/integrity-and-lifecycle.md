---
id: "data-integrity-and-lifecycle"
kind: data
title: "Целостность и lifecycle"
status: draft
tags:
  - "data"
  - "integrity"
  - "lifecycle"
---

# Целостность и lifecycle

## Кратко

Контракт lifecycle и целостности, извлечённый из наблюдаемых statuses, formulas, правил deduplication, требований read-back и append-only соглашений audit.

## Содержание

Наблюдаемые workflows используют явные statuses, idempotency keys, validation, проверки read-back и append-only audit entries. Эти механизмы следует реализовывать как небольшие state machines внутри owning modules, а не как отдельные сервисы.

День в локальном времени пользователя может иметь lifecycle open/closed, но закрытие не должно делать объект календарной даты владельцем фактов питания, тренировок, физического состояния, восстановления или coaching. Corrections остаются явными и сохраняют provenance.

## Основания

Валидация Daily_Log; схема NL_Engine; контракт очереди AI_Inbox; контракт выполнения Self_Healing; append-only контракт AI_Timeline; примеры правил AI_Insights; hard stops Load_Risk; gates Weight_Autopilot; порядок приоритетов Coach_Planner; наблюдаемая ошибка projection в Dashboard.

## Решения

Draft-рекомендация: явно моделировать state machines lifecycle внутри модулей, но не выделять каждый workflow в deployable service. Критичные gates здоровья и безопасности, а также защита закрытого дня требуют отдельного утверждения до реализации.

## Открытые вопросы

- Разрешено ли повторно открывать Closed day и кто это утверждает?
- Какова retention policy для `source_text`, фотографий и device evidence?
- Какие ошибки требуют уведомления пользователя, а какие — retry?
- Какая transaction boundary ожидается, когда во время работы через таблицу одно событие обновляет и Weight, и Daily_Log?

## Связанные материалы

- [Source of truth и authority](source-of-truth-and-authority.md)
- [Доменные invariants](../domain/invariants.md)
- [Открытые вопросы моделирования](../domain/open-modeling-questions.md)
