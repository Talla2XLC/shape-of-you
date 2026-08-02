---
id: "architecture-api-body-measurement-sessions"
kind: architecture
title: "BodyMeasurementSession API"
status: draft
tags:
  - "api"
  - "body"
  - "contract"
  - "physical-state"
---

# BodyMeasurementSession API

## Summary

Manages immutable Person-owned body sessions. A session atomically contains
one to five typed values with shared provenance; correction is full replacement.

## Content

- `POST /v1/body-measurement-sessions` — `201` new, `200` idempotent retry.
- `POST /v1/body-measurement-sessions/:id/corrections` — append-only
  replacement; `409` on conflicting successor.
- `GET /v1/body-measurement-sessions/:id` — immutable snapshot.
- `GET /v1/body-measurement-sessions/:id/history` — correction chain.
- `GET /v1/body-measurement-sessions?limit=50&cursor=...&metric=waist` —
  current sessions ordered `(measuredAt DESC, id DESC)`, optional metric.

Create/correction accept time, IANA timezone, values, dedupe key,
SourceReference, and nullable confidence/photoMediaId/note. Values use metric
`waist|chest|hips|thigh|biceps`, `1.00..500.00`, and `cm`; duplicate metrics are
invalid. Server context supplies Person and generated fields.

## Evidence

- Body contracts/module and PostgreSQL integration tests.

## Decisions

- Session and values commit in one transaction; multiple sessions per local
  day are allowed; correction replaces the aggregate.

## Open questions

- Private media upload, storage, retention, erasure, and note/photo privacy.

## Related material

- [BodyMeasurementSession](../domain/body-measurement-session.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Migrations](../data/backend-migrations.md)
