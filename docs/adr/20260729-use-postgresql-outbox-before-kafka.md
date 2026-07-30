---
id: "decisions-20260729-use-postgresql-outbox-before-kafka"
kind: adr
title: "PostgreSQL transactional outbox до появления оснований для Kafka"
status: accepted
date: 2026-07-29
supersedes: []
superseded_by: null
tags:
  - "events"
  - "kafka"
  - "postgresql"
  - "runtime"
---

# PostgreSQL transactional outbox до появления оснований для Kafka

## Контекст

Будущие intake, projections, audit и coaching workflows требуют надёжной
асинхронной обработки и typed domain events. При этом текущая topology содержит
один deployable backend, одну принадлежащую ему PostgreSQL database и не имеет
независимо развёртываемых consumers.

Немедленное добавление Kafka потребовало бы broker operations, topics,
partitions, retention, schema compatibility, consumer groups, retries, DLQ,
lag monitoring и решения dual-write между PostgreSQL и Kafka. Kafka сама по
себе не устраняет необходимость idempotency.

## Решение

Не вводить Kafka в текущую topology.

Когда первая подтверждённая asynchronous command boundary потребует durable
processing, использовать PostgreSQL transactional outbox:

- domain mutation и outbox record создаются одной database transaction;
- event имеет stable type, version, aggregate/source reference, occurred time,
  payload и dedupe identity;
- worker забирает записи безопасно для нескольких instances;
- handlers являются idempotent;
- retry state и failure diagnostics сохраняются явно;
- успешная обработка не превращает outbox в domain authority.

Не создавать outbox tables заранее без первого реального asynchronous
workflow. Domain code публикует typed events через application boundary, не
зависящую от будущего transport.

Kafka рассматривается повторно, когда существует хотя бы один подтверждённый
driver:

- несколько независимо deployable consumers одного event stream;
- требование массового replay или длительного durable log;
- throughput, который PostgreSQL worker не выдерживает по измерениям;
- независимое масштабирование и failure isolation consumers;
- интеграция с streaming analytics или внешней event platform;
- операционная готовность сопровождать broker cluster.

При принятии Kafka transactional outbox остаётся источником атомарной
публикации, а relay меняет transport на Kafka.

## Рассмотренные альтернативы

- Только синхронные вызовы: максимально просто, но не покрывает durable retries
  и eventual projections при появлении длительных workflows.
- Kafka сейчас: даёт durable stream и replay, но не имеет оправдывающих
  consumers или load и создаёт существенную operational complexity.
- Redis queue: удобна для jobs, но добавляет второй stateful datastore и не
  решает атомарность PostgreSQL mutation без outbox.
- PostgreSQL outbox и worker: сохраняет атомарность в одной database и даёт
  эволюционный путь к Kafka. Выбрано.
- Полный event sourcing: обеспечивает replay всей модели, но для текущих
  требований избыточен; domain tables остаются authority.

## Последствия

- Текущая staging topology не получает новый stateful component.
- Асинхронные handlers обязаны учитывать at-least-once delivery.
- Event contracts versioned независимо от внутренней формы domain entities.
- Outbox retention, cleanup, retry limits и observability должны быть
  определены вместе с первым использующим workflow.
- Append-only audit timeline и outbox имеют разное назначение и не должны
  объединяться в одну authority table.
- Переход на Kafka остаётся возможным без переписывания domain policies.

## Проверка

- Integration test подтверждает атомарность domain mutation и outbox insert.
- Повторная доставка не создаёт duplicate effect.
- Concurrent workers не обрабатывают одну запись одновременно.
- Failure сохраняет retry state и не теряет событие.
- Architecture Review перед Kafka проверяет drivers, нагрузку, consumers,
  ownership и операционную готовность.

## Связанные материалы

- [API- или event-only cross-service communication](20260728-api-or-event-only-cross-service-communication.md)
- [PostgreSQL с Drizzle](20260728-use-postgresql-with-drizzle-orm-and-kit.md)
- [Целостность и lifecycle](../wiki/data/integrity-and-lifecycle.md)
- [План завершения DEV-023](../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
