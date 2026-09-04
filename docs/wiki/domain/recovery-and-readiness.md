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
released with a provisioned and verified journal checkpoint. The owner-backed
staging restore drill is complete; the owner temporarily accepts same-host
journal storage for logical-restore protection only.

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
restorable PostgreSQL, release, and manual-backup directories. It records
accepted intent before physical deletion and completion evidence afterward.
Restore replay follows accepted intent even when completion is absent, so a
crash cannot make an old backup authoritative again. Schema, file permissions,
hash-chain integrity, and the required completeness cutoff must verify before a
restored database can serve traffic. The repository includes sync/inspect/apply
commands and a real isolated PostgreSQL 17 `pg_dump`/`pg_restore` drill on a
private non-`5431` port.

The temporary owner-approved storage boundary is a separate owner-controlled
directory on the PostgreSQL VM with mode `0700` and journal/checkpoint files
with mode `0600`. Markers are retained indefinitely while manual backups have
no deletion deadline. This protects against restoring an old logical database
dump but not against loss, compromise, or filesystem rollback of the whole VM.
An off-host or immutable copy remains the recommended target state.

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
- [Temporary same-host Recovery erasure journal](../../adr/20260904-temporarily-use-same-host-recovery-erasure-journal.md).

## Open questions

- Real provider credentials and ingestion authentication.
- Provisioning and verification of the first same-host live journal and sealed
  completeness checkpoint before direct Garmin ingestion.
- A finite backup lifetime and off-host or immutable journal copy for VM-loss
  protection.

## Related material

- [Coaching](coaching-and-decision-support.md)
- [Data ownership](../architecture/data-ownership.md)
