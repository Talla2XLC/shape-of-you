---
id: "architecture-api-connections"
kind: architecture
title: "Connections API"
status: accepted
tags:
  - "api"
  - "integrations"
  - "oauth"
  - "privacy"
---

# Connections API

## Summary

Provides authenticated browser controls for direct `Garmin` personal-key
linking and the existing `Garmin via Intervals.icu` OAuth connection. Both
reuse the API-owned typed import, consent, sync evidence and erasure boundaries.
Connecting enables rolling synchronization; older history is requested separately.
Direct linking and the observed wellness mapping are locally accepted. A bounded
own-account read-only sample confirmed populated fields; live typed import and
delivery remain unverified. Existing Intervals history is never automatically
switched or merged.

## Content

### Direct Garmin

The user creates a Personal API key in Garmin settings, pastes it into the
masked field, and connects with explicit import consent. Successful token
exchange and an authenticated profile read are sufficient: an account without
health or activity records remains connected with no data. No initial watch
sync or external account ID is required from the user. The external identity
is bound from documented record IDs before domain writes; a different account
after key rotation cannot silently merge with retained facts.

Endpoints under `/v1/integrations/garmin-personal` are `GET` status and `POST`
`check`, `connect`, `disconnect`, and `historical-import`. `check` creates no
connection or facts. `connect` accepts `{ apiKey, consent: true }`; mutation
bodies are Person-bound and CSRF-protected. Safe responses are `no-store` and
never contain credentials or external account IDs. Key checking is bounded to
five attempts per Person per minute within one API process.

Database plus the integration encryption key ring/active key ID enable direct
linking independently of Intervals OAuth settings. Personal keys are encrypted
at rest; access tokens stay in a bounded memory cache scoped to connection and
consent generation. Rotation/disconnect invalidate old scopes. The browser
clears its key field after success, cancellation or unmount and never persists
it. Local disconnect stops import and discards the key; revoking the key in
Garmin remains the account owner's separate action. Imported-data deletion
continues through the existing fresh-passkey erasure flow.

Current direct normalization covers sleep duration, explicit resting heart rate,
sleep-average heart rate, SpO2 and respiration, separate daily Body Battery
latest/minimum/maximum, steps with provider chronology, and activity
summaries/original FIT details. Body Battery latest is a `local_date` snapshot,
not an instant reading; no fetch/sync timestamp is assigned as measurement time.
HRV and overall sleep score mappings remain unconfirmed; their delivery state
is `unknown`. The [observed mapping ADR](../../adr/20261120-garmin-observed-wellness-mapping.md)
defines the exact interpretation and consumer constraints.
Garmin training load is not mapped to Intervals relative training stress.
History uses bounded fourteen-day windows with complete activity pagination;
ZIP files are validated and decoded in memory. Empty windows do not end the
entire historical scan.

The backend rejects competing provider activation under the same Person lock,
including retained imported evidence after disconnect. A disconnected empty
Garmin connection does not hide an active Intervals connection from Coach.
The UI protects successful mutations from delayed status-poll responses.

### Garmin via Intervals.icu

The user first connects Garmin to Intervals.icu through Garmin's hosted flow,
then authorizes Shape of You through Intervals.icu OAuth with activity and
wellness read access.

Endpoints:

- `GET /v1/integrations/garmin-intervals` returns the safe connection
  projection;
- `POST /v1/integrations/garmin-intervals/authorization` starts authorization
  for a validated same-origin return path;
- `GET /integrations/intervals-icu/callback` consumes success or denial state
  and redirects without exposing the authorization code;
- `POST /v1/integrations/garmin-intervals/historical-import` explicitly starts
  or resumes the authenticated Person's historical import;
- `POST /v1/integrations/garmin-intervals/disconnect` revokes local consent and
  stops new imports before best-effort remote disconnect.

The status projection contains lifecycle (`unavailable`, `connecting`,
`active`, `degraded`, or `disconnected`), bounded `failureCode`, and
`lastAttemptAt`, `lastSuccessfulSyncAt`, `lastDataAt`, `connectedAt`, and
`disconnectedAt`. Its nested `historicalImport` projection exposes only the
bounded status (`not_requested`, `running`, `completed`, or `failed`), the date
reached by the backwards cursor, safe timestamps, and a bounded failure code.
It never contains credentials or provider response bodies.

Historical import walks backwards in durable windows of at most 180 days,
stopping at `2000-01-01`. Only one due window is handled per worker claim so
rolling synchronization remains the priority. Transient provider failures keep
the historical job resumable and schedule a later retry without degrading the
connection itself. Repeated windows reuse the normal inbox, typed correction,
and deduplication paths for Recovery and Training.

Historical claims, rolling status updates, and typed writes are fenced by the
current consent generation. A worker holding an old provider response cannot
write facts, claim newly requested history, advance its cursor, or overwrite
sync status after disconnect and reauthorization.

Each successfully normalized wellness delivery is also bound to the active
consent generation and to one immutable inbox receipt. Reauthorization keeps
the stable connection and retained Recovery history, but it does not inherit
delivery confirmation from the revoked consent. Until the first current-
consent receipt is normalized, retained values remain readable only as
unconfirmed local facts. A repeated checksum under a new consent confirms the
existing fact without creating a duplicate observation; a changed value still
uses the normal immutable correction path. Retries, including `A -> B -> A`,
are fenced by the exact normalization attempt rather than checksum alone.

The wellness request uses an explicit Intervals.icu field whitelist. Supported
values are sleep duration, sleep score, resting heart rate, average sleeping
heart rate, HRV rMSSD, SpO2, respiration rate, and separate daily Body Battery
minimum and maximum, plus optional integer daily steps. They become
provider-neutral typed Recovery observations; steps use `steps/count` and
preserve the wellness `updated` instant for partial-day `asOf`. An absent steps
field creates no zero, coverage requirement, or user prompt. Completed-day
counts may inform a personal baseline while current-day counts remain partial.
Unknown provider fields and raw response JSON are discarded at the adapter
boundary.

Garmin Body Battery is not a standard Intervals field. The athlete must enable
Garmin wellness download in Intervals.icu and configure custom wellness fields
with the exact codes `BodyBatteryMin` and `BodyBatteryMax`. Historical values
become available to Shape of You only after Intervals itself has downloaded
them and the user starts `Import historical data…` in Shape of You.

Field presence in Garmin Connect does not guarantee delivery through
Intervals.icu. Sleep stages, overnight minimum SpO2, Garmin readiness or stress,
skin temperature, and Garmin nightly respiration are not inferred or stored
without a documented Intervals value. Missing supported values remain coverage
gaps rather than fabricated observations.

Disconnect retains imported facts. Deleting imported connection data remains a
separate fresh-passkey Recovery erasure action and follows the fail-closed
journal lifecycle. Failed remote disconnect is retried independently while
local import stays disabled.

The Connections page presents the two-provider disclosure, safe degraded
reason, synchronization timestamps, and a separate confirmed `Import
historical data…` action. `Disconnect` is a normal connection control. The
compact outlined `Delete imported data…` action is isolated in a danger zone
and explains that a fresh passkey confirmation is required. Browser storage
does not hold OAuth code, state, or token material.

Connections remains the only surface for import lifecycle management. Progress
shows provider-neutral coverage of the resulting typed Person facts and does
not expose connection controls or imported-record counts.

## Evidence

- `TASK-0179` independent local Quality and Architecture Review acceptance;
  direct PostgreSQL/HTTP, fake-provider and browser race checks.
- Integration contracts, API unit/PostgreSQL tests, and Web Playwright flow.
- `TASK-0101`, `TASK-0106`, and `TASK-0110` independent Quality acceptance.
- `TASK-0120` consent-generation, attempt-receipt, correction, and stale-worker
  integration acceptance.

## Decisions

- [Direct Garmin Personal API linking](../../adr/20261118-connect-garmin-personal-api.md)
- [Garmin through Intervals.icu](../../adr/20260907-connect-garmin-through-intervals-icu.md)
- [Import Intervals.icu history only on user request](../../adr/20260911-import-intervals-history-only-on-user-request.md)
- [Automatic day context and optional daily movement](../../adr/20260917-automate-day-context-and-use-optional-daily-movement.md)
- [Import supported Intervals wellness as typed Recovery](../../adr/20260912-import-supported-intervals-wellness-as-typed-recovery.md)
- [Provider-neutral profile data coverage](../../adr/20260913-show-provider-neutral-profile-data-coverage.md)
- [Recovery retention and authenticated connection erasure](../../adr/20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)
- [Consent-scoped Recovery delivery evidence](../../adr/20260919-bind-recovery-delivery-to-consent-generation.md)

## Open questions

- A bounded live read confirmed populated wellness fields and original ZIP
  availability with one declared FIT candidate. Actual FIT decoding, live typed
  import and transition from retained Intervals history remain unverified.
  The operator confirmed
  Supplemental Terms agreement on 2026-11-18.
- Intervals.icu history availability, Supporter/dormancy policy, provider rate
  limits, and live long-running backfill observation.
- Production activation, migration application, deployment, and VM verification
  require separate operator approvals.

## Related material

- [Recovery](../domain/recovery-and-readiness.md)
- [Training](../domain/training-and-performance.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Deployment](../architecture/deployment.md)
