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
executed domain facts. It supports typed training adjustments and an API-owned,
explainable daily assessment; neither is applied automatically.

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

The `daily_next_action` recommendation is a lazily materialized immutable
snapshot for the current Person-local date. The API gathers current typed
Recovery, Training, Nutrition, and Weight facts, plus provider-neutral profile
coverage, and applies the code-owned `daily-assessment-v1` policy. The result
contains a safe day status, used facts, important missing data, typed reasons,
one recommended action, bounded alternatives, limitations, confidence, policy
version, and evidence checksum. Identical evidence reuses the snapshot; a late
or corrected fact or active TrainingProgramVersion changes the checksum and
selects a new snapshot. Historical snapshots remain audit evidence unless
Recovery erasure removes a snapshot derived from the erased observations.

Personal-baseline support currently exists only as a read-only retrospective
calibration path; `daily-assessment-v1` remains the production authority. Its
analytics keep two independent modes. `stored_v1` starts from an immutable v1
snapshot and is the only exact record of a historical or displayed decision.
`counterfactual_current_facts_v1` runs the same v1 evaluator over current,
corrected daily projections but does not reconstruct the exact historical
input, full reasons, missing-data list, confidence, alternatives, or what the
user saw. Because historical TrainingProgram activation is unavailable, it
evaluates `program_absent` and `program_present`; a differing status or action
type makes the day `ambiguous_program_state`. Ambiguous and unavailable days
break counterfactual continuity, and stored and counterfactual distributions,
transitions, and reversals never mix. A mode-labelled sensitivity ranking is
emitted only with at least 30 comparable days and is not activation evidence.
Candidate baselines use bounded provider-neutral owner reads, robust daily
samples, absolute safety guardrails, and a warm-up interval outside the reported
range. The command creates no assessment or recommendation and emits only a
fixed aggregate report without dates, values, Person identifiers, provider
identities, or daily rows. Real-history execution requires separate environment
and Person authorization. Production `daily-assessment-v2` is not activated.

Recovery still owns physiological evidence, load-risk assessments, hard stops,
and erasure. Training still owns active programs, sessions, and connected
activity facts. Coaching may recommend recovery first, collecting one missing
check-in, following the active program without progression, completing a
nutrition record, or confirming a program. It cannot invent a workout,
exercise, set, load, schedule, diagnosis, or completed fact. Hard stops dominate
Training signals, and sparse evidence cannot produce a new prescription.

The Daily Coach presentation preserves the same boundary across existing MCP
tools. `Planned` contains only typed plan artifacts, currently the active
TrainingProgramVersion and prescriptions. `Proposed now` contains bounded,
evidence-linked conversation advice and is not a persisted fact. `Actually
completed` contains only current owning-domain facts verified through typed
reads. There is no cross-domain `DailyPlan`, and an accepted recommendation or
chat message never proves execution.

The exact-date factual view remains the always-live `get_daily_projection`
read. For clients with the current tool catalog, a full Daily Coach decision
starts with `get_daily_assessment`. For an already open conversation that knows
only the stable projection read, the API also places the exact matching-day
`DailyAssessmentResult` in that read's current model-facing content while
preserving its legacy `DailyProjection` structured result. Both paths use the
same assessment snapshot and policy authority. ChatGPT explains the returned
status, reasons, missing evidence, confidence, and action without recalculating,
replacing, or extending them. A historical or date/timezone-mismatched
projection remains factual-only; an unavailable assessment cannot authorize a
fact-derived action and permits only a later retry. Both reads use the existing
`person:read` scope and are read-only. Snapshot materialization is an internal
idempotent API responsibility and does not grant MCP write authority. The
Person-owned IANA timezone determines the local date. Until it is stored through
the authenticated first-party HTTP boundary, the assessment returns
`timezone_required` rather than guessing from chat, browser, or provider data.

A direct relevant user report authorizes one routine low-risk idempotent write
through the owning typed tool without a duplicate confirmation question. The
Coach performs typed read-back before declaring success. Unknown optional
values remain partial/null; later precise input appends a correction. A bounded
`DailyContextNote` is used only when no more specific owning-domain fact can
represent a relevant observation safely.

Routine capture stays conversational. The Coach matches the user's language
and tone and confirms the recorded or corrected facts in one to three natural
sentences. Outside a full API-owned daily assessment, a meaningful nutrition,
training, recovery, or factual daily-summary interaction includes one useful
evidence-grounded interpretation and concrete next step unless the user
explicitly asks for raw facts only. A reply that only acknowledges or summarizes
captured facts is incomplete. When a specific domain recommendation cannot be
made safely, the Coach still ends with the safest useful next action supported
by verified facts or asks for the single observation needed to make the next
recommendation useful. A full daily assessment is the exception: it preserves
the API-returned action and adds no prompt-owned alternative. The
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

`get_training_context` makes the same boundary durable while returning bounded
recent WorkoutSession evidence. With no active program, Coach may reconstruct a
candidate from completed sessions only as `Proposed now`; it cannot label or
activate that candidate as `Planned`. A material program change requires the
user to confirm the complete workouts, exercise order, loads, and progression.
`save_confirmed_training_program` then performs one Person-scoped atomic
create-or-version-and-activate command with optimistic expectations and
duplicate no-op behavior. Coach verifies the complete active snapshot through
a typed read before reporting success. The persisted active program is shared
authority across conversations; per-chat memory is not an authority source.

The same Training context also returns a separate bounded list of current
connected activity summaries. Coach treats an imported run, ride, or other
activity as completed evidence without asking the user to resend a screenshot
or manual reminder. A connected summary is not a detailed `WorkoutSession`:
Coach does not invent exercises or sets, does not automatically persist it as a
session, and does not double-count a plausible match between the two collections
without sufficient identity evidence. Internal integration identities,
credentials, checksums, and raw provider payloads are not exposed through MCP.

## Evidence

- Coaching schema/contracts/integration tests.
- TASK-0086 accepted MCP photo-estimation and read-back fixture.
- TASK-0112 accepted daily policy, MCP, migration, correction, timezone,
  Person-isolation, and Recovery-erasure tests.
- TASK-0113 accepted stable-read delivery, frozen-schema compatibility, and
  fail-closed assessment fallback tests.

## Decisions

- [Coaching ADR](../../adr/20260731-model-immutable-coaching-recommendations-and-separate-user-decisions.md).
- [Daily Coach over existing MCP tools](../../adr/20260827-orchestrate-daily-coach-over-existing-mcp-tools.md).
- [Capture-first Coach and DayClosure removal](../../adr/20260829-remove-day-closure-and-use-capture-first-coach.md).
- [Unquantified Meal amount and natural Coach language](../../adr/20260830-model-unquantified-meal-amount-evidence-and-natural-coach-language.md).
- [Per-result proactive Coach policy](../../adr/20260902-deliver-coach-reply-policy-in-every-relevant-mcp-result.md).
- [MCP active-program absence](../../adr/20260828-represent-active-training-program-absence-explicitly-in-mcp.md).
- [Confirmed TrainingProgram MCP command](../../adr/20260912-persist-confirmed-training-programs-through-one-mcp-command.md).
- [Connected activity summaries in Training context](../../adr/20260913-expose-connected-activity-summaries-in-training-context.md).
- [API-owned daily assessment and next action](../../adr/20260914-own-daily-assessment-and-next-action-in-api.md).
- [Stable MCP read delivery for existing conversations](../../adr/20260915-deliver-daily-assessment-through-stable-mcp-reads.md).
- [Hybrid personal baselines for daily assessment](../../adr/20260915-use-hybrid-personal-baselines-for-daily-assessment.md).
- [Counterfactual v1 replay with explicit ambiguity](../../adr/20260915-replay-daily-assessment-v1-with-explicit-ambiguity.md).

## Open questions

- Personal-baseline candidate calibration, typed Training load-basis
  compatibility, production activation, difficulty/exercise replacement,
  future daily policy versions, and explicit execution linkage.

## Related material

- [Recovery](recovery-and-readiness.md)
- [Training](training-and-performance.md)
- [Domain invariants](invariants.md)
