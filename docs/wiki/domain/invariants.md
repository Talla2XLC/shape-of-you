---
id: "domain-invariants"
kind: domain
title: "Domain invariants"
status: draft
tags:
  - "domain"
  - "draft"
  - "invariants"
---

# Domain invariants

## Summary

Candidate invariants come from explicit workbook contracts. Formula behavior
without an explicit rule is implementation evidence, not an invariant.

## Content

- Ambiguous input is never stored as confirmed fact.
- Retries do not create duplicate facts.
- Corrections preserve provenance and supersession history.
- Person-local day closure does not own referenced facts.
- Execution is not inferred from plans or permissions.
- Recommendations remain separate from accepted/executed actions.
- Coaching links sufficient evidence and never claims correlation as causation.
- Writing to a closed day requires an explicit correction path.

Numeric thresholds, readiness scores, and progression parameters are candidates
for versioned policies rather than eternal invariants.

## Evidence

- Explicit NL_Engine, AI_Inbox, Self_Healing, AI_Timeline, AI_Insights,
  Load_Risk, Weight_Autopilot, Coach_Planner, DayStatus, and cross-sheet
  contracts.

## Decisions

- Safety thresholds require versioned policy and domain review.

## Open questions

- Expert-validated health invariants, closed-day override semantics, scoring
  ownership, and duplicate policy for device retries/same-day measurements.

## Related material

- [Integrity/lifecycle](../data/integrity-and-lifecycle.md)
- [Candidate aggregates](candidate-aggregates.md)
- [Open questions](open-modeling-questions.md)
