---
id: "decisions-20260730-model-body-measurement-sessions-and-versioned-physical-goals"
kind: adr
title: "Model body measurement sessions and versioned physical goals"
status: accepted
date: 2026-07-30
supersedes: []
superseded_by: null
tags:
  - "body-measurements"
  - "goals"
  - "physical-state"
  - "reconciliation"
---

# Model body measurement sessions and versioned physical goals

## Context

The workbook `Body` sheet stores one session row with a date,
`Measurement_ID`, source, photo, note, and waist, chest, hips, thigh, and
biceps values. A wide table copies the sheet and requires schema changes per
metric. Independent metric facts lose shared provenance and atomic session
correction.

The current Settings goal combines narrative intent with a dynamic target
weight. It is not a fixed numeric target and has no history. The future model
must support directional, range, and exact criteria without turning intent into
a rigid policy.

Weight appears in both `Weight` and `Daily_Log.Weight`. Read-only inspection
found all populated pairs equal and missing daily weights empty, indicating a
denormalized mirror rather than independent measurements.

## Decision

### Weight authority and reconciliation

- `Weight` is the authoritative migration journal.
- `Daily_Log.Weight` is a legacy projection and reconciliation evidence.
- Import creates `WeightMeasurement` only from `Weight`.
- Equal daily values confirm parity but create no second fact or identity.
- Missing/different values create findings, never last-write-wins resolution.
- Multiple real measurements per Person/local day are allowed; no unique
  `local_date` constraint exists.

### BodyMeasurementSession

Model one source session as aggregate `BodyMeasurementSession`:

- root stores UUID, `person_id`, `measured_at`, derived `local_date`, IANA
  timezone, typed source, dedupe identity, nullable confidence/media/note, and
  append-only correction metadata;
- child `BodyMeasurementValue` stores controlled metric, exact numeric value,
  and canonical unit;
- one current value per metric kind per session;
- initial metrics are `waist`, `chest`, `hips`, `thigh`, and `biceps`, expanded
  only by explicit domain/schema change;
- current circumferences use centimeters and never floating point;
- correction replaces the full immutable session with a `supersedes_id` copy,
  explicitly retaining unchanged values;
- photo is an optional private media reference; binaries are outside
  PostgreSQL and this implementation scope.

### PhysicalGoal

Model a goal as a versioned plan, not a measurement:

- `PhysicalGoal` supplies stable Person-owned identity and lifecycle;
- immutable `PhysicalGoalVersion` stores version, intent/title, optional dates,
  and structured criteria;
- `PhysicalGoalCriterion` stores controlled metric, direction or target mode,
  optional exact/range values, and canonical unit;
- narrative intent is valid without a numeric criterion;
- editing creates a draft version; activation atomically switches current
  version without changing history;
- completion/cancellation belong to the root lifecycle and do not rewrite
  facts or versions;
- current goals and progress are projections, not another authority table;
- rename PostgreSQL enum `weight_measurement_source` to shared
  `source_channel` without changing values.

## Considered alternatives

- Wide nullable body columns: mirrors the sheet but ties metric growth to
  schema migrations and hinders shared goal criteria.
- One fact per metric: trend-friendly but loses row provenance, photo, and
  atomic correction.
- Universal JSONB measurements/facts: flexible but weakens constraints,
  typing, and ownership.
- Mutable goal settings: simple but loses intent/criteria history.
- Mandatory exact targets: easy percentages but misrepresents dynamic
  multi-criterion intent.

## Consequences

- Body persistence uses root/value tables in one aggregate transaction.
- Session correction requires a complete replacement snapshot.
- Domain/database constraints control metrics and units.
- Goals support narrative intent and typed criteria without a generic rules
  engine.
- Weight mirror reconciliation remains migration tooling, not runtime domain
  complexity.
- Enum rename removes a misleading database name without changing API.
- Media upload, real-data import, dual-run, and cutover remain separate.

## Verification

- Integration tests create multi-value sessions atomically.
- Database rejects duplicate metric kinds and invalid units.
- Correction preserves full supersession history.
- Goal activation preserves old versions and atomically changes current.
- Directional goals without numeric targets are valid.
- Synthetic reconciliation confirms equal journals and blocks differences
  without creating duplicate weight facts.

## Related material

- [WeightMeasurement](../wiki/domain/weight-measurement.md)
- [Candidate aggregates](../wiki/domain/candidate-aggregates.md)
- [Source of truth and authority](../wiki/data/source-of-truth-and-authority.md)
- [Typed provenance and supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [Physical State and Goals plan](../../plans/2026/07/completed/2026-07-30-physical-state-measurements-and-goals.md)
