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
data remains forbidden until the implemented authenticated-erasure lifecycle is
released with approved independent journal storage and an owner-backed staging
restore drill.

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

Connection erasure uses an API-owned durable request.
Fresh passkey authentication quarantines the connection immediately, while an
idempotent worker removes connection-derived observations, assessments, and
Coaching outputs. The worker cannot claim the request until its accepted intent
has been sealed into the independent journal and acknowledged in PostgreSQL.
Exact `retainUntil` expiry uses the same path. Manual observations without a
connection and shared provider/model definitions remain.

The restore authority is a typed append-only SQLite journal outside the
restorable PostgreSQL and release boundaries. It records accepted intent before
physical deletion and completion evidence afterward. Restore replay follows
accepted intent even when completion is absent, so a crash cannot make an old
backup authoritative again. Schema, file permissions, hash-chain integrity, and
the required completeness cutoff must verify before a restored database can
serve traffic. The repository includes sync/inspect/apply commands and a real
isolated PostgreSQL 17 `pg_dump`/`pg_restore` drill on a private non-`5431`
port. A same-host journal or test checkpoint alone is not production-ready; an
owner-approved immutable independent copy is still required.

Immutable ReadinessAssessment/LoadRiskAssessment pin exact policy version,
analysis window, evidence checksum, and typed observation/training links.
Missing/low-quality evidence limits confidence; hard safety stops override
scores. Assessment never mutates Training.

## Evidence

- Recovery schema/contracts/integration tests.

## Decisions

- [Recovery ADR](../../adr/20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md).
- [Wearable sleep score and Recovery MCP input](../../adr/20260831-model-wearable-sleep-score-and-normalize-recovery-mcp-input.md).
- [Recovery retention and authenticated connection erasure](../../adr/20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md).
- [Independent typed Recovery erasure journal](../../adr/20260904-use-independent-typed-recovery-erasure-journal.md).

## Open questions

- Real provider credentials and ingestion authentication.
- Cluster-owner approval of journal retention, protected external immutable
  storage, maximum backup lifetime, and a drill against the actual staging
  backup topology.

## Related material

- [Coaching](coaching-and-decision-support.md)
- [Data ownership](../architecture/data-ownership.md)
