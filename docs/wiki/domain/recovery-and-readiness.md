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
payload.

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

## Open questions

- Real provider credentials, authentication, retention enforcement, and
  authenticated erasure.

## Related material

- [Coaching](coaching-and-decision-support.md)
- [Data ownership](../architecture/data-ownership.md)
