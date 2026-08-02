---
id: "decisions-20260731-model-typed-recovery-observations-and-versioned-readiness-assessments"
kind: adr
title: "Model typed recovery observations and versioned readiness assessments"
status: accepted
date: 2026-07-31
supersedes: []
superseded_by: null
tags:
  - "privacy"
  - "recovery"
  - "readiness"
  - "policies"
---

# Model typed recovery observations and versioned readiness assessments

## Context

Recovery and Readiness must accept manual and future device data, preserve
provenance, and produce reproducible readiness/load-risk assessments. This data
is sensitive, time- and quality-dependent, and must remain separate from
Coaching recommendations.

One arbitrary JSON table would hide required fields, units, and constraints.
Fully separate models per metric would duplicate ownership, time, idempotency,
correction, and chronology behavior.

## Decision

Keep Recovery and Readiness as a typed module of the existing API:

1. Shared provider, device model, and capability definitions have stable
   identity and immutable versions. They are not copied per Person and own no
   personal data.
2. Connection, device instance, consent, retention state, and observations
   belong to Person. This slice stores no real provider credentials or tokens.
3. Immutable `RecoveryObservation` stores owner, source, UTC interval, IANA
   timezone, local date, quality, idempotency key, and optional
   `supersedes_id`.
4. The root has exactly one typed detail: sleep session, numeric recovery
   metric, or subjective check-in. Arbitrary JSON never replaces domain fields
   and units.
5. Correction replaces the whole observation and current queries/assessments
   exclude the superseded record.
6. Device sources require active consent for the same Person, allowed data
   kind, and active retention state. Manual data never pretends to be device
   data.
7. Consent revocation stops new collection but does not claim physical deletion
   of old values. Retention expiry/erasure is a separate privacy lifecycle.
   Real device data is forbidden until authenticated erasure exists; current
   runtime is synthetic-only.
8. Assessment rules use stable definitions and immutable
   `RecoveryAssessmentPolicyVersion` with effective period and typed
   parameters. Shared-policy writes require separate authority.
9. Immutable `ReadinessAssessment` and `LoadRiskAssessment` pin exact policy
   version, analysis window, input checksum, and typed observation/session
   evidence. Incompatible load kinds are not silently summed.
10. Missing/low-quality data limits confidence. Any hard safety stop overrides
    the readiness score.
11. Recovery owns physiological readiness/load-risk assessment. Coaching may
    consume it but cannot mutate observations, assessments, or training plans.
12. Assessment runs by explicit command. No scheduler, queue, generic rules
    engine, event store, separate service, or automatic plan mutation is added.

Recovery reads training history through a narrow read-only port. Explicit
foreign keys to evidence sessions are allowed inside one API, but Recovery
never mutates Training tables.

## Considered alternatives

- Universal observation/assessment `kind` plus JSON: easy extension but weak
  constraints and a premature health-data platform.
- Separate aggregate/API per metric: strict but duplicates lifecycle and
  fragments chronology.
- Typed root with typed details: shared lifecycle plus strong constraints.
  Selected.
- Retain data indefinitely after revocation: simple but lacks a privacy
  boundary.
- Treat revocation as hidden deletion: falsely conflates stopping collection
  with erasure.
- Put load risk in Coaching: smaller Recovery but mixes state assessment with
  action recommendation.

## Consequences

- Shared device definitions are reused without sharing personal observations.
- New observation kinds require a typed contract, detail table, and migration.
- Reproducible assessment stores policy version, evidence, and calculation
  snapshot.
- Real device integration needs separate credential, authentication, erasure,
  retention, and provider-contract decisions.
- Until then, API supports only manual/synthetic scenarios without production
  health data.

## Verification

- People may share a device-model version but cannot see each other's
  connections, consent, or observations.
- Every observation has exactly one allowed detail.
- Device data without active consent is rejected.
- UTC interval, timezone, and local date remain consistent through DST.
- Repeated idempotency keys create one fact.
- Correction creates a full replacement excluded from current assessments.
- Policy version and evidence checksum reproduce the assessment.
- Low coverage limits confidence and hard stops override readiness.
- Calculation changes no Training facts or active program.
- No universal polymorphic observation/fact/rules table exists.

## Related material

- [Recovery and Readiness](../wiki/domain/recovery-and-readiness.md)
- [Bounded contexts](../wiki/domain/bounded-contexts.md)
- [Data ownership](../wiki/architecture/data-ownership.md)
- [Shared definitions and Person state](20260731-separate-shared-reference-definitions-from-person-owned-state.md)
- [Typed provenance and supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [Independent facts over DayRecord](20260728-prefer-independent-facts-over-broad-day-record.md)
- [Completed implementation plan](../../plans/2026/07/completed/2026-07-31-recovery-and-readiness.md)
