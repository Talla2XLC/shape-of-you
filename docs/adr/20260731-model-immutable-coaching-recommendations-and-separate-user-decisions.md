---
id: "decisions-20260731-model-immutable-coaching-recommendations-and-separate-user-decisions"
kind: adr
title: "Model immutable Coaching recommendations and separate user decisions"
status: accepted
date: 2026-07-31
supersedes: []
superseded_by: null
tags:
  - "coaching"
  - "evidence"
  - "policies"
  - "recommendations"
---

# Model immutable Coaching recommendations and separate user decisions

## Context

Coaching turns published assessments and domain facts into explainable action
proposals. A recommendation is not an executed fact, must not mutate a program
automatically, and must preserve the exact policy and evidence used.

Owner, expiry, idempotency, policy version, and user-decision requirements
repeat across recommendation kinds, while recommendation content must remain
typed and database-verifiable.

## Decision

1. Immutable Person-owned `CoachingRecommendation` stores kind, exact
   `CoachingPolicyVersion`, creation/expiry time, evidence checksum,
   explanation, and idempotency key.
2. Every recommendation kind has a typed detail table. Arbitrary JSON/JSONB
   domain storage is forbidden.
3. Evidence uses separate typed foreign-key links to owning modules, never
   polymorphic `(type, id)` references.
4. Immutable Person-owned `RecommendationDecision` stores `accepted` or
   `rejected`, time, actor, and reason. Recommendation status is not mutated.
5. One terminal decision per recommendation. Same-command retries are
   idempotent; the opposite decision conflicts.
6. `proposed`, `accepted`, `rejected`, and `expired` are projection states.
   `expired` derives from `expires_at` when undecided, without a scheduler.
7. `executed` is not a recommendation state. Only a command and fact in the
   owning context can prove execution. Acceptance creates no workout and
   changes no program.
8. Shared `CoachingPolicy` and immutable versions belong to Coaching. Initial
   parameters are typed; no generic rules engine. Production activation needs
   separate approval.
9. First kind is `training_adjustment`, using exact RecoveryAssessment,
   current TrainingProgramVersion, assignment, and optional sessions as
   read-only evidence.
10. The initial detail can hold the assignment, propose target weight, or
    propose a repetition range, changing at most one parameter.
11. Exercise difficulty/substitution, daily plan, nutrition, and recovery
    guidance wait for typed contracts.
12. Explicit command creates a reproducible recommendation. LLM, provider,
    queue, scheduler, and automatic application are outside the decision.

## Considered alternatives

- Full aggregate per recommendation kind: strict but duplicates policy pinning,
  checksum, expiry, idempotency, Person isolation, and decision lifecycle.
- Common immutable lifecycle with typed details/evidence: removes repetition
  while preserving relational constraints. Selected.

Untyped JSON/JSONB is not an acceptable domain alternative when a relational
model exists. JSON is allowed only for separately justified raw external
snapshots and is not part of this slice.

## Consequences

- One history serves all recommendation kinds without mixing detail contracts.
- New kinds require contract, detail table, evidence links, and migration
  review.
- User decisions remain traceable separately from advice content.
- Expiry needs no background process.
- Coaching reads Recovery and Training but cannot mutate them.
- Applying accepted advice requires a separate Training command and decision
  about execution linkage.

## Verification

- Recommendation, detail, policy version, and evidence form one consistent
  typed graph.
- Other People cannot read or decide a recommendation.
- Concurrent decisions cannot create two terminal outcomes.
- Expired recommendations cannot be accepted or rejected.
- Calculation and acceptance change no programs, sessions, assessments, or
  source observations.
- One training adjustment changes at most one supported parameter.
- Schema has no polymorphic evidence table or JSON/JSONB domain fields.

## Related material

- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
- [Bounded contexts](../wiki/domain/bounded-contexts.md)
- [Domain invariants](../wiki/domain/invariants.md)
- [Shared definitions and Person state](20260731-separate-shared-reference-definitions-from-person-owned-state.md)
- [Recovery assessments](20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md)
- [Training programs and sessions](20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
- [Completed implementation plan](../../plans/2026/07/completed/2026-07-31-coaching-recommendation-lifecycle.md)
