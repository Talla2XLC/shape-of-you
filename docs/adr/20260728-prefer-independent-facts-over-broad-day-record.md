---
id: decisions-20260728-prefer-independent-facts-over-broad-day-record
kind: adr
title: "Prefer independent facts over a broad DayRecord"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - aggregates
  - domain
  - day-lifecycle
---

# Prefer independent facts over a broad DayRecord

## Context

The Google Sheets inventory showed that `Daily_Log` combines physical
measurements, nutrition totals, training state, recovery evidence, readiness,
and coaching outputs. Treating one row as an aggregate would copy legacy table
coupling into the domain model.

## Decision

Model nutrition, weight, training, recovery, and coaching outputs as
independently owned facts or derived artifacts. Treat `Daily_Log` primarily as
a legacy read model and migration projection.

A narrow draft candidate named `DayClosure` or `JournalDay` may coordinate
only the user's calendar date and timezone, open/closed lifecycle, closure
time, explicit corrections, references to confirmed facts, and creation of a
daily projection. Its final name and invariants are not accepted.

## Considered alternatives

- A broad `DayRecord` owning all daily data: rejected because it crosses
  domain ownership and creates an excessive consistency boundary.
- Preserve the spreadsheet row as persistence: rejected because formulas and
  AI outputs are projections rather than source facts.
- Remove date coordination entirely: deferred because day closure and explicit
  corrections still require modeling.

## Consequences

- Domain modules can evolve independently within the modular monolith.
- Daily views require explicit projection composition.
- Day closure cannot acquire implicit ownership of referenced facts.
- Cross-domain consistency uses references, policies, or events instead of one
  giant transaction.

## Verification

- Candidate aggregates do not own facts from multiple bounded contexts.
- Migration mapping classifies every `Daily_Log` field as a fact, reference,
  policy input, or projection.
- Architecture Review rejects a broad daily aggregate unless a new ADR
  supersedes this decision.

## Related material

- [Candidate aggregates](../wiki/domain/candidate-aggregates.md)
- [Domain extraction map](../wiki/domain/domain-extraction-map.md)
- [Google Sheets inventory](../wiki/data/google-sheets-inventory.md)
