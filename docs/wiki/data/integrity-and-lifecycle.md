---
id: "data-integrity-and-lifecycle"
kind: data
title: "Integrity and lifecycle"
status: draft
tags:
  - "data"
  - "integrity"
  - "lifecycle"
---

# Integrity and lifecycle

## Summary

Lifecycle/integrity contract derived from observed statuses, formulas,
deduplication, read-back, and append-only audit behavior.

## Content

Workflows use explicit states, idempotency keys, validation, read-back, and
append-only audit entries. Implement these as small state machines in owning
modules, not separate services.

A Person-local day may be open/closed, but closure cannot own Nutrition,
Training, Physical State, Recovery, or Coaching facts. Corrections remain
explicit and provenance-preserving.

## Evidence

- Daily_Log validation; NL_Engine; AI_Inbox; Self_Healing; AI_Timeline;
  AI_Insights; Load_Risk; Weight_Autopilot; Coach_Planner; Dashboard projection
  discrepancy.

## Decisions

- Model lifecycle inside modules. Health/safety gates and closed-day protection
  need explicit approval before implementation.

## Open questions

- Reopening closed days, retention of source text/photos/device evidence,
  user-visible versus retryable errors, and legacy multi-sheet transaction
  semantics.

## Related material

- [Authority](source-of-truth-and-authority.md)
- [Domain invariants](../domain/invariants.md)
- [Open questions](../domain/open-modeling-questions.md)
