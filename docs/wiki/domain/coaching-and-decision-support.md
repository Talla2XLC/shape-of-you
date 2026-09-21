---
id: "domain-coaching-and-decision-support"
kind: domain
title: "Coaching and Decision Support"
status: draft
tags:
  - "coaching"
  - "decisions"
  - "domain"
  - "feedback"
  - "recommendations"
---

# Coaching and Decision Support

## Summary

Implemented Coaching separates immutable recommendations, user decisions, and
executed domain facts. It supports typed training adjustments, an API-owned
explainable daily assessment, hybrid evidence-backed completion assessment,
and typed feedback on its recommended action. None creates or mutates an
owning-domain fact.

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
coverage, and applies the code-owned `daily-assessment-v4` policy. Version 4
first evaluates the unchanged absolute v1 safety rules, then applies the
balanced personal-baseline policy to Recovery, Training, and optional daily
movement. Completed local-day step totals can form a robust personal range;
current-day steps remain explicit `partial_day` evidence with an exact `asOf`.
A partial count can prove only that movement is already above the usual full-day
range. It cannot prove low activity, request missing steps, or strengthen the
result without corroborating adverse Recovery or Training evidence. The result
contains a safe day status, used facts, important missing data, typed reasons,
one primary recommended action, bounded alternatives, limitations, confidence,
policy version, qualitative personal comparisons, and evidence checksum. The
primary V4 action also carries a closed `all_of` completion specification whose
authoring default is one atomic required criterion. Its observation window is
limited to owner facts recorded after the recommendation on the same
Person-local date; presentation text is never parsed as an executable rule. Its private
immutable calculation preserves the exact policy bundle, selected evidence,
eligibility trace, comparisons, signal groups, and chosen result. Identical
evidence reuses the snapshot; a late or corrected fact, context exclusion, or
active TrainingProgramVersion changes the checksum and selects a new snapshot.
Historical snapshots remain readable audit evidence unless privacy erasure
removes one derived from erased evidence. Legacy v1, v2, and v3 snapshots
remain readable.

`DailyRecommendationCompletionAssessment` is a separate immutable Coaching
conclusion for one exact V4 snapshot and completion-policy version. It keeps
`completionState` (`completed`, `partially_completed`, `not_completed`, or
`unknown`) independent from `evidenceMode` (`observed`, `self_reported`,
`partially_observed`, or `unknown`). The lazy Person-scoped read evaluates
current Weight, Meal, exact-program WorkoutSession, connected activity,
Recovery check-in, sleep, steps, and TrainingProgram evidence through existing
owner-module reads. Each criterion result retains freshness, completeness,
observation time, limitations, and a typed relational link to the exact owner
fact when one exists. Identical evidence checksums reuse an assessment; changed
or corrected evidence appends a new one.

Automatic completion v1 is positive-evidence only. Every required criterion
must be satisfied by fresh and complete evidence for `completed/observed`.
Partial, stale, ambiguous, unlinked, or unavailable evidence remains partial or
unknown. Missing data never means failure, and automation never derives
`not_completed`. An unlinked external activity can only partially support an
exact programmed-workout criterion. A partial-day step value can prove a
threshold already crossed but cannot prove low activity or non-completion.
Broad recovery-first behavior remains manual or unknown.

`DailyRecommendationFeedback` is a separate Person-owned append-only event
stream linked to the exact `daily_next_action` snapshot. Its required status is
`accepted`, `completed`, `skipped`, `too_heavy`, or `unsuitable`; an optional
nonblank comment only supplements that status. `accepted` may precede an
outcome, and suitability feedback may coexist with it. `completed` and
`skipped` form one disposition signal family. Corrections append a new event
whose `supersedesFeedbackId` identifies the exact active predecessor; the old
event remains immutable, and competing successors conflict. Exact retries are
idempotent in the Person boundary, including the supersession target, while
reuse of an idempotency key with different content conflicts. Feedback remains
valid after recommendation expiry and is removed when privacy erasure removes
the linked snapshot.

The API exposes Person-scoped feedback creation and ordered history under the
daily-assessment boundary. Coach records an explicit, unambiguous response
through `record_daily_recommendation_feedback` using the exact `snapshotId`
returned by the assessment and the dedicated
`daily-recommendation-feedback:write` scope. It does not infer feedback from
silence or unrelated behavior, guess an ambiguous snapshot, or ask for a
duplicate confirmation. Feedback is evidence for later analysis only: it does
not enter assessment evidence, checksum, baseline, status, action, or policy;
does not create an owning-domain fact; and does not trigger learning or policy
calibration. The active explicit `completed` or `skipped` disposition resolves
the user-facing completion conclusion as self-reported. Suitability signals do
not resolve completion. A conflict with observed evidence is retained as an
explicit limitation rather than silently changing either claim.

The read-only retrospective calibration path calls the same parameterized pure
personal-policy evaluator as live V3 and adds only aggregate reporting. Its
analytics keep two independent modes. `stored_v1` starts from an immutable v1
snapshot and is the only exact record of the historical v1 decision.
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
range. The report also compares V2 and V3 on completed-day evidence, counting
movement coverage, decision differences, transitions, reversals, and suspicious
movement-only escalation. The command creates no assessment or recommendation and emits only a
fixed aggregate report without dates, values, Person identifiers, provider
identities, or daily rows. Real-history execution requires separate environment
and Person authorization. It never changes current recommendations.

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
chat message never creates execution facts. The exact completion assessment
may explain that an action is observed, partially observed, self-reported, or
unknown, but remains a derived Coaching conclusion. A `completed` feedback
event records the user's explicit outcome report for that recommendation, but does not create a
WorkoutSession, Meal, RecoveryObservation, TrainingProgram mutation, or other
owning-domain fact.

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
Person-owned IANA timezone determines the local date. Authenticated Web stores
the browser IANA timezone atomically only while that preference is unset. Coach
may correct it through the narrow `set_current_timezone` tool and dedicated
`person-timezone:write` scope only after an explicit unambiguous user statement,
then retries `get_daily_assessment` in the same turn. Ambiguity requires one
natural clarification; no path guesses silently or constructs a fallback
recommendation from individual facts.

Focused questions about today's sleep, HRV, resting heart rate, Body Battery,
or steps use the read-only `get_current_recovery_context` composition. Typed
Recovery observations remain the only authority for metric values. The v2
context pairs a Coach-safe typed observation projection with closed per-metric
delivery states. Before the first successful normalization under a new OAuth
consent, a stored value is explicitly `retained_unconfirmed`: Coach says that
it was saved earlier and that current freshness is not yet confirmed. It does
not claim that reconnect, migration, or another unverified event caused the
state.

`confirmed_absent` means only that the current normalized delivery omitted the
field. Coach never converts absence into zero or invents a provider-side or
physiological explanation. Current-day steps with `partial_day` and `asOf` are
reported only as the intermediate count observed at that instant, never as a
final or complete day total or evidence of low activity. Aggregate
`targetDateDelivery` remains a compatibility summary; explanations use the
individual metric states so an HRV-only delivery cannot imply complete sleep,
steps, or Body Battery data.

The provider-neutral `syncState` still describes whether a connected-data
attempt is fresh, stale, failed, absent, or unavailable. This context may
explain availability but cannot change the status or action returned by
`get_daily_assessment`. The read is local and does not depend on provider
availability, initiate refresh, create automation, or promise an autonomous
recheck. Its public schema excludes Person, connection, consent, source-record,
correction-chain, receipt, checksum, credential, and raw provider identities.

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
- TASK-0117 accepted atomic timezone bootstrap, optional movement-aware V3,
  legacy snapshot hydration, recalculation, and aggregate-only retrospective
  tests.
- TASK-0118 accepted provider-neutral Recovery freshness composition, direct
  delivery evidence, consent-reset, MCP contract, and fail-closed wording tests.
- TASK-0120 accepted consent-scoped per-metric delivery, exact observation
  publication, partial-step wording, safe MCP projection, and crash-cut tests.
- TASK-0119 accepted typed daily-recommendation feedback contracts, exact
  snapshot ownership, idempotency, concurrency, privacy cascade, OAuth/MCP,
  and DailyAssessment non-interference tests.
- TASK-0121 accepted DailyAssessment V4 criteria, hybrid completion evaluator,
  immutable provenance, append-only feedback correction, HTTP/MCP reads,
  migration, privacy, policy-matrix, and legacy-compatibility tests.

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
- [Balanced personal-baseline activation in daily assessment v2](../../adr/20260917-activate-balanced-personal-baselines-in-daily-assessment-v2.md).
- [Automatic day context and optional daily movement](../../adr/20260917-automate-day-context-and-use-optional-daily-movement.md).
- [Connected Recovery freshness for Coach](../../adr/20260918-expose-connected-recovery-freshness-to-coach.md).
- [Consent-scoped Recovery delivery evidence](../../adr/20260919-bind-recovery-delivery-to-consent-generation.md).
- [Typed feedback for daily recommendations](../../adr/20260918-record-typed-daily-recommendation-feedback.md).
- [Domain-fact completion for daily recommendations](../../adr/20260921-determine-daily-recommendation-completion-from-domain-facts.md).

## Open questions

- Measured post-deployment V4 stability, broader atomic action authoring,
  future evidence-based calibration, difficulty/exercise replacement, future
  daily policy versions, and explicit owning-domain execution linkage.

## Related material

- [Recovery](recovery-and-readiness.md)
- [Training](training-and-performance.md)
- [Domain invariants](invariants.md)
