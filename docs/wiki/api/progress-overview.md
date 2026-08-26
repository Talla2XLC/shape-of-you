---
id: "architecture-api-progress-overview"
kind: architecture
title: "Progress overview API"
status: draft
tags:
  - "api"
  - "progress"
  - "read-model"
  - "timezones"
---

# Progress overview API

## Summary

The API exposes one bounded, sparse read model for factual progress across an
explicit Person-local date range. It coordinates existing module-owned range
reads without becoming a new fact owner or persistence boundary.

## Content

`GET /v1/progress-overview?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Area%2FCity`
accepts real inclusive calendar dates, a valid IANA timezone, and at most 366
days. Unknown query fields, reversed ranges, invalid dates, invalid timezones,
and larger ranges are rejected.

The fixed `progress-metrics-v1` set contains:

- `weight_kg`: latest current WeightMeasurement for the local date;
- `calories_kcal` and `protein_g`: sums over current Meals for the date;
- `workout_session_count`: count of current WorkoutSessions for the date;
- `readiness_score`: latest RecoveryAssessment for the date.

Metric series are sparse. A missing fact produces no point or marker. Web keeps
calendar-proportional horizontal spacing and connects the surrounding factual
points with one continuous trend line; it does not create an interpolated
value for the missing date. Numeric zero is returned only when an existing fact
or aggregate of existing facts is genuinely zero. The response also contains a
newest-first union of dates with current facts and bounded counts for Physical
State, Nutrition, Training, Recovery, and Coaching.

The application coordinator performs a constant number of module-owned range
reads; it does not loop over dates or call exact-day HTTP endpoints. Each owner
keeps Person isolation, correction, supersession, and ordering rules. The read
model has no table, cache, migration, database, credential, or deployable.

## Evidence

- Shared runtime schemas and OpenAPI route in `packages/contracts` and
  `apps/api/src/openapi.ts`.
- Coordinator, owner range ports, unit tests, PostgreSQL integration test, and
  browser E2E accepted for TASK-0043.

## Decisions

- [Progress overview authenticated default](../../adr/20260818-make-progress-overview-the-authenticated-default.md)
- [Independent facts instead of a broad DayRecord](../../adr/20260728-prefer-independent-facts-over-broad-day-record.md)

## Open questions

- Measure query plans and latency at production-like factual density before
  considering owner-local query optimization.

## Related material

- [Data ownership](../architecture/data-ownership.md)
- [Integrity and lifecycle](../data/integrity-and-lifecycle.md)
- [Candidate aggregates](../domain/candidate-aggregates.md)
