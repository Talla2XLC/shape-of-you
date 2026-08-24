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

Source identity combines spreadsheet ID, numeric sheet ID, and Person-local
date; row position is locator evidence and content checksum remains separate.
Date-only Weight evidence is stored with explicit `local_date` precision and a
null instant; existing and interactive Weight facts retain `instant` precision.
The importer never synthesizes midnight.

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

Before cutover, Shape of You MCP must provide tested typed write tools for
every fact type used by the ChatGPT project, including Garmin/Recovery
observations. Cutover pauses the Sheets writer, captures a source checkpoint,
runs final import/reconciliation, switches ChatGPT to MCP-only writes, verifies
write/read-back, and transfers authority only through explicit approval.
Rollback also uses one writer at a time; post-checkpoint PostgreSQL facts must
be reconciled and replayed through a controlled one-time procedure before the
Sheets writer can resume.

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
- Operator migration roadmap and source-of-truth rules.

## Decisions

- Pull-based import, typed adapters, exclusive-writer cutover, and rollback are
  accepted in the linked ADR.
- Weight dry-run and controlled apply are implemented; real-data execution,
  recurring reconciliation, and authority transfer remain separately gated.

## Open questions

- Complete verified formula/validation/script/workflow catalog, identifier
  quality, reconciliation tolerances, cutover duration, and rollback window.
- Operational source checkpoint and run cadence for recurring dual-run.
- MCP coverage sequence for remaining fact types, including Recovery/Garmin.

## Related material

- [Data ownership](data-ownership.md)
- [Roadmap](../roadmap/overview.md)
- [Glossary](../domain/glossary.md)
- [Pull-based import and writer cutover ADR](../../adr/20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Operator-workstation import ADR](../../adr/20260823-run-controlled-sheets-imports-from-operator-workstation.md)
