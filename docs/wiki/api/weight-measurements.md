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

API создаёт и читает неизменяемые `WeightMeasurement`. Runtime validation,
TypeScript types и OpenAPI используют schemas из `packages/contracts`.

## Содержание

Endpoints:

- `POST /v1/weight-measurements` — `201` для нового факта, `200` для
  существующего `dedupeKey`;
- `GET /v1/weight-measurements/:id` — чтение по UUID, `404` при отсутствии;
- `GET /v1/weight-measurements?limit=50&cursor=...` — stable order
  `(measuredAt DESC, id DESC)` и opaque cursor;
- `GET /openapi.json` — актуальный OpenAPI document.

POST принимает `measuredAt`, `timezone`, `weightKg`, `source`, `dedupeKey`,
`provenance` и optional nullable `sourceRecordId`/`confidence`. `localDate`,
`id` и `createdAt` создаются сервером. Error responses имеют единый shape
`statusCode`, `error`, `message`.

Schemas запрещают неизвестные transport fields. Domain validation отдельно
проверяет IANA timezone и вычисляет local date.

## Основания

- `packages/contracts/src/weight-measurement.ts`.
- `apps/api/src/routes/weight-measurements.ts`.
- Unit и integration tests API.

## Решения

- OpenAPI не поддерживается вручную отдельно от runtime schemas.
- Cursor является opaque contract; клиенты не должны конструировать его сами.

## Открытые вопросы

- Auth и subject ownership будут добавлены отдельной задачей.
- Contract corrections отсутствует.

## Связанные материалы

- [WeightMeasurement](../domain/weight-measurement.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Migration notes](../data/backend-migrations.md)
