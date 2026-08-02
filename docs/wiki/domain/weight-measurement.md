---
id: "domain-weight-measurement"
kind: domain
title: "WeightMeasurement"
status: draft
tags:
  - "domain"
  - "measurement"
  - "weight"
---

# WeightMeasurement

## Summary

`WeightMeasurement` is an immutable Person-owned weight fact with absolute
time, local date, typed provenance, and stable dedupe identity.

## Content

Fields include UUID, Person, measured time, derived local date, IANA timezone,
`weightKg`, SourceReference, dedupe key, nullable confidence, optional
supersession/correction reason, and creation time.

Invariants:

- weight is `0.500..700.000` kg in `numeric(6,3)`;
- confidence is null or `0..1`;
- time is `timestamptz`; server derives local date from verified timezone;
- `(person_id, source, dedupe_key)` makes creation idempotent;
- correction creates a new fact and never mutates the original;
- only same-Person facts may supersede, with one replacement per fact;
- current queries omit superseded facts and history returns the full chain.

## Evidence

- Drizzle schema, domain code, and integration tests.

## Decisions

- Google Sheets remains authoritative. `Weight` is the migration journal;
  `Daily_Log.Weight` is reconciliation evidence and creates no second fact.
- Multiple real measurements per local day are allowed.

## Open questions

- Final multi-event importer idempotency identity.

## Related material

- [Weight API](../api/weight-measurements.md)
- [Provenance](../data/provenance-and-identifiers.md)
- [Authority](../data/source-of-truth-and-authority.md)
