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

A Person-local date has no open/closed lifecycle. `DailyProjection` is an
always-live API read composition over current facts owned by Physical State,
Nutrition, Training, Recovery, Coaching, and bounded daily context notes. It
returns the requested `localDate`, IANA `timezone`, composition `asOf`, and a
typed snapshot; it never freezes or owns source facts.

The canonical authenticated `/days/:localDate` screen and the Today card on
`/progress` read this current composition. They expose no close, reopen, stale,
or superseded state. Missing metric facts remain absent rather than synthetic
zeros, and legacy `/day` routes safely replace themselves with the canonical
dated route.

Routine create/correct lifecycles remain inside owning modules. A direct,
relevant user report authorizes one low-risk idempotent typed write without a
duplicate confirmation question. Every successful write is followed by typed
read-back. Unknown optional values remain `null` or partial; a later precise
statement appends a correction that supersedes the prior fact.

Legacy `Daily_Log.DayStatus` is not imported into PostgreSQL and has no runtime
meaning. Google Sheets remains a non-authoritative read-only historical source
without write or fallback authority.

## Evidence

- Daily_Log validation; NL_Engine; AI_Inbox; Self_Healing; AI_Timeline;
  AI_Insights; Load_Risk; Weight_Autopilot; Coach_Planner; Dashboard projection
  discrepancy.

## Decisions

- Keep fact lifecycle inside owning modules and daily state as an always-live
  read composition; do not create a coordinating day aggregate.

## Open questions

- Retention of source text/photos/device evidence, user-visible versus
  retryable errors, and legacy multi-sheet transaction semantics.

## Related material

- [Authority](source-of-truth-and-authority.md)
- [Domain invariants](../domain/invariants.md)
- [Open questions](../domain/open-modeling-questions.md)
- [Capture-first Coach and DayClosure removal](../../adr/20260829-remove-day-closure-and-use-capture-first-coach.md)
- [Progress overview API](../api/progress-overview.md)
