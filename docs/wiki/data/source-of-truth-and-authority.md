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

After cutover, Brand/Ingredient/FoodVersion are shared definitions; personal
catalog stores overlays/private items. Until then, Sheets remains authority for
current catalog/Meals. Meal snapshots never recalculate from later catalog
versions; daily totals remain derived.

## Evidence

- Weight mirror, Meal aggregation, Training-derived records/program fields,
  NL_Engine/Inbox lifecycle, and Self_Healing read-back.

## Decisions

- Authority follows field/record type. The Google Sheets cutover ADR remains
  unchanged.

## Open questions

- Explicit overrides of daily totals, Training execution linkage from accepted
  recommendation, and conflict policy across future independent channels.

## Related material

- [Sheets inventory](google-sheets-inventory.md)
- [Cutover ADR](../../adr/20260728-keep-google-sheets-authoritative-until-verified-cutover.md)
- [Integrity](integrity-and-lifecycle.md)
- [Domain invariants](../domain/invariants.md)
