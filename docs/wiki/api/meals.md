---
id: "architecture-api-meals"
kind: architecture
title: "Meal API"
status: draft
tags:
  - "api"
  - "meals"
  - "nutrition"
  - "snapshots"
---

# Meal API

## Summary

Creates/reads Person-owned Meal snapshots, full-replacement corrections, and
query-only daily nutrition totals.

## Content

- `POST /v1/nutrition/meals` — idempotent create.
- `GET /v1/nutrition/meals` — current facts with cursor/localDate.
- `GET /v1/nutrition/meals/:id` — any immutable fact.
- `POST /v1/nutrition/meals/:id/corrections` — append-only replacement.
- `GET /v1/nutrition/meals/:id/history` — correction chain.
- `GET /v1/nutrition/daily-totals?localDate=YYYY-MM-DD` — projection.

Commands contain complete item snapshots. Optional accessible `foodVersionId`
never replaces the snapshot. Existing dedupe returns `200`, new fact `201`, and
conflicting second correction `409`. Current list uses
`(occurredAt DESC, id DESC)`. Totals include only current Meals.

## Evidence

- Nutrition contracts/controller/integration tests.

## Decisions

- Responses/totals reproduce stored item snapshots; catalog revisions do not
  change Meal; totals are not a mutable table.

## Open questions

- Nutrition targets, combined day projection, and post-DayClosure correction.

## Related material

- [Meal](../domain/meal.md)
- [Catalog API](nutrition-catalog.md)
