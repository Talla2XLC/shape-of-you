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

Controlled historical import may return item nutrient components and exact
totals as `null`, with `nutritionCompleteness = partial`. Null means unknown and
is never converted to zero. Daily totals also return `incompleteMealCount`; an
exact component total is null when any current item lacks that component.
Public create/correction inputs remain complete-only. Progress metrics omit an
incomplete date instead of publishing a known-subset sum as the full value.

## Evidence

- Nutrition contracts/controller/integration tests.

## Decisions

- Responses/totals reproduce stored item snapshots; catalog revisions do not
  change Meal; totals are not a mutable table.
- Partial historical evidence is read-compatible without weakening operational
  write validation.

## Open questions

- Nutrition targets and longer-term aggregation policy for partial Meals.

## Related material

- [Meal](../domain/meal.md)
- [Catalog API](nutrition-catalog.md)
