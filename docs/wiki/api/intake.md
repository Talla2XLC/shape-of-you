---
id: "architecture-api-intake"
kind: architecture
title: "Intake API"
status: draft
tags:
  - "api"
  - "contract"
  - "intake"
---

# Intake API

## Summary

Asynchronously accepts user text, exposes parsing/item progress, and lets each
typed item be clarified, confirmed, or rejected independently.

## Content

- `POST /v1/intake/requests` — atomically stores request/job and returns `202`
  without waiting for parser.
- `GET /v1/intake/requests/:id` — current parsing, derived request status, and
  ordered items.
- `POST /v1/intake/requests/:id/items/:itemId/clarification` — answer and
  queued reparse, `202`.
- `POST /v1/intake/requests/:id/items/:itemId/decision` — `confirm|reject`,
  `202`.
- `GET /openapi.json` — shared-schema OpenAPI.

Create accepts text, locale, IANA timezone, SourceReference, and idempotency
key. Clarification/decision use separate idempotency keys. Projection exposes
`parsingStatus`, derived `status`, safe `failureCode`, and items. Only
`weight_measurement` is implemented; completed detail links WeightMeasurement.

All operations are Person-scoped. Source text is persisted but never logged or
returned in diagnostics. Without a production parser, durable jobs remain
queued and do not affect readiness; synthetic parser exists only in tests.

## Evidence

- Intake contracts/controller/integration tests.

## Decisions

- [Durable Intake queue](../../adr/20260802-use-durable-postgresql-intake-queue-and-typed-items.md).

## Open questions

- Production parser and authenticated PersonContext before real data.

## Related material

- [Intake domain](../domain/intake.md)
- [Weight API](weight-measurements.md)
- [Backend runtime](../architecture/backend-runtime.md)
