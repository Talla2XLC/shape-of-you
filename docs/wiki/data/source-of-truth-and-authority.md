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

The implemented TASK-0044 Weight dry-run preserves this authority boundary. It
can classify source candidates against PostgreSQL, but has no PostgreSQL or
Sheets writer and persists no import state. A `created` result is only an
intention, not a fact insertion. Existing facts are never overwritten, and
date-only source evidence is not converted to an invented timestamp.

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
- Accepted TASK-0044 Weight dry-run and zero-write integration evidence.

## Decisions

- Authority follows field/record type. The Google Sheets cutover ADR remains
  unchanged.
- TASK-0044 changes neither the active writer nor operational authority.

## Open questions

- Explicit overrides of daily totals, Training execution linkage from accepted
  recommendation, and conflict policy across future independent channels.

## Related material

- [Sheets inventory](google-sheets-inventory.md)
- [Cutover ADR](../../adr/20260728-keep-google-sheets-authoritative-until-verified-cutover.md)
- [Integrity](integrity-and-lifecycle.md)
- [Domain invariants](../domain/invariants.md)
- [Pull-based import and writer cutover ADR](../../adr/20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
