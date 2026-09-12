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
observations, account connections, and reproducible readiness/load-risk
assessments. The configuration-gated Garmin-via-Intervals.icu path uses OAuth,
rolling synchronization, and an explicit historical import action. Supported
wellness values become provider-neutral typed observations; unsupported Garmin
screen values are not inferred. The owner-backed staging restore drill is
complete; the owner temporarily accepts same-host journal storage for logical-
restore protection only.

## Content

Shared provider/device-model/capability definitions use immutable versions.
Person owns connections, device instances, consent, retention state, and
observations. A connection may represent either a physical device or an
authorized account. Per-connection Intervals.icu access tokens are stored only
as authenticated ciphertext bound to provider, Person, and connection; global
OAuth credentials and encryption keys are runtime configuration. Neither is
returned by public projections or written to logs.

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

The Intervals.icu adapter imports supported wellness fields through an
account-level source channel. Its explicit whitelist maps sleep duration, sleep
score, resting heart rate, average sleeping heart rate, HRV rMSSD, SpO2,
respiration rate, and daily Body Battery minimum and maximum to typed immutable
observations. `BodyBatteryMin` and `BodyBatteryMax` remain distinct `0..100`
score metrics; neither is presented as a current Body Battery reading. The same
provider identity and normalized checksum is a no-op; changed or removed fields
create immutable correction or withdrawal observations. Wellness provenance
remains `intervals_icu_wellness` and may include Garmin because Intervals.icu
does not reliably expose the original provider for each wellness field.

Body Battery requires exact Intervals custom wellness codes
`BodyBatteryMin` and `BodyBatteryMax` plus enabled Garmin wellness download.
The regular rolling worker and the explicit historical-import worker share the
same normalization, deduplication, correction, consent, and erasure path.
Unknown fields and raw Intervals JSON never become the Recovery domain model.

Intervals can return only values it has received and exposed. Sleep stages,
overnight minimum SpO2, Garmin readiness or stress, skin temperature, and
Garmin nightly respiration remain unsupported until a documented Intervals
field and verified transport fixture exist. Screenshot capture remains a
manual fallback, not the normal ingestion path for the supported metrics.

Connection erasure uses an API-owned durable request.
Fresh passkey authentication quarantines the connection immediately, while an
idempotent worker removes connection-derived observations, assessments, and
Coaching outputs, plus linked Training facts. The worker cannot claim the
request until its accepted intent has been sealed into the independent journal
and acknowledged in PostgreSQL.
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

The repository-managed unattended erasure-journal path uses a root-scheduled
one-shot container from the active API image. It directly mounts that
owner-only directory,
serializes synchronization, creates a unique sealed checkpoint only for pending
acknowledgements, and acknowledges PostgreSQL only after durable flush and
verification. Missing or invalid journal storage therefore keeps physical
erasure blocked. The source and CI contract are accepted. Provider ingestion is
available only when its stable OAuth and encryption configuration is complete;
deployment, migration application, and runtime verification remain separately
controlled operational actions.

Immutable ReadinessAssessment/LoadRiskAssessment pin exact policy version,
analysis window, evidence checksum, and typed observation/training links.
Missing/low-quality evidence limits confidence; hard safety stops override
scores. Assessment never mutates Training.

## Evidence

- Recovery schema/contracts/integration tests.
- `TASK-0110` independent Quality and Architecture Review acceptance.

## Decisions

- [Recovery ADR](../../adr/20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md).
- [Wearable sleep score and Recovery MCP input](../../adr/20260831-model-wearable-sleep-score-and-normalize-recovery-mcp-input.md).
- [Recovery retention and authenticated connection erasure](../../adr/20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md).
- [Temporary same-host Recovery erasure journal](../../adr/20260904-temporarily-use-same-host-recovery-erasure-journal.md).
- [Automated Recovery erasure journal synchronization](../../adr/20260904-automate-recovery-erasure-journal-with-root-scheduled-one-shot.md).
- [Garmin through Intervals.icu](../../adr/20260907-connect-garmin-through-intervals-icu.md).
- [Typed Intervals wellness import](../../adr/20260912-import-supported-intervals-wellness-as-typed-recovery.md).

## Open questions

- Live coverage of optional Garmin wellness fields varies by device, Garmin
  delivery, Intervals configuration, and historical availability.
- Production migration application and post-deployment live provider validation.
- Supporter/dormancy and commercial-use policy confirmation for unattended
  production synchronization.
- A finite backup lifetime and off-host or immutable journal copy for VM-loss
  protection.

## Related material

- [Coaching](coaching-and-decision-support.md)
- [Data ownership](../architecture/data-ownership.md)
