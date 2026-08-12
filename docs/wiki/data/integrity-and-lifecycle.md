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

A Person-local day is open when no active `DayClosure` exists. Closing creates
an immutable versioned summary and typed fact/decision references; reopening
supersedes rather than mutates or deletes that version. A later close appends a
new version. The closure cannot own Nutrition, Training, Physical State,
Recovery, or Coaching facts, and changed late evidence makes a closed daily
projection stale instead of silently rewriting its snapshot.

The closure records its IANA timezone, Person actor, and source channel. A
closed date is read only in its recorded timezone; a different timezone is a
conflict. Its coordinating read ports select every current fact for that exact
local date and do not depend on public-list pagination.

## Evidence

- Daily_Log validation; NL_Engine; AI_Inbox; Self_Healing; AI_Timeline;
  AI_Insights; Load_Risk; Weight_Autopilot; Coach_Planner; Dashboard projection
  discrepancy.

## Decisions

- Model lifecycle inside owning modules; `DayClosure` only coordinates an
  explicit Person-local close/reopen boundary.

## Open questions

- Retention of source text/photos/device evidence, user-visible versus
  retryable errors, and legacy multi-sheet transaction semantics.

## Related material

- [Authority](source-of-truth-and-authority.md)
- [Domain invariants](../domain/invariants.md)
- [Open questions](../domain/open-modeling-questions.md)
- [Versioned Person-local day closures](../../adr/20260811-model-versioned-person-local-day-closures.md)
