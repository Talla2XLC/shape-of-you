---
id: "domain-training-and-performance"
kind: domain
title: "Training and Performance"
status: draft
tags:
  - "domain"
  - "training"
---

# Training and Performance

## Summary

Training separates shared exercise definitions, Person-owned programs,
performed workouts, external activity facts, and derived results. A program is
not proof of execution, and recommendation acceptance never mutates it
automatically.

## Content

- `Exercise` has stable identity and immutable ExerciseVersions; aliases and
  equipment are overlays; private exercises have an owner.
- Confirmed-program persistence resolves only exact accessible current
  ExerciseVersions and enabled Person aliases. A missing exact definition is
  created as Person-private version 1 in the same transaction as program
  activation; ambiguity performs no writes, and similar definitions are never
  substituted or published automatically.
- `TrainingProgram` belongs to Person and contains immutable versions with
  ordered workouts/assignments pinned to ExerciseVersion and target load,
  sets, repetitions, and RIR. A version may also own a closed typed
  `rolling_weekly` cadence with an ordered workout-position cycle, weekly
  strength target, and optional typed light-cardio target. At most one version
  is active; legacy versions without cadence remain valid and are never inferred
  from free text.
- Immutable `WorkoutSession` contains performed exercises and individual sets
  with actual weight/repetitions/RIR. It may pin the exact program-workout
  position. Correction replaces the full session.
- `TrainingRepository` also owns immutable connection-linked activity facts
  imported from Intervals.icu. They retain typed duration, distance, training
  load, heart-rate summary, device name, provider identity, and normalized
  checksum rather than a raw provider payload. Garmin attribution is set only
  when device metadata identifies Garmin.
- Repeated external identity plus checksum is a no-op. Changed content creates
  an immutable successor, including a later return to a previously seen value.
  Current reads expose only the latest fact.
- `ExternalActivityProgramClassification` is a separate Training-owned
  append-only fact over the stable correction lineage of one imported activity.
  It pins the exact active TrainingProgramVersion and records either one
  `program_workout` position or `not_program_workout`. An identical retry is a
  semantic no-op; a changed answer appends a successor rather than overwriting
  user authority.
- Initial classification uses the expected Person-local date and recomputes the
  same exact `needs_classification` projection under the Person lock. It writes
  only when the expected current activity is still the date-scoped pending
  target for the expected active program/version/lock. Stale authority, a
  different pending activity, a future or old-week activity, or a newly created
  session fails closed without a partial write.
- A separate Person-scoped association identifies one external activity as
  evidence for a detailed WorkoutSession. Training creates it for an explicit
  link, exact shared source identity, or a previously confirmed external title
  for the session's exact program version/workout position. A Person-confirmed
  generic Garmin strength recording mode can also link a detailed session,
  including one outside the active program, when type, exact date, close start,
  and reciprocal uniqueness agree. The generic title never identifies A/B.
  Nearby times or venue alone do not authorize a link. Title trust and the
  recording mode are revocable Person-owned authority, never an implicit
  program edit or activity classification. Training asks about the exact pair
  when evidence is ambiguous; a direct answer creates an explicit association.
  Current corrections and late imports recheck automatic links. One linked
  pair counts as one training occurrence; external load remains external,
  while performed sets remain in the session. A linked session takes
  precedence over external classification.
  Provider correction retains classification through the stable lineage;
  connected-data erasure removes association and classification without
  mutating the session. See the
  [recording-context ADR](../../adr/20260925-link-garmin-strength-with-recording-context.md).
- `NextTrainingStep` is a deterministic read projection over the active cadence
  and current Training facts. Missed days do not move its sequence; explicit
  repeats or reordering become the next anchor. Qualified external cardio may
  satisfy cardio from typed duration, distance, and heart-rate facts. External
  strength without an exact program-workout identity cannot advance A/B and
  produces a bounded classification need instead of a guess. Legacy cadence,
  missing local date, current-day completion, and completed weekly targets are
  explicit states. Current projections emit `training-next-step-v2`; historical
  Daily Assessment snapshots containing v1 remain readable. A classified
  external strength activity can advance only cadence and never becomes
  exercise, set, load, personal-record, or progression evidence.
- Profile coverage unions current WorkoutSession and external activity dates.
  One Person-local date is counted once regardless of source, and a date without
  a workout is not described as a missed training day.
- The live personal-baseline reader exposes current Person-owned training-load
  history, current session counts, and external activity counts without
  zero-filling missing dates. Internal WorkoutSessions and connection-backed
  activity facts remain distinct evidence streams. External load carries a
  provider-neutral typed `loadBasis` and `loadBasisVersion`; personal comparison
  is available only when every selected fact has the exact same pair and the
  history spans the required calendar interval. Missing or incompatible
  semantics make the comparison unavailable while absolute safeguards remain.
  No domain rule branches on provider identity. Coaching does not guess the
  historical active TrainingProgram; it evaluates `program_absent` and
  `program_present` branches. The branch sentinel is process-local and never
  becomes a domain fact or identifier.
- `PersonalRecord` is a projection over current sets: highest weight, then more
  repetitions on ties.
- Progression candidates are projections. Acceptance creates a new inactive
  program version; explicit activation is separate.

## Evidence

- Training schema, API, and integration tests.

## Decisions

- [Training ADR](../../adr/20260731-model-versioned-training-programs-and-immutable-workout-sessions.md).
- [Garmin through Intervals.icu](../../adr/20260907-connect-garmin-through-intervals-icu.md).
- [Provider-neutral profile data coverage](../../adr/20260913-show-provider-neutral-profile-data-coverage.md).
- [Hybrid personal baselines for daily assessment](../../adr/20260915-use-hybrid-personal-baselines-for-daily-assessment.md).
- [Counterfactual v1 replay with explicit ambiguity](../../adr/20260915-replay-daily-assessment-v1-with-explicit-ambiguity.md).
- [Balanced personal-baseline activation in daily assessment v2](../../adr/20260917-activate-balanced-personal-baselines-in-daily-assessment-v2.md).
- [Atomic exercise resolution during confirmed program save](../../adr/20260922-resolve-training-program-exercises-atomically.md).
- [Rolling cadence and Training-owned next step](../../adr/20260922-own-rolling-training-cadence-and-next-step-in-training.md).
- [Imported activity classification](../../adr/20260923-classify-imported-strength-activity-against-training-program.md).
- [Proof-based session/activity links](../../adr/20260925-link-proven-workout-sessions-to-external-activities.md).

## Open questions

- Production progression policy, richer exercise substitutions, external
  catalog source/moderation, and live Intervals.icu activity-contract
  validation.

## Related material

- [Training API](../api/training.md)
- [Coaching](coaching-and-decision-support.md)
- [Recovery](recovery-and-readiness.md)
