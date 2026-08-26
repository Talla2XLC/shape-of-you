---
id: "architecture-migration-strategy"
kind: architecture
title: "Migration strategy"
status: draft
tags:
  - "architecture"
  - "migration"
---

# Migration strategy

## Summary

Google Sheets to PostgreSQL migration is controlled, evidence-based,
reversible, and transfers no authority before reconciliation and cutover.

## Content

DEV-023 extracts backend contracts and domain logic. DEV-024 performs migration
and dual-run. Web/mobile work cannot bypass the stable-backend gate.

The active legacy writer is the separate ChatGPT project `Fitness Tracker`.
It continues writing operational facts, including Garmin/Recovery evidence,
only to Google Sheets until cutover. Direct ChatGPT dual-write to Sheets and
PostgreSQL is forbidden. The backend migration path is pull-based: it reads
bounded Sheets snapshots, imports through typed domain adapters, and compares
PostgreSQL while Sheets remains authoritative.

Required stages:

1. Inventory sheets, columns, formulas, scripts, rules, identifiers, and
   operational workflows.
2. Map each source element to domain terminology and ownership.
3. Preserve provenance and raw source identity.
4. Design and test backfill.
5. Compare old/new representations through integrity reports.
6. Run pull-based import and reconciliation without a second user-facing
   writer.
7. Define measurable cutover criteria and obtain approval.
8. Transfer authority only after criteria pass.
9. Preserve rollback and discrepancy-recovery procedures.

TASK-0044 and TASK-0045 implement the first DEV-024 vertical: one shared typed
importer with `dry-run` and `apply` modes and a Weight adapter inside the
existing API. The one-shot command reads the
exact workbook through bounded `Weight` and `Daily_Log` ranges, derives numeric
sheet IDs from metadata, reconciles `Weight` authority with the legacy mirror,
and reports `created`, `unchanged`, `conflict`, and `invalid`. Dry-run constructs
no writer and persists nothing.

Apply uses the same classifier through a reusable PostgreSQL lifecycle. It
takes a Person/domain advisory transaction lock, re-reads target state, and
persists a relational `import_batches` audit plus typed
`weight_import_records`. Any conflict or invalid row blocks every fact write in
that batch. A clean batch creates only missing immutable facts and provenance;
unchanged facts are never rewritten. Batch, audit, provenance, and facts commit
or roll back together. Future domains add typed adapters and audit tables to
this lifecycle rather than separate migration programs or generic JSON facts.

TASK-0048 adds Body as the second adapter to that same command and lifecycle:
`fitness-tracker:import --domain body --mode dry-run|apply`. A Body run reads
only the bounded `Body` range; a Weight run reads only `Weight` and
`Daily_Log`. Private snapshot schema v3 accepts exactly one typed domain subset
while schema v1 Weight snapshots remain readable. This prevents each new
adapter from expanding into an all-workbook capture.

TASK-0049 introduced Nutrition as one linked adapter, not five sheet-specific
migrators. `fitness-tracker:import --domain nutrition --mode dry-run|apply`
captures `Brands`, `Ingredients`, `Foods`, `Food_Ingredients`, `Meals`, and the
bounded `Daily_Log` closure projection, then reconciles them in one transaction.
Durable catalog IDs and `Meal_ID` remain separate from row locators and content
checksums. Catalog facts stay Person-private and known import evidence is stored
in typed relational audit tables.

TASK-0050 makes Nutrition reconciliation identity-scoped. An incomplete catalog
record blocks only dependent catalog promotion; it does not suppress unrelated
Meals or closed-day decisions. Historical Meals may preserve unknown nutrient
components as `null` with explicit `complete|partial` read state. Interactive
HTTP/MCP writes still require complete nutrients. Legacy kind labels map
deterministically to `other`, while raw kind, Photo marker, and unresolved
source `Food_ID` remain relational provenance instead of blockers. Progress
series omit incomplete daily nutrient points rather than reporting partial sums
as exact totals.

TASK-0052 extends the same command and lifecycle with `training` and `recovery`
adapters. Training groups performed facts by the stable source `Session_ID`,
maps `Exercise_ID` through typed relational records, and represents strength,
timed holds, and runs with explicit reps, duration, and distance fields.
An `Exercise_ID` remains the external identity when its source label changes:
each observed label resolves to a typed version of the same private exercise,
while the performed row retains its historical label.
Recovery imports only known raw `Daily_Log` observations: sleep and stages,
HRV, resting/night heart rate, average/minimum SpO2, temperature deviation,
respiration, and Body Battery. Readiness, AI, recovery-status, planning, and
`Load_Risk` projections are excluded. Malformed or narrative source evidence
remains a local `invalid`; it does not block independent valid facts.

TASK-0055 adds one operator-facing `--domain all` invocation over the same five
typed adapters. It requires a separate versioned private snapshot path for
each domain, runs them in fixed Weight, Body, Nutrition, Training, Recovery
order, preserves each domain transaction, and emits per-domain plus aggregate
safe counts. A failed domain is reported without suppressing the remaining
comparisons; this orchestration is not a second migrator and does not weaken
the existing one-domain commands.

Nutrition target reads compare exact relational projections for imported
Brands, Meals, and accepted Sheets day closures when legacy capture rendering
changed a row checksum without changing the stored fact. This compatibility
does not apply to unsupported entity kinds or day closures without accepted
Sheets provenance. Numeric-sheet provenance drift is detected by stable source
ID across workbook-scoped catalog sources; the importer neither creates a
duplicate nor repairs provenance automatically. TASK-0056 corrected the three
known Brand records through an exact idempotent data migration, repointed their
versions to the Brands numeric sheet ID, and retained the previous source
records as audit evidence. This is a bounded historical correction, not a
generic self-healing mechanism.

Complete Food rows treat any non-empty source `Default_portion` as one
source-defined `serving`. The original text remains in typed relational audit;
the importer does not parse or assert an unknown physical portion size. A
catalog dependency that is present but structurally invalid in the same
snapshot is terminal `invalid`. An absent or ambiguous dependency remains a
`conflict`. Missing Ingredient nutrients and composition quantities are never
synthesized or deferred for manual backfill.

Source identity combines spreadsheet ID, numeric sheet ID, and Person-local
date; row position is locator evidence and content checksum remains separate.
Date-only Weight evidence is stored with explicit `local_date` precision and a
null instant; existing and interactive Weight facts retain `instant` precision.
The importer never synthesizes midnight.

Body source identity combines spreadsheet ID, numeric sheet ID, and required
`Measurement_ID`; row position remains locator evidence only. Imported Body
rows also preserve `local_date` precision with a null instant. Notes and source
labels remain private relational audit evidence. A non-empty Photo reference
blocks the row until a media migration capability exists.

Nutrition Meals preserve source date-only semantics with `local_date`, a null
`occurredAt`, and one immutable `serving` snapshot item containing the row's
known source nutrient values. Existing and interactive Meals remain `instant`.
Neither catalog gaps nor Meal time/media are inferred. `Daily_Log.DayStatus =
Closed` is imported after same-run Meals as an idempotent `google_sheets`
`DayClosure`. Its snapshot records Nutrition completeness. Training is optional:
absence of a Workout never blocks closure.

Controlled one-time runs execute from the operator workstation. Codex reads
only approved bounded ranges, capped by current sheet grid metadata, from the
exact workbook through the connected
Google account, then passes a versioned private snapshot to the same importer.
The snapshot is an ephemeral transport envelope, not a domain model: it has a
canonical checksum, mode `0600`, strict bounds and source metadata, and is
deleted after the run. The connector token is neither extracted nor delivered
to the API. Staging deployment has no importer profile, trigger, Google
credential, or dedicated runtime environment.

The existing service-identity reader remains available for a future approved
unattended cadence, but provisioning and scheduling it are deferred until such
automation is needed. The apply capability is implemented, but real-data
execution, recurring dual-run, live service-identity use, and cutover remain
separately approved operations.

The verified live writer contract has six active operations: Weight, Meal,
Workout result, raw Garmin/Recovery observations, standalone daily context
note, and explicit day closure. Body is currently unused but remains a
supported writer capability. Repository MCP already has list/record tools for
the five existing fact modules, including Recovery, but complete cutover parity
also requires append-only corrections, day projection/close/reopen/history,
active Training reference lookup, and a typed `DailyContextNote` fact.

TASK-0057 keeps separate typed domain tools and does not expand the Weight-only
Intake parser into a generic event queue or persist a `CutoverSession`. The API
now exposes the complete 23-tool writer/reference/lifecycle surface, including
append-only corrections, `DailyContextNote`, active Training lookup, and day
projection/close/reopen/history. A local phased preflight command produces an
immutable private manifest for checkpoint checksums and final reconciliation,
verifies deployed tool/scope and canary evidence, and rehearses a typed,
Person-isolated rollback plan without writing Sheets. Deployment, connector
consent, canary execution, and cutover remain separately gated.

Cutover pauses the Sheets writer, captures and re-verifies the source
checkpoint, runs final import/reconciliation, switches ChatGPT to MCP-only
writes, verifies typed write/read-back, and transfers authority only through
explicit approval. Rollback also uses one writer at a time; post-checkpoint
PostgreSQL facts must be reconciled and replayed through a controlled one-time
procedure before the Sheets writer can resume. Any Sheets write requires a
separate explicit approval.

Never invent missing data. Ambiguous mapping remains an open question.
Self-healing begins in dry-run, records before/after, uses an allowlist,
verifies read-back/integrity, rolls back unverified results, and never
automatically changes closed days or ambiguous facts.

## Evidence

- TASK-0044 accepted Quality and Architecture Review evidence.
- Synthetic Google Sheets adapter, outcome, reconciliation, safety, and
  PostgreSQL zero-write tests.
- The first bounded live Sheets-to-staging PostgreSQL dry-run completed through
  the official read-only target reader: `created=20`, `unchanged=0`,
  `conflict=0`, `invalid=0`. The private snapshot was removed and the SSH
  tunnel closed immediately after execution.
- The accepted Weight manifest was then applied once through the transactional
  lifecycle: 20 missing facts plus relational provenance/audit were created.
  A same-manifest read-only verification returned `unchanged=20` with every
  other outcome zero. Sheets remains authoritative; this was not cutover.
- The first exact-workbook Body read contained headers and no data rows. A
  Body-only private snapshot was compared with staging PostgreSQL read-only and
  returned `created=0`, `unchanged=0`, `conflict=0`, `invalid=0`; the snapshot
  and tunnel were removed afterwards.
- The first exact-workbook Nutrition read captured the five approved sheets and
  compared them with staging PostgreSQL read-only. It returned `created=38`,
  `unchanged=0`, `conflict=81`, and `invalid=40`. These blockers reflect source
  gaps and unsupported evidence; no apply occurred. The private snapshot and
  SSH tunnel were removed after the run.
- TASK-0052 Quality accepted the Training and raw Recovery implementation after
  92 API unit tests, 39 Identity unit tests, focused importer/migration
  integration tests, build, lint, documentation validation, and source-boundary
  review. Bounded live source inspection found eight valid Training sessions,
  one malformed meal row, and typed raw Recovery candidates.
- TASK-0053 deployed the historical `Exercise_ID` label-version correction,
  then completed a same-snapshot staging apply. Training created eight sessions
  and retained one local invalid row; its repeated dry-run returned
  `created=0`, `unchanged=8`, and `conflict=0`. Recovery created 240 typed
  observations and retained two local invalid sleep values; its repeated
  dry-run returned `created=0`, `unchanged=240`, and `conflict=0`.
  Google Sheets was read-only throughout, private snapshots were removed, and
  no cutover occurred.
- TASK-0055 completed a single bounded all-domain connector capture and staging
  run. The approved apply created two independent facts that were absent at
  capture time. The final read-only reconciliation returned `created=0`,
  `unchanged=418`, `conflict=15`, and `invalid=41`, with no domain execution
  failure. The conflicts are twelve unresolved Food references in composition
  rows and three Brand records whose historical catalog provenance carries the
  Foods numeric sheet ID instead of the Brands numeric sheet ID. The importer
  detected those identities and created no duplicate. Google Sheets remained
  read-only, temporary snapshots were removed, and no cutover occurred.
- TASK-0056 applied the exact Brand provenance migration and imported seven
  complete Foods as source-defined servings. The post-migration pre-apply
  comparison returned `created=7`, `unchanged=421`, `conflict=0`, and
  `invalid=46`. The repeated post-apply comparison returned `created=0`,
  `unchanged=428`, `conflict=0`, and `invalid=46`, with no failures. Aggregate
  verification found three corrected Brand versions and three preserved prior
  source records. The invalid findings are terminal typed evidence for
  incomplete historical source rows, not deferred manual work. Sheets remained
  read-only, temporary snapshots and the SSH tunnel were removed, and no
  cutover occurred.
- Operator migration roadmap and source-of-truth rules.

## Decisions

- Pull-based import, typed adapters, exclusive-writer cutover, and rollback are
  accepted in the linked ADR.
- Typed MCP writer parity, narrow append-only `DailyContextNote`, and the
  executable local cutover preflight are implemented and Quality-accepted in
  the repository. They are not deployed runtime behavior until a separately
  approved release and connector consent update.
- Weight, Body, Nutrition, Training, and Recovery dry-run/apply adapters are
  implemented through one command and lifecycle, with one all-domain operator
  orchestration over separate typed snapshots. Body apply has not been needed
  because its authoritative source is empty. Weight, Nutrition, Training, and
  Recovery have completed controlled real-data staging apply. The latest
  all-domain verification is duplicate-safe and conflict-free; terminal
  historical invalid evidence does not require manual completion. Recurring
  reconciliation, the final writer checkpoint, deployed MCP writer-matrix
  verification, and authority transfer remain separately gated.

## Open questions

- Complete verified formula/validation/script/workflow catalog, identifier
  quality, reconciliation tolerances, cutover duration, and rollback window.
- Operational rollback window and whether recurring dual-run is still needed
  before the bounded final checkpoint.
- Deployment, connector consent, and end-to-end smoke for the complete
  TASK-0057 writer matrix.

## Related material

- [Data ownership](data-ownership.md)
- [Roadmap](../roadmap/overview.md)
- [Glossary](../domain/glossary.md)
- [Pull-based import and writer cutover ADR](../../adr/20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Operator-workstation import ADR](../../adr/20260823-run-controlled-sheets-imports-from-operator-workstation.md)
- [Body import precision and audit ADR](../../adr/20260824-use-explicit-body-temporal-precision-and-typed-import-records.md)
- [Partial Nutrition and source closures ADR](../../adr/20260825-import-partial-nutrition-and-source-day-closures.md)
- [Training and raw Recovery import ADR](../../adr/20260825-import-training-and-raw-recovery-observations.md)
- [Nutrition provenance remediation ADR](../../adr/20260826-remediate-nutrition-provenance-and-terminal-catalog-evidence.md)
