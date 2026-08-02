---
id: "domain-nutrition-catalog"
kind: domain
title: "Nutrition catalog"
status: draft
tags:
  - "catalog"
  - "nutrition"
  - "ownership"
  - "versioning"
---

# Nutrition catalog

## Summary

The Nutrition catalog reuses Brands, Ingredients, and Foods without copying
canonical content per Person. Definitions use immutable versions; preferences
use separate overlays.

## Content

Shared and private definitions have stable identity plus immutable revisions.
`FoodVersion` pins nutrition basis and exact Ingredient revisions. Shared
versions cannot depend on private content.

Person overlays store alias, favorite/hidden state, and preferred serving as
references, not copied definitions. Private foods/recipes have an owner and are
not published automatically.

External `CatalogSourceRecord` is source-neutral staging with provider key,
external ID, checksum, parser version, license/terms, and review state. Import
is idempotent within source. Canonical match/merge is explicit; name alone is
never sufficient. No provider, scraper, scheduler, or network adapter is yet
approved.

## Evidence

- Schema, Nutrition contracts, and integration tests.

## Decisions

- [Layered Nutrition ADR](../../adr/20260731-use-layered-versioned-nutrition-catalog.md).

## Open questions

- Approved external sources and multi-user catalog write/moderation roles.

## Related material

- [Nutrition API](../api/nutrition-catalog.md)
- [Meal](meal.md)
- [Data ownership](../architecture/data-ownership.md)
