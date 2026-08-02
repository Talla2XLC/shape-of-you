---
id: "domain-coaching-and-decision-support"
kind: domain
title: "Coaching and Decision Support"
status: draft
tags:
  - "coaching"
  - "decisions"
  - "domain"
  - "recommendations"
---

# Coaching and Decision Support

## Summary

Implemented Coaching separates immutable recommendations, user decisions, and
executed domain facts. The first slice supports typed training adjustment and
never applies it automatically.

## Content

Person-owned CoachingRecommendation pins kind, exact immutable policy version,
expiry, evidence checksum, explanation, idempotency key, typed detail, and
typed evidence links. Generic JSON/JSONB and polymorphic evidence are forbidden.

RecommendationDecision is a separate immutable accepted/rejected fact. One
terminal decision is allowed; retries are idempotent and opposite decisions
conflict. `expired` is derived from time; `executed` is not a recommendation
state and requires an owning-context command/fact.

Initial `training_adjustment` evidence includes exact RecoveryAssessment,
TrainingProgramVersion/assignment, and optional sessions. It may hold the
assignment, propose target weight, or propose a repetition range, changing at
most one parameter. It creates no program/session change.

## Evidence

- Coaching schema/contracts/integration tests.

## Decisions

- [Coaching ADR](../../adr/20260731-model-immutable-coaching-recommendations-and-separate-user-decisions.md).

## Open questions

- Production policy activation, difficulty/exercise replacement, other
  recommendation kinds, and explicit execution linkage.

## Related material

- [Recovery](recovery-and-readiness.md)
- [Training](training-and-performance.md)
- [Domain invariants](invariants.md)
