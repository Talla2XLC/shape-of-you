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
respiration rate, daily Body Battery minimum and maximum, and integer daily
steps to typed immutable observations. Steps use the provider-neutral metric
`steps` and unit `count`; missing steps never create a zero observation.
`BodyBatteryMin` and `BodyBatteryMax` remain distinct `0..100`
score metrics; neither is presented as a current Body Battery reading. The same
provider identity and normalized checksum is a no-op; changed or removed fields
create immutable correction or withdrawal observations. Wellness provenance
remains `intervals_icu_wellness` and may include Garmin because Intervals.icu
does not reliably expose the original provider for each wellness field.

Completed Person-local step totals are consolidated by maximum count rather
than summed across overlapping observations and may support Coaching's robust
full-day personal baseline. A current-day count carries the wellness `updated`
instant as `asOf`; invalid, wrong-day, or more-than-five-minutes-future updates
are ineligible. Current partial-day steps never train the full-day baseline.
Correction, withdrawal, late import, disconnect retention, and connection
erasure use the same Recovery lifecycle as other typed observations.

Body Battery requires exact Intervals custom wellness codes
`BodyBatteryMin` and `BodyBatteryMax` plus enabled Garmin wellness download.
The regular rolling worker and the explicit historical-import worker share the
same normalization, deduplication, correction, consent, and erasure path.
Unknown fields and raw Intervals JSON never become the Recovery domain model.

Current focused Recovery reads compose typed observations with a separate
provider-neutral delivery context. Observations remain the value authority;
delivery evidence never changes a health value or DailyAssessment decision.
The v2 context reports a closed state for every supported field:
`confirmed_present`, `confirmed_absent`, `retained_unconfirmed`, or `unknown`.
Confirmed absence means only that a normalized current-consent record omitted
the field; it is neither zero nor evidence of a cause. Retained unconfirmed
means that a local value remains available while the active consent has not
yet confirmed its freshness.

Integration contributes consent-scoped delivery evidence through the exact
normalized inbox receipt and current fact pointer. A pointer confirms presence
only when it names the exact current Recovery observation; a partially written
create, correction, or withdrawal therefore fails closed. Replays such as
`A -> B -> A` use attempt-specific receipts, and stale workers cannot publish
evidence after reauthorization. Aggregate target-date delivery is derived from
the reconciled per-metric states and cannot hide partial delivery.

The Coach-facing observation projection contains only typed health detail,
quality, and temporal semantics. Person, connection, consent, deduplication,
source-record, correction-chain, receipt, checksum, credential, external-user,
and raw-payload identities remain internal. The separate raw Recovery history
contract retains its identifiers for explicit correction workflows.

Current-day steps with an eligible provider update instant are
`partial_day` as of that exact instant. They are an intermediate lower bound,
not a completed daily total or evidence of low activity. Reauthorization
preserves the stored value but removes its confirmation until a successful
current-consent normalization.

Intervals can return only values it has received and exposed. Sleep stages,
overnight minimum SpO2, Garmin readiness or stress, skin temperature, and
Garmin nightly respiration remain unsupported until a documented Intervals
field and verified transport fixture exist. Garmin Training Readiness has no
verified connected metric. The API defines `garmin_post_activity_recovery_time`
as a typed `RecoveryObservation` in minutes, sourced from the original Garmin
FIT via the existing Intervals.icu activity endpoint. Its value is an estimated
historical snapshot at FIT message `140.253` UTC, with activity identity and
parser version in provenance. Garmin does not document message `140` in the
public FIT Profile, so this mapping is empirical. The importer requires a
valid Garmin Activity FIT and does not store the binary file. Missing or
invalid evidence stays unavailable; it is never treated as zero. The new API
migration was applied to staging by the approved promotion of
`c89927907b5194e22400684aea0042b366b7215c`; API and edge readiness and
generic staging smoke passed. Production rollout and user-specific provider
validation remain pending. Coach does not require a screenshot
for routine guidance and never treats this snapshot as a current countdown or
as Shape of You's own RecoveryAssessment. The Recovery observation list accepts
an optional metric filter so Coach can retrieve this sparse historical metric
without it being displaced by more frequent wellness observations.
See [the FIT snapshot ADR](../../adr/20260924-import-garmin-post-activity-recovery-snapshot-from-intervals-fit.md)
for the evidence boundary and accepted interpretation.

Connection erasure uses an API-owned durable request.
Fresh passkey authentication quarantines the connection immediately, while an
idempotent worker removes connection-derived observations, assessments, and
Coaching outputs, including daily assessment snapshots that contain relational
links to erased Recovery observations, plus linked Training facts. The worker
deletes those derived daily recommendations in the same transaction before it
removes the observation graph. The worker cannot claim the
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

Progress coverage reads current, non-withdrawn observations without depending
on their provider. Sleep, HRV rMSSD, resting heart rate, and Body Battery remain
separate directions. Poor-quality observations are recorded but not usable;
Body Battery needs either a direct point or both daily minimum and maximum to
make that date usable. These coverage statuses describe evidence sufficiency,
not physiological readiness or medical quality.

The live personal-baseline path uses a Recovery-owned bounded history reader.
It admits only current, non-withdrawn `person_context` evidence
with usable quality, keeps metric and unit semantics separate, and excludes
facts hidden by a pending erasure request. Subjective acute-illness and injury
concern observations remain available to the safety stream even when they are
not baseline samples. Recovery supplies one owner-consolidated representative
per metric and local date plus exact observation and RecoveryAssessment IDs.
Direct, minimum, and maximum Body Battery retain separate comparisons but form
one physiological signal for daily escalation. A stored daily assessment is
comparable only while its
complete Recovery evidence set still resolves to current observations for the
same Person and no linked consent or connection is being erased. Corrections,
withdrawals, supersession, late imports, and erasure therefore fail closed
instead of silently reusing stale evidence.

Daily snapshots retain relational links to both Recovery observations and
RecoveryAssessments. Connection erasure removes recommendations linked through
either path before deleting the underlying graph. Additive migrations backfill
those links for readable legacy v1 snapshots and fail closed on missing or
cross-owner identifiers.

For counterfactual calibration, Recovery supplies provider-neutral daily
representatives plus current valid assessment, risk, and hard-stop evidence.
Corrections, withdrawals, supersession, late imports, and erasure change the
next replay. Daily consolidation is a current projection and is not an exact
reconstruction of the observation ordering used by a historical live v1 read.

## Evidence

- Recovery schema/contracts/integration tests.
- `TASK-0110` independent Quality and Architecture Review acceptance.
- `TASK-0112` Recovery correction, withdrawal, and derived-snapshot erasure
  integration tests.
- `TASK-0118` connected delivery projection, empty-record, reconnect,
  Person-isolation, and freshness-policy tests.
- `TASK-0120` consent-scoped receipts, exact observation publication fences,
  per-metric delivery, crash-cut, safe-projection, and correction tests.

## Decisions

- [Recovery ADR](../../adr/20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md).
- [Wearable sleep score and Recovery MCP input](../../adr/20260831-model-wearable-sleep-score-and-normalize-recovery-mcp-input.md).
- [Recovery retention and authenticated connection erasure](../../adr/20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md).
- [Temporary same-host Recovery erasure journal](../../adr/20260904-temporarily-use-same-host-recovery-erasure-journal.md).
- [Automated Recovery erasure journal synchronization](../../adr/20260904-automate-recovery-erasure-journal-with-root-scheduled-one-shot.md).
- [Garmin through Intervals.icu](../../adr/20260907-connect-garmin-through-intervals-icu.md).
- [Typed Intervals wellness import](../../adr/20260912-import-supported-intervals-wellness-as-typed-recovery.md).
- [Provider-neutral profile data coverage](../../adr/20260913-show-provider-neutral-profile-data-coverage.md).
- [API-owned daily assessment and next action](../../adr/20260914-own-daily-assessment-and-next-action-in-api.md).
- [Hybrid personal baselines for daily assessment](../../adr/20260915-use-hybrid-personal-baselines-for-daily-assessment.md).
- [Counterfactual v1 replay with explicit ambiguity](../../adr/20260915-replay-daily-assessment-v1-with-explicit-ambiguity.md).
- [Balanced personal-baseline activation in daily assessment v2](../../adr/20260917-activate-balanced-personal-baselines-in-daily-assessment-v2.md).
- [Automatic day context and optional daily movement](../../adr/20260917-automate-day-context-and-use-optional-daily-movement.md).
- [Connected Recovery freshness for Coach](../../adr/20260918-expose-connected-recovery-freshness-to-coach.md).
- [Consent-scoped Recovery delivery evidence](../../adr/20260919-bind-recovery-delivery-to-consent-generation.md).
- [Garmin screenshots are not required for Coach recovery](../../adr/20260924-do-not-require-garmin-screenshots-for-coach-recovery.md).

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
