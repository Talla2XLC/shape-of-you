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

Staging PostgreSQL is operational authority after the explicit TASK-0067
transfer. Authority is exercised only through API-owned typed domain contracts
and the single Shape of You Staging MCP writer.

The separate ChatGPT project `Fitness Tracker` now has one active operational
writer: the Shape of You Staging MCP connector. Its project instructions route
typed facts to PostgreSQL through MCP, prohibit Google Sheets writes, and do not
permit fallback. The frozen workbook remains the accepted pre-switch history
checkpoint but is no longer current authority. Post-checkpoint
PostgreSQL facts, including the synthetic cutover note, are authoritative and
form a dynamically growing rollback scope.

- facts retain provenance and domain owner;
- configuration/policy is not historical measurement;
- workflow status describes processing, not fitness truth;
- formulas, dashboards, Daily_Log, records, risk scores, and plans may be
  projections or decisions;
- explicit correction supersedes facts without erasing history.

Authority is assigned per information type, not per whole sheet.

For the completed Weight migration, the Sheets `Weight` tab was the approved
legacy journal and `Daily_Log.Weight` was mirror/reconciliation evidence.
Staging PostgreSQL `WeightMeasurement` is now current authority. Equal legacy
mirror values create no second fact; discrepancy blocks automatic import and
requires investigation.

The unified importer preserves this migration-source boundary for Weight and Body.
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
`invalid`, not deferred manual work. TASK-0065 paused the Sheets writer,
captured and re-verified the switch-time checkpoint without drift, completed
the exclusive MCP-only writer switch, and verified one bounded typed write with
read-back while the workbook remained frozen. Deployed MCP writer-matrix/canary
verification is complete. TASK-0066 accepted a bounded observation as `READY`
for a separate authority-transfer decision: project configuration remained
MCP-only, all 23 tools and the existing note read-back were available, two
exact workbook captures matched, and the last Drive modification preceded the
switch checkpoint. TASK-0067 then completed the separately approved transfer.
At transfer time rollback scope contained exactly one synthetic post-checkpoint
`DailyContextNote`; subsequent operational MCP facts extend that scope.

For the completed Body migration, the empty `Body` sheet was the approved
legacy source. Stable source identity is the exact workbook, numeric sheet ID,
and `Measurement_ID`. Staging PostgreSQL `BodyMeasurementSession` is current
authority. The importer reads only Body for this legacy domain. Notes and source
labels remain private evidence; a Photo reference blocks automatic import until
media handling is designed.

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

After authority transfer, Brand/Ingredient/FoodVersion are shared definitions;
personal catalog stores overlays/private items. Sheets retains only the frozen
legacy catalog/Meals checkpoint and is not current authority. Meal snapshots never
recalculate from later catalog versions; daily totals remain derived.

Writer authority changes as one exclusive switch, not a dual-write period.
Before that switch, deployed MCP must cover every fact type used by the ChatGPT
writer. The verified writer operations are Weight, Meal, Workout result, raw
Garmin/Recovery observations, standalone daily context note, and explicit day
closure; Body remains supported even though the current source is empty.
TASK-0057 implements the complete repository-side MCP target: typed
append-only corrections, lifecycle tools, active Training reference lookup,
and a narrow relational `DailyContextNote`. The complete 23-tool surface is
deployed through the single staging connector, and all 14 required synthetic
writer/lifecycle canaries have passed with read-back. TASK-0065 completed the
exclusive switch: MCP is now the only active writer, Google Sheets writes are
prohibited. TASK-0067 made staging PostgreSQL operational authority and demoted
Google Sheets to a non-authoritative frozen legacy reference.

The Sheets writer was paused before a local executable preflight recorded and
re-verified the final source checkpoint. ChatGPT was then switched to MCP-only
writes and its complete tool/scope/canary matrix was verified. PostgreSQL
authority was approved and transferred in TASK-0067. A rollback pauses MCP
first and produces a
typed plan for post-checkpoint PostgreSQL facts before Sheets writing can
resume. The initial rollback scope contains one synthetic `DailyContextNote`
and expands with post-checkpoint operational facts; any replay, exception, or
other Sheets write requires separate operator approval. No
automatic reverse sync exists.

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
- TASK-0065 switch evidence: final reconciliation returned `created=0`,
  `unchanged=434`, `conflict=0`, `invalid=48`, and `failures=0`; independent
  recaptures proved the workbook frozen before and after the MCP canary. The
  only post-checkpoint fact is one synthetic `DailyContextNote`.
- TASK-0066 bounded observation: MCP-only configuration, the 23-tool surface,
  and the existing synthetic read-back remained stable; two exact nine-range
  captures matched, and Drive modification metadata predates the checkpoint.
  `READY` means evidence is sufficient for a separate operator decision, not
  that authority has transferred.
- TASK-0067 authority-transfer evidence: the immediate READY pin passed, the
  same project's PostgreSQL-authority contract persisted through reload, and
  the post-transfer MCP/read-back and Drive pins remained stable. No new fact,
  Sheets mutation, permission change, or production action occurred.

## Decisions

- Authority follows field/record type. The Google Sheets cutover ADR remains
  unchanged.
- Weight, Body, Nutrition, Training, and Recovery importer work did not change
  authority. TASK-0065 changed only the active writer; authority transfer is a
  separate decision.
- TASK-0066 completed the bounded observation. Readiness must be revalidated if
  Sheets drifts, MCP access changes, or an unclassified post-checkpoint fact
  appears before authority approval.
- TASK-0067 completed that separate decision. Staging PostgreSQL is now
  operational authority; Google Sheets is non-authoritative legacy evidence.
  Rollback and workbook disposition remain separately gated.

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
