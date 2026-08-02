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
performed workouts, and derived results. A program is not proof of execution,
and recommendation acceptance never mutates it automatically.

## Content

- `Exercise` has stable identity and immutable ExerciseVersions; aliases and
  equipment are overlays; private exercises have an owner.
- `TrainingProgram` belongs to Person and contains immutable versions with
  ordered workouts/assignments pinned to ExerciseVersion and target load,
  sets, repetitions, and RIR. At most one version is active.
- Immutable `WorkoutSession` contains performed exercises and individual sets
  with actual weight/repetitions/RIR. Correction replaces the full session.
- `PersonalRecord` is a projection over current sets: highest weight, then more
  repetitions on ties.
- Progression candidates are projections. Acceptance creates a new inactive
  program version; explicit activation is separate.

## Evidence

- Training schema, API, and integration tests.

## Decisions

- [Training ADR](../../adr/20260731-model-versioned-training-programs-and-immutable-workout-sessions.md).

## Open questions

- Production progression policy, richer exercise substitutions, and external
  catalog source/moderation.

## Related material

- [Training API](../api/training.md)
- [Coaching](coaching-and-decision-support.md)
- [Recovery](recovery-and-readiness.md)
