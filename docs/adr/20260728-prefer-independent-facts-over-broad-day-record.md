---
id: decisions-20260728-prefer-independent-facts-over-broad-day-record
kind: adr
title: "Независимые факты вместо широкого DayRecord"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - aggregates
  - domain
  - day-lifecycle
---

# Независимые факты вместо широкого DayRecord

## Контекст

Инвентаризация Google Sheets показала, что `Daily_Log` объединяет физические измерения, итоги питания, состояние тренировок, свидетельства восстановления, readiness и coaching outputs. Если считать такую строку единым агрегатом, legacy-связанность таблицы перейдёт в доменную модель.

## Решение

Моделировать питание, вес, тренировки, восстановление и coaching outputs как независимо принадлежащие факты или производные артефакты. `Daily_Log` рассматривать преимущественно как legacy read model и migration projection.

Узкий draft-кандидат с именем `DayClosure` или `JournalDay` может координировать только календарную дату и timezone пользователя, lifecycle open/closed, время закрытия, explicit corrections, ссылки на подтверждённые факты и создание дневной projection. Окончательное имя и invariants не утверждены.

## Рассмотренные альтернативы

- Широкий агрегат `DayRecord`, владеющий всеми дневными данными, отклонён: он пересекает доменные границы владения и создаёт слишком большую consistency boundary.
- Сохранение строки таблицы как будущей persistence model отклонено: формулы и AI outputs являются projections, а не исходными фактами.
- Полный отказ от координации по дате отложен: закрытие дня и explicit corrections всё ещё требуют моделирования.

## Последствия

- Доменные модули могут независимо развиваться внутри modular monolith.
- Дневные представления требуют явной композиции projections.
- Закрытие дня не может неявно получить владение фактами, на которые оно ссылается.
- Междоменные требования согласованности выражаются ссылками, policies или событиями, а не одной гигантской транзакцией.

## Проверка

- Candidate aggregates не должны владеть фактами из нескольких bounded contexts.
- Migration mapping должен классифицировать каждое поле `Daily_Log` как факт, ссылку, policy input или projection.
- Architecture Review должен отклонить широкий дневной агрегат, если новое ADR не заменит это решение.

## Связанные материалы

- [Кандидаты в агрегаты](../wiki/domain/candidate-aggregates.md)
- [Карта извлечения домена](../wiki/domain/domain-extraction-map.md)
- [Инвентаризация Google Sheets](../wiki/data/google-sheets-inventory.md)
