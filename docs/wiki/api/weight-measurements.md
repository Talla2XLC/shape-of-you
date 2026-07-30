---
id: "architecture-api-weight-measurements"
kind: architecture
title: "API WeightMeasurement"
status: draft
tags:
  - "api"
  - "contract"
  - "weight"
---

# API WeightMeasurement

## Кратко

API создаёт и читает person-scoped неизменяемые `WeightMeasurement`, возвращает
текущее состояние и явную историю corrections. Runtime validation, TypeScript
types и OpenAPI используют schemas из `packages/contracts`.

## Содержание

Endpoints:

- `POST /v1/weight-measurements` — `201` для нового факта, `200` для
  существующего сочетания `Person`, source channel и `dedupeKey`;
- `POST /v1/weight-measurements/:id/corrections` — append-only correction:
  `201` для новой замены, `200` для idempotent retry и `409`, если факт уже
  заменён другой correction;
- `GET /v1/weight-measurements/:id/history` — вся цепочка от исходного до
  текущего факта;
- `GET /v1/weight-measurements/:id` — чтение по UUID, `404` при отсутствии;
- `GET /v1/weight-measurements?limit=50&cursor=...` — stable order
  `(measuredAt DESC, id DESC)`, opaque cursor и только текущие факты;
- `GET /openapi.json` — актуальный OpenAPI document.

Create принимает `measuredAt`, `timezone`, `weightKg`, `dedupeKey`, typed
`sourceReference` и optional nullable `confidence`. Correction принимает полный
replacement snapshot и обязательный `reason`. `personId` поступает из
проверяемого application context, а не из request body. `localDate`, `id` и
`createdAt` создаются сервером. Error responses имеют единый shape `statusCode`,
`error`, `message`.

Schemas запрещают неизвестные transport fields. Domain validation отдельно
проверяет IANA timezone и вычисляет local date.

## Основания

- `packages/contracts/src/weight-measurement.ts`.
- `apps/api/src/weight-measurements/weight-measurement.controller.ts`.
- Unit и integration tests API.

## Решения

- OpenAPI не поддерживается вручную отдельно от runtime schemas.
- Cursor является opaque contract; клиенты не должны конструировать его сами.
- Публичный `SourceReference` не раскрывает private raw source snapshot.

## Открытые вопросы

- До real-data gate synthetic `PersonContext` должен быть заменён
  authenticated adapter с проверкой активного `PersonAccessGrant`.

## Связанные материалы

- [WeightMeasurement](../domain/weight-measurement.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Migration notes](../data/backend-migrations.md)
