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

- Irreducibly ambiguous input is not guessed into a materially different fact.
- Retries do not create duplicate facts.
- Corrections preserve provenance and supersession history.
- Current daily state is a read composition and does not own source facts.
- Execution is not inferred from plans or permissions.
- Recommendations remain separate from accepted/executed actions.
- Coaching links sufficient evidence and never claims correlation as causation.
- A direct relevant report authorizes one routine low-risk typed write; unknown
  optional values remain partial/null and successful writes require read-back.

Numeric thresholds, readiness scores, and progression parameters are candidates
for versioned policies rather than eternal invariants.

## Evidence

- Explicit NL_Engine, AI_Inbox, Self_Healing, AI_Timeline, AI_Insights,
  Load_Risk, Weight_Autopilot, Coach_Planner, DayStatus, and cross-sheet
  contracts.

## Decisions

- Safety thresholds require versioned policy and domain review.

## Open questions

- Expert-validated health invariants, scoring ownership, and duplicate policy
  for device retries/same-day measurements.

## Related material

- [Integrity/lifecycle](../data/integrity-and-lifecycle.md)
- [Candidate aggregates](candidate-aggregates.md)
- [Open questions](open-modeling-questions.md)
