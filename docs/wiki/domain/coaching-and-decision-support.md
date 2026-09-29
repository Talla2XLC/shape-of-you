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
executed domain facts. Current Daily Coach decisions use a read-only
`DailyDecisionContext` of verified facts and Training options. Legacy API-owned
DailyAssessment snapshots, evidence-backed completion, and typed feedback
remain readable. None creates or mutates an owning-domain fact.

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

When discussing how to perform the next active strength workout, including
ordinary questions about working weights, repetitions, or sets, Coach reads
the current Daily Decision Context and Training context before the read-only
`get_training_progression` composition. It calls progression when both reads
identify the same exact strength next step. Routine fact capture, unrelated
topics, absent or ambiguous steps, and completed training do not need this read.
Training supplies an exact A/B progression suggestion from detailed sets;
Coach weighs current Recovery facts before advising how to train.
The result includes target and actual weights, repetitions, RIR, dates, and
typed limitations so Coach can explain a hold or a small increase without
inventing Garmin sets. A current-day result is not a future readiness promise.
The guidance read does not write a program. For a concrete eligible increase,
Coach may show the exact old and new working weight and ask once whether the
Person confirms it with sound technique and no pain. Only a clear acceptance
of that proposal authorizes `apply_confirmed_working_weight`; doubt, an edit,
or a different response does not. The API rechecks current Recovery, detailed
sessions, and program version before changing one prescription and activating
the immutable successor. Coach verifies Training and Daily Decision Context
afterward. Candidate acceptance remains a separate inactive-draft path. See
the [confirmed working-weight ADR](../../adr/20260929-confirm-working-weight-increase-atomically.md).

The current `DailyDecisionContext` v1 contains Person-local daily fact
summary, coverage, personal comparisons, current Recovery observations with
time and quality, delivery state, and the exact next Training step. It has no
daily status, recommended action, alternatives, or training-permission flag.
Coach decides whether and how to recommend training from this evidence and
the Person's request. Explicit illness or injury concern remains visible; an
unknown or stale observation is not reassuring evidence. This read creates no
recommendation snapshot. Its conversation choice has no automatic completion
until a separate decision defines how to save that exact choice. See the
[agent-owned decision ADR](../../adr/20260928-let-coach-decide-from-verified-daily-facts.md).

The legacy `daily_next_action` recommendation is a lazily materialized immutable
snapshot for the current Person-local date. The API gathers current typed
Recovery, Training, Nutrition, and Weight facts, plus provider-neutral profile
coverage, and applies the code-owned `daily-assessment-v6` policy. It first
evaluates the unchanged absolute v1 safety rules, then applies the
balanced personal-baseline policy to Recovery, Training, and optional daily
movement. Completed local-day step totals can form a robust personal range;
current-day steps remain explicit `partial_day` evidence with an exact `asOf`.
A partial count can prove only that movement is already above the usual full-day
range. It cannot prove low activity, request missing steps, or strengthen the
result without corroborating adverse Recovery or Training evidence. The result
contains a safe day status, used facts, important missing data, typed reasons,
one primary recommended action, bounded alternatives, limitations, confidence,
policy version, qualitative personal comparisons, and evidence checksum. The
primary action also carries a closed `all_of` completion specification whose
authoring default is one atomic required criterion. Its observation window is
limited to owner facts recorded after the recommendation on the same
Person-local date; presentation text is never parsed as an executable rule. Its private
immutable calculation preserves the exact policy bundle, selected evidence,
eligibility trace, comparisons, signal groups, and chosen result. Identical
evidence reuses the snapshot; a late or corrected fact, context exclusion,
active TrainingProgramVersion, imported-activity classification, or a current
session/activity link changes the checksum and selects a new snapshot.
Classification and link revisions also participate in the Person
evidence-revision guard, so a concurrent change forces the
assessment to recompose instead of persisting stale output.
Version 5 additionally checks the five fully completed Person-local days before
assessment. A day qualifies through a detailed session with performed sets or
an imported activity lasting at least 20 minutes with positive training load.
Multiple facts on one day count once, and a short standalone warmup does not
qualify. Five consecutive training days turn an otherwise `ready` result into
`caution` with a subjective recovery check-in before the next strength workout;
stronger recovery signals keep priority. This is a conservative Shape of You
rule, not a Garmin Training Readiness score. The dated count and reason enter
the v5 used facts and checksum. Historical snapshots remain readable audit
evidence unless privacy erasure removes one derived from erased evidence.
Legacy v1–v4 snapshots remain readable. See the
[density ADR](../../adr/20260926-account-for-training-density-and-program-version-changes.md).

Version 6 includes current direct qualitative wellbeing reports as exact
Recovery observation IDs and closed signals in used facts and the checksum.
Reported illness or injury concern stops training progression; fatigue or
soreness makes an otherwise actionable decision cautious. An existing
`insufficient_data` decision still requests missing evidence, with the report
shown as a reason. Feeling well cannot lift another restriction or create
readiness from sparse data. Coach records a clear current report through
Recovery, reads it back, and requests a fresh `get_daily_decision_context`
before deciding from current facts. It asks one short question only when a material detail
is unclear and does not require a check-in after every reply. Today's result
does not promise readiness for a future workout. Earlier v5 snapshots remain
readable and completion-capable. See the
[qualitative wellbeing ADR](../../adr/20260927-record-qualitative-wellbeing-in-recovery-and-reassess.md).

Daily Assessment counts a linked detailed session and imported activity as one
training occurrence. External activity remains the source of its numeric
training load; the link does not add a second load. Both fact IDs remain in
evidence provenance.

`DailyRecommendationCompletionAssessment` is a separate immutable Coaching
conclusion for one exact V4, V5, or V6 snapshot and completion-policy version. It keeps
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
When both strength and cardio are eligible, the immutable snapshot does not
store which one Coach selected in conversation, so exact recommendation
completion requires explicit Person confirmation. A sole strength option
checks its exact A/B position; a sole cardio option checks a qualifying,
uncovered external activity against the snapshot prescription.

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

Recovery still owns physiological evidence, historical load-risk assessments,
and erasure. Training still owns active programs, sessions, and connected
activity facts. Coach makes the current conversational decision from verified
facts and cannot invent a workout, exercise, set, load, schedule, diagnosis,
or completed fact. Legacy DailyAssessment snapshots retain their historical
Recovery precedence.

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

For questions about a legacy `get_daily_assessment` recommendation, Coach
consults that snapshot's completion conclusion contextually. It uses an exact
already-known snapshot for a relevant progress question, verified owner fact,
or reused recommendation. That legacy response may additionally receive one
API-selected candidate: the latest V4 snapshot from exactly the previous
Person-local date. No candidate means no previous-completion call and no search
across older dates. Every result stays paired with the action and date from
the same snapshot; completion never enters DailyAssessment evidence or changes
the current conversational decision.

Reliable `observed` completion suppresses a duplicate completion question.
`self_reported` reflects the active append-only feedback correction and is
attributed to the user. `partially_observed` names both the confirmed criterion
and the partial, stale, unknown, or unlinked remainder. `unknown` is not treated
as non-completion and is normally omitted unless it changes the useful reply.
When an active report conflicts with automatic evidence, Coach states both
claims as uncertain without changing owner facts. A manual clarification is
asked only when its answer changes the useful next step.

The exact-date factual view remains the always-live `get_daily_projection`
read. A full current Daily Coach decision starts with
`get_daily_decision_context` or `GET /v1/daily-assessment/context`. The
versioned read composes current owner facts without materializing a legacy
recommendation. `get_daily_projection` stays factual-only and does not embed
a decision. `get_daily_assessment` remains a compatible legacy snapshot read
for exact history, completion, and feedback. These reads use the existing
`person:read` scope and are read-only. The
Person-owned IANA timezone determines the local date. Authenticated Web stores
the browser IANA timezone atomically only while that preference is unset. Coach
may correct it through the narrow `set_current_timezone` tool and dedicated
`person-timezone:write` scope only after an explicit unambiguous user statement,
then retries `get_daily_decision_context` in the same turn. Ambiguity requires one
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

Coach does not require Garmin Training Readiness or Recovery Time screenshots
for ordinary recovery or daily guidance. It uses verified current facts
and available Recovery observations. When asked for either Garmin value, Coach
reports only a verified value with its known time or says it is unavailable;
it does not infer Garmin Training Readiness from a generic readiness field or
present an activity-linked Recovery Time as current. A voluntary Garmin report
is manual conversation evidence, not a connected-device observation, and an
unsupported score is not recorded under another metric.

`confirmed_absent` means only that the current normalized delivery omitted the
field. Coach never converts absence into zero or invents a provider-side or
physiological explanation. Current-day steps with `partial_day` and `asOf` are
reported only as the intermediate count observed at that instant, never as a
final or complete day total or evidence of low activity. Aggregate
`targetDateDelivery` remains a compatibility summary; explanations use the
individual metric states so an HRV-only delivery cannot imply complete sleep,
steps, or Body Battery data.

The provider-neutral `syncState` still describes whether a connected-data
attempt is fresh, stale, failed, absent, or unavailable. It explains
availability; Coach evaluates its relevance to a current decision. The read
is local and does not depend on provider
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
sentences. A meaningful nutrition,
training, recovery, or factual daily-summary interaction includes one useful
evidence-grounded interpretation and concrete next step unless the user
explicitly asks for raw facts only. A reply that only acknowledges or summarizes
captured facts is incomplete. When a specific domain recommendation cannot be
made safely, the Coach still ends with the safest useful next action supported
by verified facts or asks for the single observation needed to make the next
recommendation useful. For a full Daily Coach answer, Coach decides from the
current `DailyDecisionContext` and explains important uncertainty. The
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

Coach may pass an accepted exact exercise name and only characteristics already
known from the conversation instead of asking the user for catalog identifiers.
The Training command reuses one exact accessible current version or creates a
Person-private definition in the same transaction as program activation. It
never chooses a merely similar exercise or publishes a new user name to the
shared catalog. A typed multiple match leaves the whole program unsaved; Coach
asks one short human question using safe candidate differences, retains the
complete proposal, and retries with the selected internal reference without
making the user repeat the program or confirm every other exercise.

The confirmation is contextual rather than phrase-based. A complete program
provided by the user with an unambiguous request to use it is immediately
authorized. For a Coach proposal, a natural short acceptance refers only to the
latest complete version offered for activation. Praise, questions, doubt,
alternatives, partial edits, unrelated affirmative replies, or replies after a
newer version do not authorize persistence. Coach asks one short save-as-active
question when the reference is ambiguous and never requires the user to repeat
an already complete program.

The proposal stays `Proposed now` until the save and same-turn composed read
agree on the complete active snapshot. A stale read that already matches proves
the accepted version is active. A different active version is not overwritten
automatically; Coach keeps the accepted snapshot available and asks whether to
replace the current program. Failed or inconsistent verification never permits
an active, agreed, or current-plan claim.

The same natural acceptance applies when the complete proposal adds a typed
rolling cadence to an already active legacy program. The user does not restate
the program, identify versions, or confirm each exercise. After verifying that
the active name, note, workouts, exercise versions, order, loads, RIR, and
progression still match the accepted proposal, Coach sends only the accepted
cadence with the exact active authority. Training clones and activates the
immutable successor atomically. Coach then rereads Training context and Daily
Assessment in the same turn; only those results may establish the active
cadence and today's concrete action. Ambiguous acceptance, a partial edit, a
stale active version, or failed verification cannot be converted into a write
or a prompt-inferred A/B decision.

The same Training context also returns a separate bounded list of current
connected activity summaries. Coach treats an imported run, ride, or other
activity as completed evidence without asking the user to resend a screenshot
or manual reminder. A connected summary is not a detailed `WorkoutSession`:
Coach does not invent exercises or sets, does not automatically persist it as a
session, and does not double-count a plausible match between the two collections
without sufficient identity evidence. Internal integration identities,
credentials, checksums, and raw provider payloads are not exposed through MCP.

For a supplied Person-local date, the Training context returns the
authoritative `NextTrainingStep` options for the active typed cadence. Coach never
derives A/B order from activity names, program notes, chat history, or an
unlinked summary. When the user has already directly and unambiguously named
the exact displayed activity and workout, Coach uses that authority without a
duplicate question. Otherwise it asks exactly the one short API-returned
classification question and never infers the answer from expected sequence,
activity name, program note, time, or exercise similarity.

Coach persists the answer through the narrow Training classification command;
the imported summary remains distinct from `WorkoutSession` and gains no
invented exercises or sets. After `created`, `corrected`, or `unchanged`, Coach
reads Training context and then Daily Decision Context in the same turn. Coach
chooses from the verified options using the user's intent and current Recovery
evidence. A stale or
no-longer-pending result requires fresh Training context and permits at most
its new single question. Coach adds no training after `complete_today` or
`week_complete`. Explicit illness or injury concern is supplied as a current
fact for Coach to weigh. Unfilled weekly cardio is not an immediate obligation.
Legacy programs without typed cadence keep the explicit schedule-unavailable
limitation. Historical v1-v3 snapshots remain readable while current
evaluation emits `training-next-step-v4`. See the
[safe training options ADR](../../adr/20260928-let-coach-choose-safe-training-options.md).

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
- TASK-0122 accepted contextual exact-snapshot completion lookup, bounded
  previous-day candidate selection, state-specific Coach presentation,
  symmetric conflict handling, and unchanged DailyAssessment authority.
- TASK-0130 accepted exact date-scoped classification authority, one-question
  Coach behavior, same-turn Training-context and Daily-Assessment read-back,
  new snapshot/checksum, and concrete next-workout tests.
- TASK-0135 accepted exact-session progression, current Recovery gating,
  read-only Coach delivery, and independent quality review.
- TASK-0137 accepted ordinary next-strength progression routing with explicit
  skip conditions and unchanged Daily Assessment authority.
- TASK-0145 accepted confirmation-gated weight activation with fresh Recovery,
  Training, version, audit, and idempotency checks.

## Decisions

- [Coaching ADR](../../adr/20260731-model-immutable-coaching-recommendations-and-separate-user-decisions.md).
- [Daily Coach over existing MCP tools](../../adr/20260827-orchestrate-daily-coach-over-existing-mcp-tools.md).
- [Capture-first Coach and DayClosure removal](../../adr/20260829-remove-day-closure-and-use-capture-first-coach.md).
- [Unquantified Meal amount and natural Coach language](../../adr/20260830-model-unquantified-meal-amount-evidence-and-natural-coach-language.md).
- [Per-result proactive Coach policy](../../adr/20260902-deliver-coach-reply-policy-in-every-relevant-mcp-result.md).
- [MCP active-program absence](../../adr/20260828-represent-active-training-program-absence-explicitly-in-mcp.md).
- [Confirmed TrainingProgram MCP command](../../adr/20260912-persist-confirmed-training-programs-through-one-mcp-command.md).
- [Natural TrainingProgram acceptance](../../adr/20260922-bind-natural-training-program-acceptance-to-latest-complete-proposal.md).
- [Atomic accepted-cadence materialization](../../adr/20260923-materialize-confirmed-training-program-cadence-atomically.md).
- [Imported activity classification](../../adr/20260923-classify-imported-strength-activity-against-training-program.md).
- [Proof-based session/activity links](../../adr/20260925-link-proven-workout-sessions-to-external-activities.md).
- [Session-backed progression](../../adr/20260925-explain-session-backed-training-progression.md).
- [Ordinary next-strength progression routing](../../adr/20260927-invoke-progression-in-ordinary-next-strength-coaching.md).
- [Confirmed working-weight change](../../adr/20260929-confirm-working-weight-increase-atomically.md).
- [Connected activity summaries in Training context](../../adr/20260913-expose-connected-activity-summaries-in-training-context.md).
- [API-owned daily assessment and next action](../../adr/20260914-own-daily-assessment-and-next-action-in-api.md).
- [Stable MCP read delivery for existing conversations](../../adr/20260915-deliver-daily-assessment-through-stable-mcp-reads.md).
- [Hybrid personal baselines for daily assessment](../../adr/20260915-use-hybrid-personal-baselines-for-daily-assessment.md).
- [Counterfactual v1 replay with explicit ambiguity](../../adr/20260915-replay-daily-assessment-v1-with-explicit-ambiguity.md).
- [Balanced personal-baseline activation in daily assessment v2](../../adr/20260917-activate-balanced-personal-baselines-in-daily-assessment-v2.md).
- [Automatic day context and optional daily movement](../../adr/20260917-automate-day-context-and-use-optional-daily-movement.md).
- [Connected Recovery freshness for Coach](../../adr/20260918-expose-connected-recovery-freshness-to-coach.md).
- [Garmin screenshots are not required for Coach recovery](../../adr/20260924-do-not-require-garmin-screenshots-for-coach-recovery.md).
- [Consent-scoped Recovery delivery evidence](../../adr/20260919-bind-recovery-delivery-to-consent-generation.md).
- [Typed feedback for daily recommendations](../../adr/20260918-record-typed-daily-recommendation-feedback.md).
- [Domain-fact completion for daily recommendations](../../adr/20260921-determine-daily-recommendation-completion-from-domain-facts.md).
- [Contextual completion in the ordinary Coach flow](../../adr/20260921-use-recommendation-completion-in-ordinary-coach-flow.md).

## Open questions

- Measured post-deployment V4 stability, broader atomic action authoring,
  future evidence-based calibration, difficulty/exercise replacement, future
  daily policy versions, and explicit owning-domain execution linkage.

## Related material

- [Recovery](recovery-and-readiness.md)
- [Training](training-and-performance.md)
- [Domain invariants](invariants.md)
