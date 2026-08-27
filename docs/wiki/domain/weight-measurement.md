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

`WeightMeasurement` is an immutable Person-owned weight fact with explicit
instant or local-date precision, typed provenance, and stable dedupe identity.

## Content

Fields include UUID, Person, temporal precision, nullable measured instant,
local date, IANA timezone,
`weightKg`, SourceReference, dedupe key, nullable confidence, optional
supersession/correction reason, and creation time.

Invariants:

- weight is `0.500..700.000` kg in `numeric(6,3)`;
- confidence is null or `0..1`;
- `instant` requires `measured_at`; interactive HTTP/MCP commands remain
  instant-only and derive local date from verified timezone;
- `local_date` requires `measured_at IS NULL` and is available only to the
  internal typed importer, which never invents a time;
- `(person_id, source, dedupe_key)` makes creation idempotent;
- correction creates a new fact and never mutates the original;
- only same-Person facts may supersede, with one replacement per fact;
- current queries omit superseded facts and history returns the full chain.

## Evidence

- Drizzle schema, domain code, and integration tests.

## Decisions

- PostgreSQL `WeightMeasurement` is authoritative. The frozen Sheets `Weight`
  tab is a legacy migration journal/checkpoint; `Daily_Log.Weight` is
  reconciliation evidence and creates no second fact.
- Multiple real measurements per local day are allowed. Current lists order by
  local date descending, then known instant with nulls last, then UUID.

## Open questions

- Domain mappings and identity rules for non-Weight importer adapters.

## Related material

- [Weight API](../api/weight-measurements.md)
- [Provenance](../data/provenance-and-identifiers.md)
- [Authority](../data/source-of-truth-and-authority.md)
- [Importer ADR](../../adr/20260821-use-relational-import-batches-and-explicit-weight-temporal-precision.md)
