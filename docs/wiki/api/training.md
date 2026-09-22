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
projection, personal records, and progression candidates.

## Content

Exercise catalog:

- `POST /v1/training/catalog/exercises` and `/:id/versions`;
- `GET /v1/training/catalog/exercises/:id`;
- `PUT /v1/training/catalog/exercises/:id/overlay`.

Programs:

- `POST /v1/training/programs`, `GET /:id`, `GET /active`;
- `POST /v1/training/programs/:id/versions`;
- `POST /v1/training/programs/:id/versions/:versionId/activate`.

The HTTP `GET /active` endpoint returns `404` when no active program exists.
The MCP `get_active_training_program` adapter preserves that domain distinction
without changing HTTP semantics: it returns `status: active` with the program
or `status: absent` with `program: null`. Other failures remain tool errors.

The MCP `get_training_context` read composes the active program with separate
bounded lists of recent current `WorkoutSession` facts and connected
`ExternalActivitySummary` facts. When a Person-local date is supplied it also
returns a Training-owned `NextTrainingStep`. An active program is the only planned
authority. When it is absent, both collections remain completed evidence that
may support a proposal but are not a plan. Connected activity summaries expose
only safe typed occurrence, duration, distance, load, heart-rate, device, and
normalized Garmin-attribution fields; provider identities, connection or
consent identifiers, checksums, credentials, and raw payloads stay internal.

New immutable versions may carry a closed `rolling_weekly` cadence: strength
sessions per local week, an ordered cycle of program-workout positions, and an
optional light-cardio target with duration, average-heart-rate range, and
warmup/work/cooldown phases. Cadence has no weekdays. Existing versions without
it remain readable and return `schedule_unavailable`; the API never parses
`note` as policy. Progression-created successor versions preserve cadence.

`NextTrainingStep` returns an exact strength workout, typed light cardio,
`complete_today`, `week_complete`, `needs_classification`, or an explicit
absence/unavailable state. Sequence advances only from classified current
sessions, so missed days do not skip workouts. Explicit repeats or reordering
anchor the next step and expose a deviation reason. A distance, duration, and
heart-rate-qualified external cardio activity may satisfy cardio without a
fabricated detailed session. An external activity without A/B identity never
advances the strength sequence and may trigger one short classification
question.

`WorkoutSession` remains the detailed authority for performed exercises and
sets. An external activity summary can prove that a run, ride, or other activity
occurred, but it never creates exercises, repetitions, weight, or RIR. Coach
uses an imported summary without asking the user to repeat it or provide a
screenshot and does not count a plausible cross-source match as two workouts
without sufficient evidence.

A `WorkoutSession` may pin the exact workout position in its immutable program
version. It may also expose an exact external-activity correlation through a
separate Person-scoped relational association. Only this explicit association
deduplicates detailed and connected evidence. Deleting connected evidence
removes the association without mutating the immutable session.

After the user explicitly confirms a complete program snapshot, MCP
`save_confirmed_training_program` atomically creates and activates its first
version or appends and activates a new immutable version. The command uses the
previously read active program id and lock version, rejects stale expectations,
and returns an idempotent no-op when the active snapshot already matches. Coach
must read the active program back before claiming that the change is saved.
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
alternatives, partial edits, unrelated positive replies, and acceptance after a
newer version are not confirmation. Coach publishes a complete revised snapshot
after an edit and asks one short save-as-active question when the reference is
ambiguous.

Until the atomic write and complete `get_training_context` read-back agree, the
program remains `Proposed now` and cannot be described as active, agreed, or the
current plan. A stale conflict triggers a fresh read. An already matching active
snapshot verifies success; a different active version is never overwritten
automatically and requires a short replacement confirmation without making the
user repeat the program.

New programs/versions are inactive. Activation uses `expectedLockVersion`; one
Person cannot have two active programs.

Sessions:

- `POST /v1/training/sessions`, current list, `GET /:id`;
- `POST /v1/training/sessions/:id/corrections` and `GET /:id/history`.

Sessions snapshot exercise version/name and each set's actual weight,
repetitions, and RIR. Correction replaces the entire session.

Projections:

- `GET /v1/training/personal-records`;
- `GET /v1/training/progression-candidates`;
- `POST /v1/training/programs/:id/progression-candidates/accept`.

Records choose maximum weight, then repetitions. Candidate calculation never
mutates a program; acceptance creates a new inactive version and blocks duplicate
pending acceptance.

## Evidence

- Training contracts/module/repository/integration tests.

## Decisions

- External catalog records remain staged; no scraper/name merge. Records and
  candidates are query projections, not mutable authority.

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
