---
id: "domain-intake"
kind: domain
title: "Intake запросы и типизированные элементы"
status: draft
tags:
  - "domain"
  - "intake"
  - "queue"
---

# Intake запросы и типизированные элементы

## Кратко

Intake принимает пользовательский текст, разбирает его на независимо
подтверждаемые типизированные элементы и передаёт подтверждённые команды в
модули — владельцы предметных фактов. Intake координирует обработку, но не
становится владельцем веса, питания, тренировок или восстановления.

## Содержание

`IntakeRequest` принадлежит `Person` и хранит исходный текст, locale, timezone,
typed `SourceReference`, время получения и ключ идемпотентности. Повтор с теми
же `Person`, source channel и ключом возвращает тот же запрос.

Parser создаёт упорядоченные `IntakeItem`. Каждый элемент уточняется,
подтверждается, отклоняется и выполняется независимо от соседних элементов.
Состояние всего запроса вычисляется из состояния разбора и элементов; отдельная
изменяемая итоговая «истина» не хранится.

Сейчас реализован один тип элемента — `weight_measurement`. Предложенные поля
веса хранятся в отдельной реляционной таблице. После подтверждения Intake одной
транзакцией создаёт или находит `WeightMeasurement`, сохраняет типизированную
ссылку на него, завершает элемент и добавляет запись в журнал обработки.
Предметные поля созданного измерения в Intake не копируются.

Задания разбора и маршрутизации хранятся в PostgreSQL. Worker использует lease,
`SKIP LOCKED`, ограниченные повторы и задержку между попытками. Журнал Intake
добавляется только в конец и служит аудитом, а не источником event-sourcing.

Универсальные JSON/JSONB payload, полиморфные ссылки `(type, id)` и отдельный
владелец общих фактов не используются.

## Основания

- `apps/api/src/domain/intake.ts`.
- `apps/api/src/storage/intake-repository.ts`.
- PostgreSQL integration tests в `apps/api/test/intake.integration.test.ts`.

## Решения

- [PostgreSQL-очередь и типизированные элементы Intake](../../adr/20260802-use-durable-postgresql-intake-queue-and-typed-items.md).
- [Типизированный provenance и append-only supersession](../../adr/20260730-use-typed-provenance-and-append-only-supersession.md).

## Открытые вопросы

- Выбор и реализация production adapter для AI parser.
- Последовательное добавление типизированных маршрутов Meal,
  BodyMeasurementSession, Training и Recovery.
- Контракт метрик задержки очереди, повторов и terminal failures.

## Связанные материалы

- [API Intake](../api/intake.md)
- [WeightMeasurement](weight-measurement.md)
- [Предлагаемые bounded contexts](bounded-contexts.md)
- [Backend runtime](../architecture/backend-runtime.md)

