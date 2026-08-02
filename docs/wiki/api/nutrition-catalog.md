---
id: "architecture-api-nutrition-catalog"
kind: architecture
title: "Nutrition catalog API"
status: draft
tags:
  - "api"
  - "catalog"
  - "nutrition"
  - "versioning"
---

# Nutrition catalog API

## Summary

Provides typed commands/reads for shared/private Brand, Ingredient, Food,
immutable versions, and Person-owned FoodOverlay.

## Content

- `POST /v1/nutrition/catalog/brands`, `/:id/versions`, and `GET /:id`;
- equivalent endpoints for `ingredients` and `foods`;
- `PUT /v1/nutrition/catalog/foods/:id/overlay`.

Create defines visibility and initial version. Version append requires
`expectedLockVersion`; stale writes return `409`. Reads expose shared or
current-Person private identity; inaccessible UUIDs return `404`.

FoodVersion stores reference quantity/unit, nutrients, optional exact
BrandVersion, and immutable composition. Shared food cannot depend on private
definitions. Overlay replacement requires both preferred quantity/unit or both
null.

Synthetic Person runtime is not production authentication or shared-catalog
moderation. External staged records are not remote scraping endpoints.

## Evidence

- Nutrition contracts/module/repository.

## Decisions

- Version append and root switch are one transaction; schemas drive runtime and
  OpenAPI; UUID knowledge does not bypass private access.

## Open questions

- Shared-write roles/moderation and catalog search/matching/pagination.

## Related material

- [Nutrition catalog](../domain/nutrition-catalog.md)
- [Meal API](meals.md)
