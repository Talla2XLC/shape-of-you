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

The operator can run all five domains through one deterministic orchestration,
but each domain still receives its own bounded typed snapshot and transaction.
The aggregate report does not transfer authority. The latest staging
reconciliation has no missing facts eligible for automatic creation and no
conflicts. Historical incomplete Nutrition evidence remains terminal
`invalid`, not deferred manual work. The bounded source checkpoint has been
captured and re-verified without drift. The cutover gate remains closed for
deployed MCP writer-matrix/canary verification, explicit switch approval,
rollback readiness, and authority transfer.

For Body, the `Body` sheet is migration authority. Stable source identity is
the exact workbook, numeric sheet ID, and `Measurement_ID`. The importer reads
only Body for this domain. Notes and source labels remain private evidence; a
Photo reference blocks automatic import until media handling is designed.

For Nutrition, `Brands`, `Ingredients`, `Foods`, `Food_Ingredients`, and
`Meals` form one linked migration boundary. Stable identity uses the exact
workbook, numeric sheet ID, and the sheet's durable ID (`Brand_ID`,
`Ingredient_ID`, `Food_ID`, the Food/Ingredient pair, or `Meal_ID`). Imported
catalog definitions remain Person-private and are never promoted to shared
automatically. Complete Food rows with a non-empty textual `Default_portion`
are recorded as one source-defined `serving`, with the exact source text kept
in typed relational audit and no inferred physical size. Missing Ingredient
nutrients or composition quantities remain terminal `invalid`; a dependency
that is present but structurally invalid in the same snapshot is also terminal
`invalid`. Absent or ambiguous catalog references remain `conflict`. Raw Meal
kind, Photo markers, and unresolved source identifiers remain typed evidence
where the accepted importer contract permits them; none is silently discarded
or invented.

For Training, only the `Training` sheet supplies performed WorkoutSession
facts. `Program`, Personal Records, and planning fields remain projections.
Stable identity uses the exact workbook, numeric sheet ID, and `Session_ID`;
`Exercise_ID` maps through typed relational records rather than a guessed name.
Historical labels for one stable `Exercise_ID` resolve to versions of the same
private exercise, and each performed row retains the label actually supplied by
the workbook.
Strength, timed, and distance evidence remains explicit, while the malformed
meal row is local `invalid` and creates no workout.

For Recovery, only the known raw `Daily_Log` columns supply observations.
Readiness, AI, recovery-status, next-workout, progression, and `Load_Risk`
values are not migrated as raw facts. Provenance states the actual path as
`google_sheets` and `garmin-via-fitness-tracker`; it does not invent a direct
device connection or consent record.

After cutover, Brand/Ingredient/FoodVersion are shared definitions; personal
catalog stores overlays/private items. Until then, Sheets remains authority for
current catalog/Meals. Meal snapshots never recalculate from later catalog
versions; daily totals remain derived.

Writer authority changes as one exclusive switch, not a dual-write period.
Before that switch, deployed MCP must cover every fact type used by the ChatGPT
writer. The verified writer operations are Weight, Meal, Workout result, raw
Garmin/Recovery observations, standalone daily context note, and explicit day
closure; Body remains supported even though the current source is empty.
TASK-0057 implements the complete repository-side MCP target: typed
append-only corrections, lifecycle tools, active Training reference lookup,
and a narrow relational `DailyContextNote`. The implementation is
Quality-accepted but is not deployed behavior until a separately approved
release, connector consent update, and canary verification.

The Sheets writer is paused before a local executable preflight records and
re-verifies the final source checkpoint. ChatGPT is then switched to MCP-only
writes and its complete tool/scope/canary matrix is verified before PostgreSQL
authority is approved. A rollback pauses MCP first and produces a typed plan
for post-checkpoint PostgreSQL facts before Sheets writing can resume. Any
rollback write to Sheets requires separate operator approval; no automatic
reverse sync exists.

## Evidence

- Weight mirror, Meal aggregation, Training-derived records/program fields,
  NL_Engine/Inbox lifecycle, and Self_Healing read-back.
- Accepted Weight dry-run/apply evidence, TASK-0048 Body evidence, and
  TASK-0049/0050 Nutrition-and-closure dry-run, identity-scoped apply, privacy, and typed
  relational audit evidence.
- TASK-0055 all-domain staging evidence: zero remaining `created`, no execution
  failures, twelve unresolved composition references, and three detected Brand
  numeric-sheet provenance mismatches. No duplicate or corrective mutation was
  performed.
- TASK-0056 imported seven complete Foods as source-defined servings and
  preserved terminal historical evidence, but inverted the Brands/Foods
  numeric sheet mapping. TASK-0062 corrected current provenance forward-only:
  Brands use `2000000008`, Foods use `2000000006`, and all prior records remain.
  One new Weight fact and five new Recovery observations were then imported.
  The repeated all-domain dry-run returned `created=0`, `unchanged=434`,
  `conflict=0`, and `invalid=48` with no failures. A private checkpoint and
  fresh exact recapture passed `verify-frozen`. Sheets was not modified and no
  cutover occurred.
- TASK-0057 repository evidence: the 23-tool MCP writer/reference/lifecycle
  matrix, granular OAuth policy, relational `DailyContextNote`, and phased
  cutover preflight passed unit, PostgreSQL integration, migration-prefix,
  typecheck, build, lint, and documentation gates. No deployment, connector
  switch, Sheets write, or authority transfer occurred.

## Decisions

- Authority follows field/record type. The Google Sheets cutover ADR remains
  unchanged.
- Weight, Body, Nutrition, Training, and Recovery importer work changes neither
  the active writer nor operational authority.

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
- [Training and raw Recovery import ADR](../../adr/20260825-import-training-and-raw-recovery-observations.md)
- [Nutrition provenance remediation ADR](../../adr/20260826-remediate-nutrition-provenance-and-terminal-catalog-evidence.md)
- [Corrected Brands/Foods identities ADR](../../adr/20260827-correct-inverted-fitness-tracker-catalog-sheet-identities.md)
- [Typed MCP writer and cutover preflight ADR](../../adr/20260826-complete-typed-mcp-writer-parity-and-use-executable-cutover-preflight.md)
