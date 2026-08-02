---
id: "decisions-20260730-use-typed-provenance-and-append-only-supersession"
kind: adr
title: "Use typed provenance and append-only fact supersession"
status: accepted
date: 2026-07-30
supersedes: []
superseded_by: null
tags:
  - "corrections"
  - "data-integrity"
  - "provenance"
  - "supersession"
---

# Use typed provenance and append-only fact supersession

## Context

The first `WeightMeasurement` used `source`, `source_record_id`, `dedupe_key`,
and public arbitrary JSONB `provenance`. That was sufficient for a synthetic
slice but not a consistent verifiable contract for Google Sheets import,
natural-language Intake, wearable observations, and manual corrections.

Operational data needs idempotency, source references, append-only chronology,
and explicit corrections. Hidden overwrite loses history, while one universal
`facts` table weakens domain typing and ownership.

## Decision

Every domain fact remains an immutable typed record in its owning module and
contains `person_id`.

Split provenance into:

- typed indexed fact fields: source channel/reference, source timestamp,
  ingestion timestamp, confidence, and dedupe identity;
- an optional `SourceReference` link with external system, external identifier,
  import batch, and checksum;
- a private raw JSONB source snapshot only when import, reconciliation, or
  reproducibility requires it.

Raw snapshots are not in ordinary public API contracts. Constraint, join,
authorization, and frequent-filter fields never hide in JSONB.

Direct creation idempotency includes at least `person_id`, source channel, and
`dedupe_key`; globally unique dedupe keys are forbidden. Complex multi-event
Intake may define a more specific owner without changing Person scope.

A correction creates a new immutable fact with a new UUID, `supersedes_id`, a
reason, and its own provenance. The original remains. Supersession stays within
one fact type and Person, and one fact cannot have two accepted replacements.
Current queries exclude superseded facts; history returns the full chain.

This is not event sourcing. Domain facts remain authority after cutover;
timeline and history are audit/read models.

## Considered alternatives

- Mutable overwrite with `updated_at`: simple but destroys prior value and
  provenance.
- Trigger plus common history table: hides domain semantics and complicates
  typed recovery.
- Stable fact ID plus universal revision table: preserves identity but creates
  polymorphic persistence and weak foreign keys.
- Universal JSONB `facts`: extensible but copies spreadsheet coupling and
  weakens constraints.
- New typed fact with `supersedes_id`: explicit, historical, and module-owned.
  Selected.

## Consequences

- Existing Weight contracts and indexes need compatible migration before real
  data.
- Corrections are explicit commands/endpoints, not hidden `PATCH` overwrite.
- Current and history query semantics are documented separately.
- Raw snapshots need source-specific retention and redaction.
- Multi-fact evidence uses references rather than copied payloads.
- Google Sheets remains authoritative until dual-run and cutover.

## Verification

- Concurrent retry creates one fact within Person/source dedupe scope.
- Correction preserves the original and creates a verifiable chain.
- Database rejects cross-Person and cross-type supersession.
- Default lists omit superseded facts; history has stable order.
- Public responses never expose private raw snapshots.
- Synthetic parity covers manual, Sheets, import, and correction paths.

## Related material

- [Provenance and identifiers](../wiki/data/provenance-and-identifiers.md)
- [Integrity and lifecycle](../wiki/data/integrity-and-lifecycle.md)
- [Independent facts over DayRecord](20260728-prefer-independent-facts-over-broad-day-record.md)
- [User, Person, and access](20260730-separate-user-access-from-person-data-ownership.md)
- [Shared fact contracts plan](../../plans/2026/07/completed/2026-07-30-person-identity-provenance-and-corrections.md)
