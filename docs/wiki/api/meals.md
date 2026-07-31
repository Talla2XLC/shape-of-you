---
id: "architecture-api-meals"
kind: architecture
title: "API Meal"
status: draft
tags:
  - "api"
  - "meals"
  - "nutrition"
  - "snapshots"
---

# API Meal

## Кратко

API создаёт и читает Person-owned Meal snapshots, добавляет full-replacement
corrections и вычисляет текущие дневные nutrition totals.

## Содержание

Endpoints:

- `POST /v1/nutrition/meals` — idempotent create;
- `GET /v1/nutrition/meals` — current facts с `limit`, `cursor` и optional
  `localDate`;
- `GET /v1/nutrition/meals/:id` — конкретный immutable fact, включая
  superseded;
- `POST /v1/nutrition/meals/:id/corrections` — append-only replacement;
- `GET /v1/nutrition/meals/:id/history` — полная correction chain;
- `GET /v1/nutrition/daily-totals?localDate=YYYY-MM-DD` — query projection.

Create и correction принимают complete item snapshots. Accessible
`foodVersionId` optional и не заменяет snapshot. Повторный dedupe key
возвращает существующий fact с `200`, новый fact — `201`. Попытка второй
отличающейся correction одного fact возвращает `409`.

Current list использует keyset order `(occurredAt DESC, id DESC)`. History
читает только строки correction chain, а не все meals `Person`. Daily totals
суммируют item snapshots только тех Meal, у которых нет successor.

## Основания

- `packages/contracts/src/nutrition.ts`.
- `apps/api/src/nutrition/meal.controller.ts`.
- PostgreSQL integration tests Nutrition vertical.

## Решения

- Response totals воспроизводятся из сохранённых item snapshots.
- Catalog changes не меняют Meal response.
- Query projection не хранится отдельной mutable table.

## Открытые вопросы

- Nutrition targets и combined day projection.
- Policy изменения Meal после будущего `DayClosure`.

## Связанные материалы

- [Meal](../domain/meal.md)
- [API Nutrition catalog](nutrition-catalog.md)
- [Backend migration notes](../data/backend-migrations.md)
