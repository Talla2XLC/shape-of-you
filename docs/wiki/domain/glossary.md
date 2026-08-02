---
id: "domain-glossary"
kind: domain
title: "Domain glossary"
status: draft
tags:
  - "domain"
  - "ubiquitous-language"
---

# Domain glossary

## Summary

Initial ubiquitous language derived from the accepted baseline.

## Content

- **User:** authentication identity that signs in and performs actions.
- **Person:** domain identity that owns fitness data.
- **Person access grant:** explicit User authority for a Person as `owner`,
  `editor`, `viewer`, or `coach`.
- **Authoritative source:** system treated as operational truth for a data set;
  currently Google Sheets for operational fitness data.
- **Atomic event:** one normalized independently validated observation/action
  extracted from input.
- **Closed day:** day protected from ambiguous automatic mutation; exact rules
  remain open.
- **Provenance:** typed origin evidence: channel, reference, timestamps,
  confidence.
- **Dedupe key:** stable retry identity within Person and source channel.
- **Supersession:** append-only replacement of an immutable fact while keeping
  original and correction reason.
- **AI Timeline:** append-only source-linked chronology with related corrections
  and reversals.
- **Readiness:** current recovery/capacity evidence; never authorizes
  progression alone.
- **Load Risk:** multi-day risk assessment that may block progression.
- **Progression:** minimal exercise-specific load increase after repeated
  successful evidence.
- **Deload:** controlled load-reduction state.
- **Calibration:** selecting appropriate working load when evidence is missing
  or stale.
- **RIR:** repetitions in reserve as effort evidence.
- **Daily plan:** coordinated daily nutrition/training/recovery actions.
- **Dual-run:** controlled old/new data coexistence with reconciliation.
- **Cutover:** approved authority transfer after integrity criteria pass.

## Evidence

- Operator baseline.

## Decisions

- Glossary defines language, not schemas. `User` and `Person` are not synonyms.

## Open questions

- Exact closed-day and successful-performance semantics.

## Related material

- [Overview](overview.md)
- [Bounded contexts](bounded-contexts.md)
- [Migration](../architecture/migration-strategy.md)
