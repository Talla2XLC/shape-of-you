---
id: "data-google-sheets-inventory"
kind: data
title: "Google Sheets inventory"
status: draft
tags:
  - "data"
  - "dev-027"
  - "google-sheets"
---

# Google Sheets inventory

## Summary

Observed inventory of `Fitness Tracker` for DEV-023. The workbook remains
operational authority until verified dual-run/cutover. This page describes the
source, not a target database schema.

## Content

The 26 observed sheets fall into five evidence groups:

- configuration/projections: Settings, Dashboard, Daily_Log;
- Nutrition catalog/intake: Foods, Ingredients, Brands, Food_Ingredients,
  Meals;
- Training/Physical State: Training, Program, Weight, Personal Records, Body;
- project governance: Changelog, Roadmap, Ideas, Rules, Decisions;
- input/audit/repair/coaching workflows: NL_Engine, AI_Inbox, Self_Healing,
  AI_Timeline, AI_Insights, Load_Risk, Weight_Autopilot, Coach_Planner.

Sheets mix facts, policies, workflow state, and projections. Sheet boundaries
are discovery evidence, not aggregate/table/module/service boundaries.
`Daily_Log` is primarily a legacy projection.

Authoritative workbook pointer:

- title: `Fitness Tracker`;
- spreadsheet ID: `1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik`;
- URL: `https://docs.google.com/spreadsheets/d/1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik/edit`;
- locale: `ru_RU`;
- timezone: `Europe/Moscow`.

Connector reads use exact URL/ID. Failed Drive title search does not prove
missing access. Read metadata before ranges. Workbook is read-only unless the
operator authorizes a specific write.

## Evidence

- Metadata, headers for all 26 sheets, limited range/formula reads, and no
  copied personal values.
- The `Body` sheet has numeric sheet ID `2000000003` and the bounded import
  projection `A:J`: Date, five metric columns, Photo, Notes, Measurement_ID,
  and Source. The accepted TASK-0048 live read observed headers and no data
  rows.
- Nutrition migration uses one bounded snapshot of `Brands`, `Ingredients`,
  `Foods`, `Food_Ingredients`, and `Meals`. Existing populated Meal rows have a
  durable UUIDv4 `Meal_ID`; the active external writer must provide a new
  immutable `Meal_ID` for every future Meal row.
- The bounded `Training!A:K` projection contains 39 rows in nine stable
  `Session_ID` groups and 14 `Exercise_ID` values. Eight groups are valid
  performed sessions; one malformed meal row has no `Exercise_ID`. Two run rows
  carry distance and duration instead of reps.
- Raw Garmin-derived observations are columns in bounded `Daily_Log`, not a
  separate Garmin sheet: sleep duration and stages, HRV, resting/night heart
  rate, average/minimum SpO2, temperature deviation, respiration, and Body
  Battery. Readiness, AI, recovery status, next-workout guidance, and
  `Load_Risk` are derived projections.

## Decisions

- Treat workbook as one operational system with domain modules/adapters, not a
  service or target table per sheet.
- Domain runs capture only required sheets: Body alone for Body; Weight and
  Daily_Log for Weight; and the five linked Nutrition sheets plus the bounded
  Daily_Log closure projection for Nutrition. Training captures only
  `Training`; Recovery captures only the approved raw `Daily_Log` columns.
  Body Notes and Source are private, Measurement_ID is stable identity, and
  Photo remains a blocking unsupported reference. Nutrition uses durable
  catalog IDs/Meal_ID and treats Photo markers and incomplete linked rows as
  blockers.
- Training uses `Session_ID` as group identity and preserves exact row locators,
  checksums, and `Exercise_ID` mappings. Recovery uses local date plus metric
  kind. Known source structure is typed relationally; malformed/narrative rows
  stay invalid and projections are not imported.

## Open questions

- Body and Meal media migration lifecycle; repeated recipe ingredients; Rules
  classification; status vocabularies; historical requiredness.

## Related material

- [Authority](source-of-truth-and-authority.md)
- [Behavior catalog](google-sheets-behavior-catalog.md)
- [Provenance](provenance-and-identifiers.md)
- [Cutover ADR](../../adr/20260728-keep-google-sheets-authoritative-until-verified-cutover.md)
