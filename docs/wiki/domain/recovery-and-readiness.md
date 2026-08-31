---
id: "domain-recovery-and-readiness"
kind: domain
title: "Recovery and Readiness"
status: draft
tags:
  - "domain"
  - "privacy"
  - "recovery"
  - "readiness"
---

# Recovery and Readiness

## Summary

Implemented Recovery separates shared device definitions, Person-owned typed
observations, and reproducible readiness/load-risk assessments. Real device
data remains forbidden until authenticated erasure exists.

## Content

Shared provider/device-model/capability definitions use immutable versions.
Person owns connections, device instances, consent, retention state, and
observations. No real provider credentials are stored.

Immutable RecoveryObservation stores UTC interval, IANA timezone/local date,
source, quality, idempotency, correction metadata, and exactly one typed detail:
sleep, numeric recovery metric, or subjective check-in. No generic JSON domain
payload. Wearable `sleep_score` is a provider-neutral numeric metric with the
existing `score` unit and a `0..100` range. It remains separate from the
nullable subjective `sleepQuality` scale of `1..5`.

Natural text or screenshot capture uses the existing MCP Recovery boundary.
The connector accepts exact local-date facts without requiring clients to
construct nullable ownership, provenance, or interval bookkeeping, then
normalizes and validates the strict domain command. One report remains a set
of independent observations: a failure in one fact does not block the other
unambiguous facts, and date-level read-back verifies the resulting set. A
screenshot is manual provenance; it never fabricates a device connection or
consent.

Device observations require active matching consent; revocation stops future
collection but is not erasure. Corrections replace full observations.

Immutable ReadinessAssessment/LoadRiskAssessment pin exact policy version,
analysis window, evidence checksum, and typed observation/training links.
Missing/low-quality evidence limits confidence; hard safety stops override
scores. Assessment never mutates Training.

## Evidence

- Recovery schema/contracts/integration tests.

## Decisions

- [Recovery ADR](../../adr/20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md).
- [Wearable sleep score and Recovery MCP input](../../adr/20260831-model-wearable-sleep-score-and-normalize-recovery-mcp-input.md).

## Open questions

- Real provider credentials, authentication, retention enforcement, and
  authenticated erasure.

## Related material

- [Coaching](coaching-and-decision-support.md)
- [Data ownership](../architecture/data-ownership.md)
