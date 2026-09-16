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
- `TrainingProgram` belongs to Person and contains immutable versions with
  ordered workouts/assignments pinned to ExerciseVersion and target load,
  sets, repetitions, and RIR. At most one version is active.
- Immutable `WorkoutSession` contains performed exercises and individual sets
  with actual weight/repetitions/RIR. Correction replaces the full session.
- `TrainingRepository` also owns immutable connection-linked activity facts
  imported from Intervals.icu. They retain typed duration, distance, training
  load, heart-rate summary, device name, provider identity, and normalized
  checksum rather than a raw provider payload. Garmin attribution is set only
  when device metadata identifies Garmin.
- Repeated external identity plus checksum is a no-op. Changed content creates
  an immutable successor, including a later return to a previously seen value.
  Current reads expose only the latest fact.
- Profile coverage unions current WorkoutSession and external activity dates.
  One Person-local date is counted once regardless of source, and a date without
  a workout is not described as a missed training day.
- The personal-baseline shadow reader exposes current Person-owned training-load
  history, current session counts, and external activity counts without
  zero-filling missing dates. Internal WorkoutSessions and connection-backed
  activity facts remain distinct evidence streams. A connection-backed stream
  is only an opaque conservative partition: it does not prove that load basis
  or unit semantics are compatible across sources. Coaching does not guess the
  historical active TrainingProgram; it evaluates `program_absent` and
  `program_present` branches. The branch sentinel is process-local and never
  becomes a domain fact or identifier. Training load cannot influence a
  production personal-baseline decision until a typed load-basis/version
  contract establishes compatibility.
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

## Open questions

- Production progression policy, typed compatible training-load basis,
  richer exercise substitutions, external catalog source/moderation, and live
  Intervals.icu activity-contract validation.

## Related material

- [Training API](../api/training.md)
- [Coaching](coaching-and-decision-support.md)
- [Recovery](recovery-and-readiness.md)
