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

Meal stores time/local date/timezone, source/dedupe/confidence, meal type, note,
and typed items. Each item stores quantity, controlled unit, calories, protein,
fat, and carbs; numeric constraints prevent negative values and invalid totals.

Correction creates a complete replacement with `supersedes_id`. Current/history
queries follow the same append-only semantics as other facts. Daily totals are
a query projection over current Meals for Person and local date, not a
`DayRecord` or authority table.

## Evidence

- Nutrition schema, contracts, and integration tests.

## Decisions

- Snapshot duplication is intentional for reproducibility.

## Open questions

- Final unit/conversion vocabulary and media attachment lifecycle.

## Related material

- [Meal API](../api/meals.md)
- [Nutrition catalog](nutrition-catalog.md)
- [Layered Nutrition ADR](../../adr/20260731-use-layered-versioned-nutrition-catalog.md)
