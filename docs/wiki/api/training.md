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

Provides shared versioned exercises, Person-owned program versions, immutable
sessions/sets, personal records, and progression candidates.

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
`ExternalActivitySummary` facts. An active program is the only planned
authority. When it is absent, both collections remain completed evidence that
may support a proposal but are not a plan. Connected activity summaries expose
only safe typed occurrence, duration, distance, load, heart-rate, device, and
normalized Garmin-attribution fields; provider identities, connection or
consent identifiers, checksums, credentials, and raw payloads stay internal.

`WorkoutSession` remains the detailed authority for performed exercises and
sets. An external activity summary can prove that a run, ride, or other activity
occurred, but it never creates exercises, repetitions, weight, or RIR. Coach
uses an imported summary without asking the user to repeat it or provide a
screenshot and does not count a plausible cross-source match as two workouts
without sufficient evidence.

After the user explicitly confirms a complete program snapshot, MCP
`save_confirmed_training_program` atomically creates and activates its first
version or appends and activates a new immutable version. The command uses the
previously read active program id and lock version, rejects stale expectations,
and returns an idempotent no-op when the active snapshot already matches. Coach
must read the active program back before claiming that the change is saved.
The existing HTTP draft/version/activation lifecycle is unchanged.

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
- [Connected activity summaries in Training context](../../adr/20260913-expose-connected-activity-summaries-in-training-context.md)
