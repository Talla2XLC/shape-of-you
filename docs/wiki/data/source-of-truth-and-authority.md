---
id: "data-source-of-truth-and-authority"
kind: data
title: "Source of truth and authority"
status: draft
tags:
  - "authority"
  - "data"
  - "migration"
---

# Source of truth and authority

## Summary

Authority map for `Fitness Tracker`, separating facts, configuration,
projections, workflow state, and governance so migration does not turn every
sheet into an authoritative table.

## Content

Google Sheets remains operational authority until accepted dual-run,
reconciliation, and cutover.

The separate ChatGPT project `Fitness Tracker` is currently the active
operational writer. It writes facts, including Garmin/Recovery observations,
to Google Sheets only. PostgreSQL does not receive a direct copy from ChatGPT;
the backend may only pull, import, and reconcile Sheets data through the
controlled migration path.

- facts retain provenance and domain owner;
- configuration/policy is not historical measurement;
- workflow status describes processing, not fitness truth;
- formulas, dashboards, Daily_Log, records, risk scores, and plans may be
  projections or decisions;
- explicit correction supersedes facts without erasing history.

Authority is assigned per information type, not per whole sheet.

For Weight, `Weight` is migration authority and `Daily_Log.Weight` is legacy
mirror/reconciliation evidence. Equal mirror values create no second fact;
discrepancy blocks automatic import and requires investigation.

The unified importer preserves this authority boundary for Weight and Body.
Dry-run classifies source candidates against PostgreSQL and persists nothing.
Apply is a separately invoked transactional mode that creates only missing
facts plus provenance and typed audit; it never writes Sheets or overwrites an
existing fact. Date-only source evidence is not converted to an invented
timestamp.

For Body, the `Body` sheet is migration authority. Stable source identity is
the exact workbook, numeric sheet ID, and `Measurement_ID`. The importer reads
only Body for this domain. Notes and source labels remain private evidence; a
Photo reference blocks automatic import until media handling is designed.

For Nutrition, `Brands`, `Ingredients`, `Foods`, `Food_Ingredients`, and
`Meals` form one linked migration boundary. Stable identity uses the exact
workbook, numeric sheet ID, and the sheet's durable ID (`Brand_ID`,
`Ingredient_ID`, `Food_ID`, the Food/Ingredient pair, or `Meal_ID`). Imported
catalog definitions remain Person-private and are never promoted to shared
automatically. Missing nutrients or quantities, broken links, unsupported Meal
kinds, and Photo markers remain explicit blockers rather than discarded or
invented data.

After cutover, Brand/Ingredient/FoodVersion are shared definitions; personal
catalog stores overlays/private items. Until then, Sheets remains authority for
current catalog/Meals. Meal snapshots never recalculate from later catalog
versions; daily totals remain derived.

Writer authority changes as one exclusive switch, not a dual-write period.
Before that switch, MCP must cover every fact type used by the ChatGPT writer,
including Recovery/Garmin. The Sheets writer is paused before the final source
checkpoint; ChatGPT is then switched to MCP-only writes and verified before
PostgreSQL authority is approved. A rollback pauses MCP first and reconciles
post-checkpoint PostgreSQL facts before Sheets writing can resume. Any rollback
write to Sheets requires separate operator approval.

## Evidence

- Weight mirror, Meal aggregation, Training-derived records/program fields,
  NL_Engine/Inbox lifecycle, and Self_Healing read-back.
- Accepted Weight dry-run/apply evidence, TASK-0048 Body evidence, and
  TASK-0049 Nutrition five-sheet dry-run, atomic apply, privacy, and typed
  relational audit evidence.

## Decisions

- Authority follows field/record type. The Google Sheets cutover ADR remains
  unchanged.
- Weight, Body, and Nutrition importer work changes neither the active writer
  nor operational authority.

## Open questions

- Explicit overrides of daily totals, Training execution linkage from accepted
  recommendation, and conflict policy across future independent channels.

## Related material

- [Sheets inventory](google-sheets-inventory.md)
- [Cutover ADR](../../adr/20260728-keep-google-sheets-authoritative-until-verified-cutover.md)
- [Integrity](integrity-and-lifecycle.md)
- [Domain invariants](../domain/invariants.md)
- [Pull-based import and writer cutover ADR](../../adr/20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Nutrition import ADR](../../adr/20260824-import-nutrition-as-one-typed-fitness-tracker-domain.md)
