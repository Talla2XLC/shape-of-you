---
id: "decisions-20260731-model-versioned-training-programs-and-immutable-workout-sessions"
kind: adr
title: "Model versioned training programs and immutable workout sessions"
status: accepted
date: 2026-07-31
supersedes: []
superseded_by: null
tags:
  - "catalog"
  - "projections"
  - "training"
  - "versioning"
---

# Model versioned training programs and immutable workout sessions

## Context

`Training` stores performed work grouped by `Session_ID`. `Program` mixes
prescribed parameters with computed last-workout and next-progression fields.
`Personal Records` contains a derived best result per exercise.

Direct migration would make a mutable program own history, allow computed
recommendations to change prescriptions silently, and duplicate exercises per
Person. A generic event/rules engine would instead hide typed constraints too
early.

## Decision

Keep Training and Performance as a typed module and separate reference data,
plans, performed facts, and projections:

1. `Exercise` is stable identity; `ExerciseVersion` is immutable content.
   Shared definitions are reused. Personal names/equipment are overlays;
   private exercises have an owner and are not published automatically.
2. `TrainingProgram` belongs to Person and contains immutable
   `TrainingProgramVersion`. Versions define ordered workouts and assignments
   pinned to exact ExerciseVersions with target weight, sets, reps, and RIR.
   A Person has at most one explicitly active version.
3. Last performance, automatic decision, and suggested next load are
   projections, not program-version content.
4. Immutable Person-owned `WorkoutSession` contains `PerformedExercise` with a
   name/version snapshot and separate `PerformedSet` facts for actual weight,
   reps, and RIR. Notes and feeling belong to performance, not the catalog.
5. Correction replaces the full WorkoutSession with `supersedes_id`; in-place
   set edits are forbidden.
6. `PersonalRecord` is a query projection: maximum performed weight, then more
   repetitions on ties, with links to the source session and set. It is not an
   authority table.
7. A progression candidate is computed separately. Explicit acceptance creates
   a new TrainingProgramVersion; rejection or no action changes nothing.
8. External catalogs use source-neutral records with identity, checksum, parser
   version, and review state. Provider, scraper, scheduler, and name merge are
   outside this decision.

Program versions and workout facts pin exact exercise versions, so later
catalog corrections never rewrite history.

## Considered alternatives

- Copy mutable `Training`, `Program`, and `Personal Records` sheets: easy
  migration but preserves conflicting ownership.
- Store only the current program and aggregate log rows: fewer tables but
  cannot reproduce prescriptions or individual sets.
- Universal event store/rules engine: extensible but excessive and weakly
  typed for the modular monolith.
- Separate versioned catalog, programs, performed facts, and projections:
  preserves authority/history without another service. Selected.

## Consequences

- Multiple People reuse one exercise definition.
- Program changes create a new version and require explicit activation.
- Session correction requires a full replacement but preserves unambiguous
  history and internal constraints.
- Separate sets add detail beyond legacy rows but are required for records and
  progression.
- Records and candidates may remain query projections until load justifies
  persistence.
- Real external catalog import remains separate work without a new service.

## Verification

- Two People reference one shared ExerciseVersion without copied content.
- Private exercises/overlays require authorization.
- Concurrent activation cannot leave two active programs.
- Catalog revisions do not change existing programs or sessions.
- Correction creates a full replacement and hides the old fact from current
  queries.
- Records use only current Person sets, ordered by weight then repetitions.
- Candidate acceptance creates a new program version; calculation alone does
  not mutate the program.
- No universal polymorphic facts/rules table appears.

## Related material

- [Training and Performance](../wiki/domain/training-and-performance.md)
- [Candidate aggregates](../wiki/domain/candidate-aggregates.md)
- [Shared definitions and Person state](20260731-separate-shared-reference-definitions-from-person-owned-state.md)
- [Typed provenance and supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [Independent facts over DayRecord](20260728-prefer-independent-facts-over-broad-day-record.md)
- [Implementation plan](../../plans/2026/07/completed/2026-07-31-training-and-performance.md)
