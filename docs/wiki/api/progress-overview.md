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

The API exposes bounded read models for sparse factual progress and
provider-neutral profile data coverage. Both coordinate existing module-owned
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

`GET /v1/progress-data-coverage?localDate=YYYY-MM-DD&timezone=Area%2FCity`
reports the result of accumulated Person-owned facts independently of their
provider or input channel. Its fixed `profile-data-coverage-v1` response has
separate entries for sleep, HRV, resting heart rate, Body Battery, Training,
Weight, and Nutrition. Each entry contains historical first/last dates,
freshness, recorded and usable coverage for the previous 28 and 90 completed
Person-local days, significant gaps, and an explainable `sparse`, `partial`, or
`good` status.

The current Person-local day may update freshness and historical bounds but is
excluded from completed-day coverage. Recovery quality and Body Battery pair
semantics, current Training sessions and external activities, complete recorded
Meal nutrients, and Weight cadence are evaluated by their owning modules.
Historical depth therefore remains distinct from recent regularity. Statuses
describe sufficiency for recommendation context; they are not a health score,
medical assessment, or guarantee of recommendation quality.

Coverage owners consider only SourceReference evidence whose internal purpose
is `person_context`. Evidence retained solely for operational verification does
not affect first/last dates, freshness, completed-day windows, gaps, or status.
The purpose is orthogonal to provider and input channel, is not exposed through
public write contracts, and does not replace source provenance or Person
ownership. Imported external Training activities remain provider-neutral
Person context; only SourceReference-backed manual sessions use this filter.

The authenticated `/progress` screen also presents a compact factual today
card. That card is intentionally not part of the range overview: it performs
one separate read through the existing daily projection contract for the
browser's exact local date and IANA timezone. It shows the projection lifecycle,
recorded Meal totals, WorkoutSession count, available Recovery evidence, and a
link to the canonical dated record. It does not calculate coaching advice or
fall back to progress history when the projection is unavailable, stale, or
superseded.

## Evidence

- Shared runtime schemas and OpenAPI route in `packages/contracts` and
  `apps/api/src/openapi.ts`.
- Coordinator, owner range ports, unit tests, PostgreSQL integration test, and
  browser E2E accepted for TASK-0043.
- Coverage contract, owner summaries, policy pins, PostgreSQL integration, and
  browser E2E accepted for TASK-0107.
- Exact operational-evidence migration, closed-contract tests, and owner-level
  seven-direction filtering accepted for the TASK-0107 remediation.

## Decisions

- [Progress overview authenticated default](../../adr/20260818-make-progress-overview-the-authenticated-default.md)
- [Daily Coach over existing MCP tools](../../adr/20260827-orchestrate-daily-coach-over-existing-mcp-tools.md)
- [Independent facts instead of a broad DayRecord](../../adr/20260728-prefer-independent-facts-over-broad-day-record.md)
- [Provider-neutral profile data coverage](../../adr/20260913-show-provider-neutral-profile-data-coverage.md)
- [Operational evidence isolation](../../adr/20260913-separate-operational-evidence-from-person-context.md)

## Open questions

- Measure query plans and latency at production-like factual density before
  considering owner-local query optimization.

## Related material

- [Data ownership](../architecture/data-ownership.md)
- [Integrity and lifecycle](../data/integrity-and-lifecycle.md)
- [Candidate aggregates](../domain/candidate-aggregates.md)
