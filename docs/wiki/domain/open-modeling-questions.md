---
id: "domain-open-modeling-questions"
kind: domain
title: "Open modeling questions"
status: draft
tags:
  - "domain"
  - "draft"
  - "questions"
---

# Open modeling questions

## Summary

Unresolved questions that must be answered before final domain, schema, API, or
migration design.

## Content

High cost of change:

- final name, ownership, and invariants for `DayClosure`/`JournalDay`;
- wearable/health retention periods and authenticated erasure protocol before
  production ingestion.

Insufficient evidence:

- privacy, retention, and deletion for body photos/notes before real import;
- external Exercise catalog source, licensing, attribution, quality, and
  moderation;
- conflict policy for future channels beyond the confirmed
  `Weight`/`Daily_Log.Weight` mirror;
- external Nutrition sources, licensing, attribution, quality, rate limits,
  and moderation;
- actor roles/write authorization for shared Nutrition catalog in multi-user
  runtime.

Resolved areas now live in ADRs: User/Person ownership, typed provenance and
supersession, body sessions/goals/weight reconciliation, layered Nutrition,
shared-reference ownership, Training versions/sessions, typed Recovery and
policy-pinned assessments, and typed immutable Coaching lifecycle.

Still open: production Coaching policy parameters, exercise difficulty/
replacement contracts, and authenticated erasure.

## Evidence

- Gaps found across the 26-sheet inventory and current authority/provenance/
  lifecycle/domain pages.

## Decisions

- Keep this as the canonical unresolved modeling list; high-cost resolutions
  require ADRs.

## Open questions

- The items listed in Content.

## Related material

- [Candidate aggregates](candidate-aggregates.md)
- [Extraction map](domain-extraction-map.md)
- [Sheets inventory](../data/google-sheets-inventory.md)
- [ADR catalog](../../adr/)
