---
id: "domain-physical-goal"
kind: domain
title: "PhysicalGoal"
status: draft
tags:
  - "domain"
  - "goals"
  - "physical-state"
  - "versioning"
---

# PhysicalGoal

## Summary

`PhysicalGoal` is a versioned Person-owned plan. The stable root owns lifecycle;
immutable versions preserve intent/criteria; progress is a query projection.

## Content

`PhysicalGoalVersion` stores version number, narrative intent/title, optional
effective/target dates, and typed criteria. Criteria support controlled metric,
direction or target mode, optional exact/range values, and canonical unit.
Narrative goals without numeric targets are valid.

Editing creates a draft version. Activation atomically selects current version
with optimistic conflict handling; old versions never change. Completion and
cancellation update root lifecycle, not measurements/history. Terminal goals
cannot be reactivated.

## Evidence

- Schema/domain code and Physical State integration tests.

## Decisions

- Goals are plans, not measurements, policies, or mutable settings.
- No separate current-state authority table is created.

## Open questions

- Future progress policies and UI interpretation for narrative goals.

## Related material

- [Physical Goal API](../api/physical-goals.md)
- [Physical State ADR](../../adr/20260730-model-body-measurement-sessions-and-versioned-physical-goals.md)
