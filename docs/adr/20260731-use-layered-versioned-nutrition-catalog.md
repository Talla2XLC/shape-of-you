---
id: "decisions-20260731-use-layered-versioned-nutrition-catalog"
kind: adr
title: "Use a layered versioned Nutrition catalog and immutable meal snapshots"
status: accepted
date: 2026-07-31
supersedes: []
superseded_by: null
tags:
  - "catalog"
  - "external-sources"
  - "nutrition"
  - "snapshots"
  - "versioning"
---

# Use a layered versioned Nutrition catalog and immutable meal snapshots

## Context

`Foods`, `Ingredients`, `Brands`, and `Food_Ingredients` contain reusable
reference knowledge, while `Meals` contains Person-owned nutrition facts with
captured calories and macros. A fully Person-scoped catalog duplicates common
content and external normalization work. A globally mutable catalog would
rewrite historical meaning and improperly publish personal aliases, portions,
and private recipes.

## Decision

Keep Nutrition inside the single API and use three ownership layers:

1. A shared canonical catalog with stable `Brand`, `Ingredient`, and `Food`
   identities and immutable revisions. `FoodVersion` pins nutrition basis,
   composition, and exact Ingredient revisions.
2. A personal layer containing references and overlays only: saved item,
   alias, favorite/hidden state, and preferred serving. User-created foods and
   recipes have an explicit owner and private visibility.
3. Immutable Person-owned `Meal` facts. Items may reference an accessible exact
   `FoodVersion`, but always store typed snapshots of quantity, unit, calories,
   protein, fat, and carbs. Correction creates a full replacement Meal with
   `supersedes_id`.

Daily nutrition totals are query projections over current Meal snapshots by
Person and `local_date`, not a broad `DayRecord` or authority table.

Use a source-neutral ingestion boundary for external catalogs.
`CatalogSourceRecord` stores provider key, external record ID, retrieval time,
checksum, parser version, provenance, license/terms, and a private raw payload
only when required. `(source, external_record_id)` is unique. A source record
first becomes a staged candidate; canonical link/merge is explicit and
reviewable. Normalized name alone never authorizes merge.

No provider, API, dataset, or scraper is approved by this ADR. Prefer official
APIs and open/licensed datasets. Scraping requires separate terms, rate-limit,
attribution, and quality review. Meal creation never scrapes remotely.

Person-scoped `SourceReference` is not catalog-source identity; fact provenance
and catalog ingestion have different ownership and lifecycle.

## Considered alternatives

- Fully Person-scoped catalog: simple permissions but duplicate content and
  weak external normalization.
- Globally mutable catalog: few copies but rewrites history and mixes private
  and shared definitions.
- Shared immutable catalog without personal overlays: preserves history but
  cannot express aliases, servings, favorites, or private recipes.
- Layered catalog, overlays, and immutable snapshots: separates reusable
  knowledge, preferences, and facts. Selected.

## Consequences

- Shared ingredients, brands, and foods are not duplicated per Person.
- Catalog edits create revisions and do not change old Meals.
- Meal snapshots intentionally duplicate a small nutrient set for historical
  reproducibility.
- Private recipes require authorization regardless of UUID knowledge.
- Cross-source matching is explicit; automatic name dedupe is forbidden.
- Real connectors, schedulers, and network access remain separate work and do
  not require a new deployable service.

## Verification

- Two People reference one shared Ingredient/FoodVersion without copied
  canonical content.
- New FoodVersion does not change an existing Meal snapshot.
- Private items remain inaccessible without a future sharing contract.
- Reimport by external ID is idempotent within the source.
- Similar names from different sources do not merge without explicit match.
- Daily totals use only current Meals for the selected Person/local date.

## Related material

- [Data ownership](../wiki/architecture/data-ownership.md)
- [Source of truth and authority](../wiki/data/source-of-truth-and-authority.md)
- [Domain extraction map](../wiki/domain/domain-extraction-map.md)
- [Independent facts over DayRecord](20260728-prefer-independent-facts-over-broad-day-record.md)
- [Typed provenance and supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [Nutrition plan](../../plans/2026/07/completed/2026-07-31-nutrition-catalog-meals-and-projections.md)
