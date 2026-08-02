---
id: "architecture-api-intake"
kind: architecture
title: "API Intake"
status: draft
tags:
  - "api"
  - "contract"
  - "intake"
---

# API Intake

## Кратко

API асинхронно принимает пользовательский текст, возвращает текущее состояние
разбора и позволяет независимо уточнить, подтвердить или отклонить каждый
типизированный элемент.

## Содержание

Endpoints:

- `POST /v1/intake/requests` — сохраняет запрос и задание в одной транзакции,
  возвращает `202 Accepted`, не ожидая parser;
- `GET /v1/intake/requests/:id` — возвращает состояние разбора, вычисленный
  статус запроса и его элементы;
- `POST /v1/intake/requests/:id/items/:itemId/clarification` — сохраняет ответ
  на вопрос и ставит повторный разбор элемента в очередь, возвращает `202`;
- `POST /v1/intake/requests/:id/items/:itemId/decision` — независимо
  подтверждает или отклоняет элемент, возвращает `202`;
- `GET /openapi.json` — актуальный OpenAPI из shared JSON Schemas.

Создание принимает `text`, `locale`, IANA `timezone`, typed
`sourceReference` и `idempotencyKey`. Уточнение принимает `answer` и отдельный
ключ идемпотентности. Решение принимает `confirm` или `reject` и отдельный ключ
идемпотентности.

Projection запроса показывает `parsingStatus`, вычисленный `status`, безопасный
`failureCode` и упорядоченные элементы. В первом срезе поддерживается только
`weight_measurement`; завершённый элемент содержит UUID созданного
`WeightMeasurement`.

Все операции ограничены текущим `Person`. Повторные запросы и команды с теми же
ключами идемпотентности безопасны. Исходный текст сохраняется в запросе, но не
попадает в application logs или сообщения об ошибках.

Production parser пока не подключён. Без него запрос остаётся надёжно сохранён
в очереди и не мешает readiness API; интеграционный контракт проверяется
synthetic parser только в тестах.

## Основания

- `packages/contracts/src/intake.ts`.
- `apps/api/src/intake/intake.controller.ts`.
- `apps/api/test/intake.integration.test.ts`.

## Решения

- [PostgreSQL-очередь и типизированные элементы Intake](../../adr/20260802-use-durable-postgresql-intake-queue-and-typed-items.md).
- OpenAPI не поддерживается отдельно от runtime schemas.

## Открытые вопросы

- Production AI adapter и его операционные ограничения.
- Аутентифицированный `PersonContext` до работы с реальными данными.

## Связанные материалы

- [Домен Intake](../domain/intake.md)
- [API WeightMeasurement](weight-measurements.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Migration notes](../data/backend-migrations.md)

