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

The Daily Coach presentation preserves the same boundary across existing MCP
tools. `Planned` contains only typed plan artifacts, currently the active
TrainingProgramVersion and prescriptions. `Proposed now` contains bounded,
evidence-linked conversation advice and is not a persisted fact. `Actually
completed` contains only current owning-domain facts verified through typed
reads. There is no cross-domain `DailyPlan`, and an accepted recommendation or
chat message never proves execution.

The exact-date starting point is the always-live `get_daily_projection` read.
A direct relevant user report authorizes one routine low-risk idempotent write
through the owning typed tool without a duplicate confirmation question. The
Coach performs typed read-back before declaring success. Unknown optional
values remain partial/null; later precise input appends a correction. A bounded
`DailyContextNote` is used only when no more specific owning-domain fact can
represent a relevant observation safely.

Routine capture stays conversational. The Coach matches the user's language
and tone and confirms the recorded or corrected facts in one to three natural
sentences. For a meaningful nutrition, training, recovery, or daily-summary
interaction, one useful evidence-grounded interpretation and concrete next step
are mandatory unless the user explicitly asks for raw facts only. A reply that
only acknowledges or summarizes captured facts is incomplete. When a specific
domain recommendation cannot be made safely, the Coach still ends with the
safest useful next action supported by verified facts or asks for the single
observation needed to make the next recommendation useful. The
Coach performs an unambiguous routine write or correction instead of asking
whether the user wants it recorded, corrected, or estimated. It keeps tool names,
arguments, identifiers, contract fields, completeness states, and transport
details out of the reply. Validation, execution, and OAuth failures use a
separate fail-closed presentation: the Coach does not claim success or advise
from unverified facts and does not expose the internal reason. Daily-plan
headings are reserved for an actual daily-plan answer and are not constrained
to the routine one-to-three-sentence shape. The MCP adapter retains typed
`structuredContent` for orchestration but uses a tool-specific Meal presentation
instead of duplicating the raw domain DTO into model-facing text. When a reported
Meal includes a sufficiently legible photo or useful size description, the Coach
immediately makes a best-effort portion and calorie/macronutrient estimate with
bounded confidence; measured grams are not a prerequisite. It reports the
result as approximate and keeps later ordinary-language corrections available.
The underlying Meal domain and legacy import retain unknown amount or nutrient
evidence, but Coach MCP writes do not accept `amountKind = unknown` or null
calories/macronutrients. If material foods or scale cannot be estimated
reasonably, the Coach asks one natural clarification instead of claiming an
incomplete Meal was recorded. No path invents a sentinel quantity.

For Training, `get_active_training_program` explicitly distinguishes an active
program from valid absence. Only its typed `absent` result proves that no
`Planned` training artifact is available; a tool failure remains unknown and
stops dependent coaching without chat-history or Sheets fallback.

## Evidence

- Coaching schema/contracts/integration tests.
- TASK-0086 accepted MCP photo-estimation and read-back fixture.

## Decisions

- [Coaching ADR](../../adr/20260731-model-immutable-coaching-recommendations-and-separate-user-decisions.md).
- [Daily Coach over existing MCP tools](../../adr/20260827-orchestrate-daily-coach-over-existing-mcp-tools.md).
- [Capture-first Coach and DayClosure removal](../../adr/20260829-remove-day-closure-and-use-capture-first-coach.md).
- [Unquantified Meal amount and natural Coach language](../../adr/20260830-model-unquantified-meal-amount-evidence-and-natural-coach-language.md).
- [Per-result proactive Coach policy](../../adr/20260902-deliver-coach-reply-policy-in-every-relevant-mcp-result.md).
- [MCP active-program absence](../../adr/20260828-represent-active-training-program-absence-explicitly-in-mcp.md).

## Open questions

- Production policy activation, difficulty/exercise replacement, other
  recommendation kinds, and explicit execution linkage.

## Related material

- [Recovery](recovery-and-readiness.md)
- [Training](training-and-performance.md)
- [Domain invariants](invariants.md)
