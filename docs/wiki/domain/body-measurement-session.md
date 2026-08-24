---
id: "domain-body-measurement-session"
kind: domain
title: "BodyMeasurementSession"
status: draft
tags:
  - "body"
  - "domain"
  - "measurement"
  - "physical-state"
---

# BodyMeasurementSession

## Summary

`BodyMeasurementSession` is an immutable Person-owned aggregate for one body
measurement event with shared provenance, optional note/media reference, and
typed values.

## Content

The root stores explicit temporal precision, optional exact time, local date,
timezone, typed source, dedupe, confidence, note/media reference, and correction metadata. Child
`BodyMeasurementValue` stores controlled metric, exact value, and canonical
unit.

Interactive create and correction commands require an exact instant and expose
`temporalPrecision=instant`. The controlled Fitness Tracker importer may create
date-only sessions with `temporalPrecision=local_date` and `measuredAt=null`;
it never invents midnight. Current reads order by local date, then exact time
with date-only rows last within the date, then stable session identity.

Initial metrics are `waist`, `chest`, `hips`, `thigh`, and `biceps`; values are
centimeters and use numeric, not floating point. One metric kind appears at most
once per session.

Correction supplies a complete replacement session with a new identity and
`supersedes_id`. The original and full history remain. Binary media is not
stored in PostgreSQL.

The Body importer uses the workbook ID, numeric Body sheet ID, and required
`Measurement_ID` as source identity. A row may contain any non-empty subset of
the five metrics, but a populated invalid metric invalidates the row. Notes and
source labels remain private; a Photo reference blocks import instead of being
discarded or converted into synthetic media.

## Evidence

- Schema, domain code, Physical State tests, and accepted TASK-0048 import
  integration evidence.

## Decisions

- A source Body row is one aggregate, not independent metric facts or a wide
  mutable table.
- Body import audit uses typed relational root/value records and the shared
  Fitness Tracker import lifecycle.

## Open questions

- Production media lifecycle before real photo import.

## Related material

- [Body API](../api/body-measurement-sessions.md)
- [Physical State ADR](../../adr/20260730-model-body-measurement-sessions-and-versioned-physical-goals.md)
- [Body import ADR](../../adr/20260824-use-explicit-body-temporal-precision-and-typed-import-records.md)
