---
id: "domain-meal"
kind: domain
title: "Meal"
status: draft
tags:
  - "facts"
  - "meals"
  - "nutrition"
  - "snapshots"
---

# Meal

## Summary

`Meal` is an immutable Person-owned nutrition fact. It may reference an exact
FoodVersion but always owns a nutrient snapshot so later catalog revisions do
not rewrite history.

## Content

Meal stores explicit temporal precision, local date/timezone,
source/dedupe/confidence, meal type, note, and typed items. Interactive and
existing Meals use `instant` and require `occurredAt`; imported date-only Meals
use `local_date` and require `occurredAt = null`. The system never substitutes
midnight for an unknown time. Each item stores quantity, controlled unit,
calories, protein, fat, and carbs; numeric constraints prevent negative values
and invalid totals.

The Fitness Tracker Nutrition adapter maps one valid legacy `Meals` row to one
Meal plus one immutable item with `quantity = 1` and `unit = serving`. The item
preserves the row's nutrient totals; it does not claim an unknown weight or
reconstruct ingredients. A Food link is written only after exact valid catalog
resolution. Unsupported kinds, Photo markers, missing nutrients, and broken
links block apply.

Correction creates a complete replacement with `supersedes_id`. Current/history
queries follow the same append-only semantics as other facts. Daily totals are
a query projection over current Meals for Person and local date, not a
`DayRecord` or authority table.

## Evidence

- Nutrition schema, contracts, migration tests, importer tests, and the
  accepted TASK-0049 live dry-run.

## Decisions

- Snapshot duplication is intentional for reproducibility.
- Date-only imported Meals preserve `local_date`; public writes remain
  instant-only.

## Open questions

- Final unit/conversion vocabulary and media attachment lifecycle.

## Related material

- [Meal API](../api/meals.md)
- [Nutrition catalog](nutrition-catalog.md)
- [Layered Nutrition ADR](../../adr/20260731-use-layered-versioned-nutrition-catalog.md)
- [Nutrition import ADR](../../adr/20260824-import-nutrition-as-one-typed-fitness-tracker-domain.md)
