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

`DailyContextNote` has typed `contextKind` and `baselineEligibility` fields for
explicit context such as user-declared travel. Baseline policy does not infer
travel or eligibility from free text, a provider, timezone changes, or an LLM.
The live v3 assessment and read-only retrospective path both use the same
typed exclusions.

Personal baselines are derived on read from current owning-domain facts rather
than maintained as mutable records. Bounded history selection is deterministic,
excludes the assessed day, and preserves equal weight per eligible local date.
The same policy-parameterized pure evaluator serves the live balanced V3 policy
and every retrospective candidate. Completed local-day steps may enter the
full-day baseline; a current `partial_day` count is retained in the immutable
calculation but never teaches that baseline. Late imports, corrections, withdrawals, supersession,
deletion, and privacy erasure change the current evidence set; the next live
read creates or reuses the checksum-addressed immutable snapshot. Historical
non-erased snapshots are not rewritten, and the retrospective command performs
no domain writes.

Snapshot creation is serialized with every assessment-relevant Person writer
through one transaction-scoped advisory lock, including typed API writes,
Intake routing, and controlled import apply. The final transaction rechecks the
timezone/preference version and complete evidence revision before insertion;
three changing compositions fail closed. Legacy v1 and v2 snapshots remain
readable; V3 additionally pins the movement payload and personal-baseline-v2
calculation.
Additive migrations validate and backfill owner-safe Training activity and
RecoveryAssessment evidence links so Recovery erasure can remove old and new
derived snapshots before deleting their source graph.

The bounded retrospective range materializes every calendar day; a day without
decision evidence is counted as unavailable rather than disappearing from the
denominator. Schema feature detection marks context eligibility unavailable
when typed DailyContextNote columns are absent and never interprets free text.
Stored-snapshot and counterfactual analytics keep separate distributions and
continuity. Counterfactual calculations remain read-only and process-local and
never rewrite historical assessments.

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
- [Hybrid personal baselines for daily assessment](../../adr/20260915-use-hybrid-personal-baselines-for-daily-assessment.md)
  define the shadow projection, explicit context, and recalculation boundary.
- [Counterfactual v1 replay with explicit ambiguity](../../adr/20260915-replay-daily-assessment-v1-with-explicit-ambiguity.md)
  defines the current-facts replay, ambiguity envelope, and separated analytics.
- [Balanced personal-baseline activation in daily assessment v2](../../adr/20260917-activate-balanced-personal-baselines-in-daily-assessment-v2.md)
  defines live activation, immutable calculation, and the consistency fence.
- [Automatic day context and optional daily movement](../../adr/20260917-automate-day-context-and-use-optional-daily-movement.md)
  defines V3 movement roles, unset-only timezone capture, and compatibility.

## Open questions

- Retention of source text/photos/device evidence, user-visible versus
  retryable errors, and legacy multi-sheet transaction semantics.

## Related material

- [Authority](source-of-truth-and-authority.md)
- [Domain invariants](../domain/invariants.md)
- [Open questions](../domain/open-modeling-questions.md)
- [Capture-first Coach and DayClosure removal](../../adr/20260829-remove-day-closure-and-use-capture-first-coach.md)
- [Progress overview API](../api/progress-overview.md)
