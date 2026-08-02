---
id: "decisions-20260728-keep-google-sheets-authoritative-until-verified-cutover"
kind: adr
title: "Keep Google Sheets authoritative until verified cutover"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "data-authority"
  - "migration"
---

# Keep Google Sheets authoritative until verified cutover

## Context

Google Sheets already contains operational data, rules, analytics, and
workflows. Declaring a new backend authoritative before a verified migration
could lose history, provenance, or existing behavior.

## Decision

Google Sheets remains the only authoritative source for operational fitness
data until inventory, mapping, backfill, reconciliation, controlled dual-run,
integrity reporting, cutover criteria, approval, and rollback preparation are
complete.

## Considered alternatives

- Immediate cutover: faster but creates unacceptable integrity and continuity
  risk.
- Keep authority permanently in Google Sheets: removes migration risk but
  blocks the target platform architecture and controlled application data
  ownership.

## Consequences

PostgreSQL and backend representations are provisional during migration.
Differences are resolved through explicit reconciliation; missing data is not
invented. Authority changes only through an approved evidence-backed migration
plan.

The complete inventory, reconciliation thresholds, cutover duration, rollback
window, and discrepancy owner remain open.

## Verification

- The operator explicitly set source-of-truth and migration rules on
  2026-07-28.

## Related material

- `../wiki/architecture/data-ownership.md`
- `../wiki/architecture/migration-strategy.md`
- `../wiki/roadmap/overview.md`
