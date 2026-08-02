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

Required stages:

1. Inventory sheets, columns, formulas, scripts, rules, identifiers, and
   operational workflows.
2. Map each source element to domain terminology and ownership.
3. Preserve provenance and raw source identity.
4. Design and test backfill.
5. Compare old/new representations through integrity reports.
6. Run controlled dual-write or another explicitly designed dual-run.
7. Define measurable cutover criteria and obtain approval.
8. Transfer authority only after criteria pass.
9. Preserve rollback and discrepancy-recovery procedures.

Never invent missing data. Ambiguous mapping remains an open question.
Self-healing begins in dry-run, records before/after, uses an allowlist,
verifies read-back/integrity, rolls back unverified results, and never
automatically changes closed days or ambiguous facts.

## Evidence

- Operator migration roadmap and source-of-truth rules.

## Decisions

- Baseline strategy is accepted; concrete mechanisms require plans and ADRs.

## Open questions

- Complete verified formula/validation/script/workflow catalog, identifier
  quality, dual-run mechanism, reconciliation tolerances, cutover duration, and
  rollback window.

## Related material

- [Data ownership](data-ownership.md)
- [Roadmap](../roadmap/overview.md)
- [Glossary](../domain/glossary.md)
