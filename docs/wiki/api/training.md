---
id: "architecture-api-training"
kind: architecture
title: "Training API"
status: draft
tags:
  - "api"
  - "training"
  - "versioning"
---

# Training API

## Summary

Provides shared versioned exercises, Person-owned immutable program versions
with optional typed cadence, immutable sessions/sets, deterministic next-step
projection, explicit imported-activity classification, title trust for
automatic activity matching, Person-confirmed Garmin recording context,
personal records, progression candidates, and confirmed working-weight changes.

## Content

Exercise catalog:

- `POST /v1/training/catalog/exercises` and `/:id/versions`;
- `GET /v1/training/catalog/exercises/:id`;
- `PUT /v1/training/catalog/exercises/:id/overlay`.

Programs:

- `POST /v1/training/programs`, `GET /:id`, `GET /active`;
- `POST /v1/training/programs/:id/versions`;
- `POST /v1/training/programs/:id/versions/:versionId/activate`;
- `GET /v1/training/programs/:id/versions/:versionId/external-titles`;
- `PUT /v1/training/programs/external-title-trust`.

The HTTP `GET /active` endpoint returns `404` when no active program exists.
The MCP `get_active_training_program` adapter preserves that domain distinction
without changing HTTP semantics: it returns `status: active` with the program
or `status: absent` with `program: null`. Other failures remain tool errors.

The MCP `get_training_context_v2` read composes the active program with separate
bounded lists of recent current `WorkoutSession` facts and connected
`ExternalActivitySummary` facts. When a Person-local date is supplied it also
returns a Training-owned `NextTrainingStep`. An active program is the only planned
authority. When it is absent, history, other available evidence and direct user
intent can support a clearly labelled proposal, including with no history; they
do not establish a stored active plan. Connected activity summaries expose
only safe typed occurrence, duration, distance, load, heart-rate, device, and
normalized Garmin-attribution fields; provider identities, connection or
consent identifiers, checksums, credentials, and raw payloads stay internal.
It also exposes Person-confirmed external titles for the exact active program
version, separately from the immutable workout snapshot.

New immutable versions may carry a closed `rolling_weekly` cadence: strength
frequency targets, an ordered cycle of program-workout positions, and an
optional light-cardio target with duration, average-heart-rate range, and
warmup/work/cooldown phases. Cadence has no weekdays. Existing versions without
it remain readable and return `schedule_unavailable`; the API never parses
`note` as policy. Progression-created successor versions preserve cadence.

Current `NextTrainingStep` emits `training-next-step-v5`. Its `training_options`
contains the exact next strength workout and the programmed light-cardio
option. `recentProgress` counts completed occurrences from the requested
Person-local date minus six days through that date, inclusive, and declares
`targetMeaning: guidance`. Targets do not hide options or create a debt or
`week_complete`. `lastStrengthLocalDate` retains the compatible sequence anchor
even outside the window; `lastCardioLocalDate` identifies the last qualifying
cardio inside the window. Coach chooses strength, cardio, or rest using current
Recovery, recent load, user intent, and the actual training gap. Alternation is
a contextual preference. A request to explain the choice does not itself
reverse it.

`complete_today`, `needs_classification`, and explicit absence/unavailable
states remain. Missed days do not skip A/B. Earlier versions of the same
program contribute to frequency; an A/B anchor is usable only when cadence
and ordered exercise identities remain compatible. Events are ordered by
Person-local date before instant so mixed date-only and timed records near
midnight retain the correct sequence. An unclassified substantial strength
activity in the window triggers one exact classification question independent
of the recent-history display limit. Explicit repeats or reordering reanchor
the sequence. Qualifying external cardio counts without a fabricated detailed
session; imported strength without A/B identity never advances the sequence.
Linked summaries and sessions count once.

Historical v1-v4 snapshots remain readable with their original calendar-week
meaning. The [rolling guidance ADR](../../adr/20261004-use-rolling-training-frequency-as-coach-guidance.md)
defines the current window and Coach choice boundary.

The narrow MCP `classify_external_activity` command uses the existing
`workout:write` scope and stores explicit user authority as a Training-owned
append-only classification. It binds the exact current external activity,
requested local date, active program/version/lock, current classification
expectation, and either one `program_workout` position or
`not_program_workout`. `expectedLocalDate` is `nextStep.localDate` from the
context that displayed the pending question, not the historical activity date
mentioned in the question. Subsequent reads retain that original context date.
Under the Person lock, an initial write recomputes the
same date-scoped `needs_classification` policy and succeeds only when the exact
activity is still pending. Identical retries are `unchanged`; corrections
append a successor; stale or no-longer-pending authority writes nothing.

The current safe external-activity projection includes its classification but
not provider internals. The classification follows the stable activity
correction lineage when a provider successor becomes current and is removed
with connected-data erasure. A linked `WorkoutSession` takes
precedence and prevents both a new classification and double counting. A
classified external activity may advance cadence, but never supplies performed
exercises, sets, loads, personal records, or progression evidence.
`not_program_workout` prevents the same question from recurring for that
program version and contributes no cadence occurrence.

`WorkoutSession` remains the detailed authority for performed exercises and
sets. An external activity summary can prove that a run, ride, or other activity
occurred, but it never creates exercises, repetitions, weight, or RIR. Coach
uses an imported summary without asking the user to repeat it or provide a
screenshot and does not count a plausible cross-source match as two workouts
without sufficient evidence.

A `WorkoutSession` may pin the exact workout position in its immutable program
version. Its `externalActivityId` exposes the current external correlation from
a separate Person-scoped association. Training creates an automatic association
for exact shared source identity, or for a previously confirmed external title
of that exact program workout with compatible type, date, close start, and a
unique candidate pair. A confirmed Person-wide generic Garmin strength mode
can also link a detailed strength session when the exact local date, start
window, type, and reciprocal uniqueness agree; it does not assign A/B from
the imported title. For a completed manual report with unknown start,
`reported_strength_day` / `automatic-activity-link-v4` also permits a unique
pair across the full current local-date population, including occupied records.
The report needs performed strength evidence or an exact immutable strength
program workout; the Garmin activity needs the confirmed mode, no distance,
and at least 600 seconds. Known timestamp conflicts remain blocking. Provider
time stays in the activity without upgrading manual temporal precision.
`venueLabel` is optional session context for a concrete
question, not matching evidence. Arbitrary matching names are insufficient.
The MCP
`set_trusted_external_activity_title` command confirms, replaces, or revokes
one title under `workout:write`; it does not classify an individual activity.
`set_activity_recording_mode` confirms or revokes the generic mode under an
optimistic lock. `get_training_context` returns a date-scoped
`pendingActivityLinkQuestion` when multiple current pairs remain plausible or
a date-only report lacks sufficient automatic matching evidence. If today's next step
is blocked by a historical activity, its exact pair is also exposed in today's
context using the activity's date and the current policy-week bound;
it uses the exact immutable program version even for historical sessions and
does not depend on the bounded display history. A direct Person answer to
that question authorizes `confirm_workout_activity_link` for the exact pair.
Coach resolves that pair before a separate A/B classification question for the
same activity, then rereads the original requested date.
Title trust is scoped to one program version. Late imports and corrections
recheck automatic associations; explicit links retain priority. Deleting
connected evidence removes its association without mutating the immutable
session.
See the
[natural-report association ADR](../../adr/20261007-match-natural-workout-reports-with-provider-evidence.md).

After the user confirms a complete program or an unambiguous targeted change, MCP
`save_confirmed_training_program` atomically creates and activates its first
version or appends and activates a new immutable version. The command uses the
previously read active program id and lock version, rejects stale expectations,
and returns an idempotent no-op when the active snapshot already matches. The complete canonical transaction result verifies the save; an optional
read failure does not undo success. No history, numeric RIR, Recovery gate,
fixed increment, percentage cap or next-workout eligibility applies to this command.
Coach chooses changes from relevant evidence and existing consent.
The existing HTTP draft/version/activation lifecycle is unchanged.

Each confirmed prescription may pin an existing `ExerciseVersion` or provide a
strict inline descriptor with the accepted exercise name and only known
nullable characteristics. Inside the same Person-locked transaction, the
command exact-matches accessible current versions and enabled aliases after
Unicode, whitespace, and case normalization. Every supplied characteristic
must also match; fuzzy substitution is forbidden. No match creates a
Person-private `Exercise` and version 1. Multiple matches return typed
`needs_clarification` with no catalog or program writes. Shared catalog creation
is not available through this command. Repeated descriptors and concurrent
retries resolve to one private identity and retain the existing semantic
program no-op.

A complete program supplied by the user together with an unambiguous request to
use it is already confirmed. For a complete Coach proposal, ordinary natural
acceptance applies only to the latest fully published version offered for
activation; it does not require a special phrase. Questions, doubt,
alternatives, ambiguous partial edits, unrelated positive replies, and acceptance
after a newer version are not confirmation of that proposal. Explicit uniquely
targeted changes to a current prescription follow the substitution rule below.
Coach publishes a revised proposal and asks one short save-as-active question
when the reference is ambiguous.

A successful canonical save verifies the accepted program. On a stale conflict,
read current authority and preserve unrelated concurrent changes. Retry the same
accepted change within existing consent; materially different scope needs fresh
consent. Unknown write outcomes require verification before an exact retry.

When an accepted complete cadence belongs to an already active legacy version
whose other contents match, the narrow MCP cadence mutation avoids resending
the full program. It binds the expected program id, active version id, and lock
version, then takes the existing Person lock and copies the active version in
one transaction. The backend preserves name, note, workout order, exact
exercise versions, prescriptions, loads, RIR, and progression; only the
accepted typed cadence changes. The immutable successor becomes current and
active atomically. The old version remains unchanged, an identical cadence is
a semantic no-op, and a stale expectation or invalid workout reference writes
nothing. The canonical transaction result verifies the cadence write. Further context
reads are optional and selected for the request; prose in `note` is never
used as schedule authority.

Successful classification results verify that fact. Coach refreshes relevant
context when useful; classification or linking does not block unrelated advice.
`complete_today`, `week_complete`, next A/B and frequency are projections, not
permission gates on Coach recommendations or accepted program changes.
The MCP implementation exists in the repository, but publication or refresh
of a deployed action catalog and its canary remain separate operational gates.

New programs/versions are inactive. Activation uses `expectedLockVersion`; one
Person cannot have two active programs.

Sessions:

- Legacy `/v1/training/sessions` create/list/detail/correction/history keeps
  the original completed, resolved-exercise contract.
- `/v2/training/sessions` exposes the same operations for reported incomplete
  facts; `/v2/training/personal-records` preserves day-only record precision.
- MCP V2 record/correct/list/context tools use existing scopes and are preferred
  when available. Legacy reads return explicit incompatibility for facts they
  cannot represent instead of hiding facts or fabricating values.

V2 writes require explicit `completionState`, allow empty exercises or sets,
nullable exercise identity/load basis, partial measured sets, and day-only
occurrence with no invented instant. Supplied identities must be Person-accessible
and match the reported name. A wholly empty set is invalid. Corrections replace
the full snapshot append-only and preserve unrelated reported facts. Only
completed sessions contribute to cadence, progression, records, automatic
activity matching, Recovery session counts, and completed training assessments.
Exercise-specific analytics additionally require resolved identity and enough
measured evidence. V1 personal records reject day-only results rather than
inventing time; V2 returns the recorded local date and temporal precision.

MCP Coach guidance treats a gym arrival or program request as planning,
reported sets as partial performance, and an unambiguous retrospective program
workout report as completed even when start and sets are unknown. It requires
neither a special start phrase nor invented performed prescriptions. Empty
exercises preserve unknown measurements; provider evidence can later link the
completed report. This guidance does not replace live conversational evaluation.

The MCP V2 create/correction input publication exposes common workout fields
and all set measurements as object properties. The API still validates the
original temporal and measured-set conditions after normalization. For an
explicit immediate start report, MCP create accepts `startReportedNow=true`
with `in_progress`; empty exercises are valid. It captures approximate server
receipt time in the supplied Person timezone and records manual command
provenance (`mcp_start_report:v1`, original create dedupe key). This is neither
the original chat message timestamp nor provider-measured time. Retries retain
the first canonical start. Coach copies the current start, temporal precision,
timezone and full source reference into completion or set corrections; the
server retains the existing full-replacement contract. A finish-only report
with unknown start remains day-only and may use the association policy above.
See the [reported-start capture ADR](../../adr/20261007-capture-reported-workout-start-time.md).

A Smith report records Smith as performed. The Coach may ask whether it is a
one-off substitution or should change the program. A clear targeted request or
acceptance authorizes the existing atomic program write; untouched assignments
and cadence are copied from the active snapshot without another full-program
confirmation. Old sessions stay immutable and different mechanisms do not
silently share weights or progression rules. Substitution alone does not
change the program.

Compatibility projections:

- `GET /v1/training/personal-records`;
- `GET /v1/training/progression-candidates`;
- `POST /v1/training/programs/:id/progression-candidates/accept`.

Records choose maximum weight, then repetitions. Candidate calculation never
mutates a program. Weight candidacy uses current completed detailed sessions for the exact active
version/workout position. The ordinary path requires the two latest sessions
at the assigned external weight, upper repetition target, and adequate RIR.
`single_session_high_reserve` instead uses only the latest session when every
prescribed set reaches the upper repetition target at the assigned weight and
RIR is at least `max(3, targetRir + 2)`; the target RIR must be explicit. A missing or excessive program increment, incomplete evidence,
future session, or ambiguous duplicate prescription yields no candidate.
Acceptance rechecks current evidence, creates a new inactive version, and
blocks duplicate pending acceptance.

The three legacy progression/proposal/apply tools are hidden from new MCP
discovery but retain authorized direct dispatch and historical audit/replay.
New Coach changes use the universal confirmed program save.

Compatibility-only MCP `get_training_progression` action composes the exact next
strength workout with the current API-owned Daily Assessment. It returns a
typed `hold`, `add_reps`, `add_weight`, or `insufficient_evidence` decision per
exercise, the target, up to two current detailed sessions' actual weights,
repetitions and RIR, and a reason. When Recovery is not ready, the active
program or next step changed, or the timezone is missing, it returns an
explicit unavailable state. Guidance never saves or activates a program;
Its dated result does not prove future readiness.

The MCP `get_working_weight_proposals` read exposes exact current-day increases
only when the API-owned Recovery assessment is ready and the next strength
position, the exact one- or two-session evidence, and active program agree. After one
clear Person confirmation, compatibility-only `apply_confirmed_working_weight` rechecks Recovery,
the current local date, evidence revision, exact progression candidate, and
active program under the Person lock. It copies one immutable program version,
changes only the selected prescription's external working weight, activates
the successor, and records a typed audit row in one transaction. The first
evidence session is mandatory; the second is NULL for the high-reserve path.
The command recomputes the shared predicate and exact ordered evidence IDs
under the Person lock. Stale or
unsafe proposals fail without a write; an identical request ID can be retried
idempotently. The canonical successful result verifies this legacy transaction; further reads
are selected when useful. The existing candidate acceptance path
still creates an inactive draft. See the
[single-session audit ADR](../../adr/20261007-allow-single-session-working-weight-audit.md).

The read-only MCP `get_external_activity_details` reads locally imported FIT
details for a current Person-scoped activity. It returns session boundaries,
measured channels, laps, and bounded pages of records or time buckets. Its
cursor pins both the query and immutable details version. Provenance includes
the source activity version, file checksum, normalization version, and import
time; summary-context privacy boundaries remain unchanged.

Buckets expose time-weighted averages, measured extrema, coverage, and active
time. Each sample holds for at most ten seconds and stops at a recorded pause;
gaps remain uncovered. Zone time requires explicit analysis-supplied boundaries.
Missing HR does not suppress other measurements. Coach must read details before
claiming that only averages are available and must not divide total training
load across segments. Availability and `latestImportIssue` distinguish absence,
failed imports, unsupported FIT, and retained prior data. This implementation
has isolated MCP/PostgreSQL verification; staging delivery and a real Coach
reply remain unverified. See the
[FIT details ADR](../../adr/20261004-import-fit-activity-details-for-coach.md).

## Evidence

- Training contracts/module/repository/integration tests.
- TASK-0130 accepted contract, domain, PostgreSQL, MCP, Daily Assessment,
  migration, lineage, erasure, deduplication, and concurrency tests.

## Decisions

- [Coach knowledge-store boundary](../../adr/20261009-let-coach-propose-working-weight-from-history.md).

- [Incomplete fact capture and contextual Coach replies](../../adr/20261002-capture-incomplete-facts-and-use-contextual-coach-replies.md).

- External catalog records remain staged; no scraper/name merge. Records and
  candidates are query projections, not mutable authority.
- [Imported activity classification](../../adr/20260923-classify-imported-strength-activity-against-training-program.md).
- [Proof-based session/activity links](../../adr/20260925-link-proven-workout-sessions-to-external-activities.md).
- [Single-session high-reserve progression](../../adr/20261006-allow-single-session-high-reserve-progression.md).
- [Confirmed working-weight change](../../adr/20260929-confirm-working-weight-increase-atomically.md).

## Open questions

- Feeling vocabulary, bodyweight/counterweight progression, catalog search and
  external source.

## Related material

- [Training domain](../domain/training-and-performance.md)
- [Training ADR](../../adr/20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
- [MCP active-program absence ADR](../../adr/20260828-represent-active-training-program-absence-explicitly-in-mcp.md)
- [Confirmed TrainingProgram MCP command](../../adr/20260912-persist-confirmed-training-programs-through-one-mcp-command.md)
- [Natural TrainingProgram acceptance](../../adr/20260922-bind-natural-training-program-acceptance-to-latest-complete-proposal.md)
- [Atomic exercise resolution during confirmed save](../../adr/20260922-resolve-training-program-exercises-atomically.md)
- [Connected activity summaries in Training context](../../adr/20260913-expose-connected-activity-summaries-in-training-context.md)
- [Rolling cadence and Training-owned next step](../../adr/20260922-own-rolling-training-cadence-and-next-step-in-training.md)
- [Atomic accepted-cadence materialization](../../adr/20260923-materialize-confirmed-training-program-cadence-atomically.md)
