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

The root stores time, derived local date, timezone, typed source, dedupe,
confidence, note/media reference, and correction metadata. Child
`BodyMeasurementValue` stores controlled metric, exact value, and canonical
unit.

Initial metrics are `waist`, `chest`, `hips`, `thigh`, and `biceps`; values are
centimeters and use numeric, not floating point. One metric kind appears at most
once per session.

Correction supplies a complete replacement session with a new identity and
`supersedes_id`. The original and full history remain. Binary media is not
stored in PostgreSQL.

## Evidence

- Schema, domain code, and Physical State integration tests.

## Decisions

- A source Body row is one aggregate, not independent metric facts or a wide
  mutable table.

## Open questions

- Production media lifecycle before real photo import.

## Related material

- [Body API](../api/body-measurement-sessions.md)
- [Physical State ADR](../../adr/20260730-model-body-measurement-sessions-and-versioned-physical-goals.md)
