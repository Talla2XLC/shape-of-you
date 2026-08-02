---
id: "architecture-api-weight-measurements"
kind: architecture
title: "WeightMeasurement API"
status: draft
tags:
  - "api"
  - "contract"
  - "weight"
---

# WeightMeasurement API

## Summary

Creates and reads immutable Person-scoped WeightMeasurements, current state,
and explicit correction history using shared runtime/OpenAPI schemas.

## Content

- `POST /v1/weight-measurements` — `201` new, `200` existing Person/source/
  `dedupeKey` fact.
- `POST /v1/weight-measurements/:id/corrections` — `201` replacement, `200`
  idempotent retry, `409` conflicting replacement.
- `GET /v1/weight-measurements/:id/history` — complete chain.
- `GET /v1/weight-measurements/:id` — immutable fact or `404`.
- `GET /v1/weight-measurements?limit=50&cursor=...` — current facts ordered
  `(measuredAt DESC, id DESC)` with opaque cursor.
- `GET /openapi.json` — generated OpenAPI.

Create accepts `measuredAt`, `timezone`, `weightKg`, `dedupeKey`, typed
`sourceReference`, and nullable `confidence`. Correction accepts a full
replacement plus `reason`. Verified application context supplies `personId`;
the server creates `localDate`, UUID, and timestamps. Unknown fields are
rejected; domain validation verifies IANA timezone.

## Evidence

- Weight contracts, controller, and unit/integration tests.

## Decisions

- OpenAPI and runtime validation share one schema source.
- Cursor is opaque; public SourceReference hides private raw snapshots.

## Open questions

- Replace synthetic PersonContext with authenticated grant-aware adapter before
  real data.

## Related material

- [WeightMeasurement](../domain/weight-measurement.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Migrations](../data/backend-migrations.md)
