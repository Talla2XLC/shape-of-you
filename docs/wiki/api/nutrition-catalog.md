---
id: "architecture-api-nutrition-catalog"
kind: architecture
title: "API Nutrition catalog"
status: draft
tags:
  - "api"
  - "catalog"
  - "nutrition"
  - "versioning"
---

# API Nutrition catalog

## Кратко

API предоставляет typed commands и reads для shared/private `Brand`,
`Ingredient`, `Food`, immutable versions и Person-owned `FoodOverlay`.

## Содержание

Endpoints:

- `POST /v1/nutrition/catalog/brands`;
- `POST /v1/nutrition/catalog/brands/:id/versions`;
- `GET /v1/nutrition/catalog/brands/:id`;
- аналогичные create/version/read endpoints для `ingredients` и `foods`;
- `PUT /v1/nutrition/catalog/foods/:id/overlay`.

Create command задаёт `visibility` и первую version. Version command требует
`expectedLockVersion`; stale write получает `409`. Read возвращает shared
identity либо private identity текущего `Person`; недоступный UUID выглядит
как `404`.

Food version содержит reference quantity/unit, nutrients, optional exact
`BrandVersion` и immutable composition. Shared food не принимает private
dependencies. Overlay заменяется целиком и требует либо оба preferred
quantity/unit, либо оба `null`.

Runtime пока работает с synthetic `Person`; production authentication,
moderation и отдельная shared-catalog write authorization не реализованы.
Поэтому подключение multi-user write traffic остаётся отдельным security gate.

## Основания

- `packages/contracts/src/nutrition.ts`.
- `apps/api/src/nutrition/`.
- `apps/api/src/storage/nutrition-repository.ts`.

## Решения

- Request и response проходят один JSON Schema contract.
- Version append и root switch выполняются одной transaction.
- Private access проверяется независимо от знания UUID.
- External source records не публикуются как remote scraping endpoint.

## Открытые вопросы

- Actor roles и moderation workflow для shared writes.
- Search, matching и pagination catalog после выбора concrete source.

## Связанные материалы

- [Nutrition catalog](../domain/nutrition-catalog.md)
- [API Meal](meals.md)
- [Backend runtime](../architecture/backend-runtime.md)
