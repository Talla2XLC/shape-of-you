---
id: "decisions-20260802-use-durable-postgresql-intake-queue-and-typed-items"
kind: adr
title: "Надёжная PostgreSQL-очередь и типизированные элементы Intake"
status: accepted
date: 2026-08-02
supersedes: []
superseded_by: null
tags:
  - "intake"
  - "outbox"
  - "postgresql"
  - "queue"
---

# Надёжная PostgreSQL-очередь и типизированные элементы Intake

## Контекст

Один пользовательский текст может содержать несколько независимых фактов:
вес, приём пищи, тренировку и наблюдение о восстановлении. Внешний parser может
работать медленно, временно быть недоступен и требовать повторной попытки.
Неоднозначность одного факта не должна блокировать остальные, а повтор HTTP
request или worker retry не должен создавать дубликаты.

Intake является вспомогательной orchestration-capability, а не новым владельцем
предметных фактов. После подтверждения WeightMeasurement остаётся в Physical
State, Meal — в Nutrition, WorkoutSession — в Training, а RecoveryObservation
— в Recovery. Универсальный JSON payload ослабил бы типизацию, constraints и
границы ownership.

## Решение

Intake реализуется внутри существующего API modular monolith и использует его
PostgreSQL. Новый deployable service, отдельная database и внешний message
broker не создаются.

`IntakeRequest` принадлежит `Person` и хранит исходный текст, locale, timezone,
source reference, время получения и person/source-scoped idempotency key.
Исходный текст хранится как текст, а не как универсальный domain payload.

Parser-neutral port преобразует request в упорядоченные `IntakeItem`. Каждый
item имеет собственный тип и lifecycle, а его разобранные поля хранятся в
отдельной реляционной detail table для конкретной domain command. JSON/JSONB,
polymorphic `(type, id)` references и общая таблица произвольных facts не
используются. Ссылка на созданный domain fact также типизирована foreign key
соответствующей detail table.

Request сохраняется вместе с первым заданием в одной transaction. Задания
PostgreSQL-очереди содержат только типизированные references на request или
item, lease, число попыток, время следующей попытки и безопасный error code.
Worker забирает доступные задания через row locking с `SKIP LOCKED`, применяет
ограниченный retry с backoff и переводит исчерпанные задания в terminal state.

Parser вызывается вне database transaction. Его результат сохраняется одной
короткой transaction: typed items, их начальные состояния и append-only
timeline entries. Неоднозначный item ожидает clarification; однозначный —
confirmation. Подтверждение создаёт routing job.

Routing выполняется независимо для каждого item. Domain mutation, ссылка на
созданный domain fact, успешное состояние item и timeline entry фиксируются
одной database transaction. Для этого owning modules предоставляют
transaction-aware command ports, но не передают Intake ownership своих facts.

Общий status request является projection над parsing state и состояниями
items. Он не дублируется как независимо изменяемая business authority.
Timeline является append-only audit/read model, а не event sourcing.

Конкретный AI provider и его adapter выбираются отдельно. Domain model,
очередь, state machine и API не зависят от provider-specific identifiers или
payloads.

## Рассмотренные альтернативы

- Один синхронный HTTP request и одна transaction на весь исходный текст:
  проще, но внешний parser удерживает request, а одна ambiguity или ошибка
  блокирует все независимые facts. Отклонено.
- Независимые typed items без durable queue: сохраняет частичную обработку, но
  теряет надёжный retry и восстановление после перезапуска. Отклонено.
- PostgreSQL-backed queue и независимые typed items: даёт durability,
  clarification и idempotent retry без новой инфраструктуры. Выбрано.
- Kafka, RabbitMQ или отдельный Intake service: допускает независимое
  масштабирование, но преждевременно создаёт broker и deployable boundary.
  Отклонено до появления подтверждённой нагрузки или независимого lifecycle.
- Универсальный JSON/JSONB command envelope: быстро добавляет новые виды, но
  скрывает domain contract от PostgreSQL и TypeScript. Отклонено.

## Последствия

- Создание request возвращает `202 Accepted`; состояние читается отдельным
  query endpoint.
- Один request может быть partially completed: успешные items не откатываются
  из-за ambiguity или terminal failure другого item.
- Worker может безопасно работать в нескольких API replicas благодаря lease,
  locking и idempotency constraints.
- Добавление нового вида Intake требует typed contract, detail table, parser
  mapping, owning-module command port и tests.
- Очередь увеличивает число состояний и требует metrics для lag, retries,
  terminal failures и зависших leases.
- Вынос worker или замена transport возможны позже без изменения domain facts
  и публичного Intake lifecycle.

## Проверка

- Повтор request с тем же Person, source и idempotency key возвращает тот же
  IntakeRequest.
- Один текст создаёт несколько independently confirmable typed items.
- Ambiguous item не блокирует successful sibling item.
- Concurrent workers не исполняют одно задание дважды.
- Retry после сбоя не создаёт второй domain fact.
- Domain fact и successful item/timeline state появляются atomically.
- В schema отсутствуют универсальные JSON/JSONB payloads и polymorphic fact
  references.
- Перезапуск API не теряет доступные или leased с истёкшим сроком задания.

## Связанные материалы

- [Типизированный provenance и append-only supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [PostgreSQL outbox до Kafka](20260729-use-postgresql-outbox-before-kafka.md)
- [Предлагаемые bounded contexts](../wiki/domain/bounded-contexts.md)
- [Каталог поведения Google Sheets](../wiki/data/google-sheets-behavior-catalog.md)
- [План завершения DEV-023](../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
