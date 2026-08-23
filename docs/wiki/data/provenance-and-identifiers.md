---
id: "data-provenance-and-identifiers"
kind: data
title: "Provenance and identifiers"
status: draft
tags:
  - "data"
  - "identifiers"
  - "provenance"
---

# Provenance and identifiers

## Summary

Reference/workflow sheets contain stable IDs, while fact journals still partly
depend on dates, text, session IDs, rows, and cell coordinates.

## Content

Migration assigns durable domain IDs and preserves immutable legacy references
to workbook/sheet/row/cell when needed, source channel/timestamps, ingestion
time, and correction history. Row number is never domain identity.

Fitness facts are Person-scoped. Typed provenance fields remain indexed
columns. Private raw JSONB snapshot is allowed only for import,
reconciliation, or reproducibility and is excluded from public contracts.

Fitness Tracker import identity uses exact spreadsheet ID, numeric sheet ID,
and a domain-owned source key. Row position is locator evidence only, and
content checksum is separate from identity and dedupe. Controlled apply links
created SourceReferences to a Person-owned relational `import_batches` row;
typed Weight findings live in `weight_import_records`. Known import structure
is not stored as a generic JSON payload.

Correction creates a new immutable typed fact with UUID/`supersedes_id`; it
cannot cross Person or fact type. Current queries omit superseded facts.
Idempotency includes at least Person and source channel.

Shared catalog definitions use separate external-source identity: provider,
external record, retrieval time, checksum, parser version, and review state.
Similar names do not authorize merge. Person fact SourceReference is not
catalog-source identity.

Durable identities include Meal, WeightMeasurement, Exercise/Version,
TrainingProgramVersion, WorkoutSession, PerformedSet, provider/device version,
connection, consent, RecoveryObservation, policy version, and assessment.

## Evidence

- Observed sheet headers and implemented typed schemas.

## Decisions

- No row-number IDs, universal facts table, polymorphic revision store, or
  reuse of Person SourceReference for shared catalog identity.

## Open questions

- External Exercise_ID ownership, cross-date Session_ID, Food/Ingredient ID
  scope, raw-snapshot retention, and authenticated erasure dependencies.

## Related material

- [Sheets inventory](google-sheets-inventory.md)
- [Integrity](integrity-and-lifecycle.md)
- [Identity ADR](../../adr/20260730-separate-user-access-from-person-data-ownership.md)
- [Provenance ADR](../../adr/20260730-use-typed-provenance-and-append-only-supersession.md)
- [Importer ADR](../../adr/20260821-use-relational-import-batches-and-explicit-weight-temporal-precision.md)
