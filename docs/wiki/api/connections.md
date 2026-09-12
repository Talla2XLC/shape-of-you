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

Provides the authenticated browser contract for the configuration-gated
`Garmin via Intervals.icu` connection. Complete provider configuration makes
the connection available without a separate enable flag. The product names
both providers and does not accept a Garmin password, Garmin token, or personal
Intervals.icu API key. Connecting starts only rolling synchronization;
complete history is imported only after a separate user request.

## Content

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

The wellness request uses an explicit Intervals.icu field whitelist. Supported
values are sleep duration, sleep score, resting heart rate, average sleeping
heart rate, HRV rMSSD, SpO2, respiration rate, and separate daily Body Battery
minimum and maximum. They become provider-neutral typed Recovery observations;
unknown provider fields and raw response JSON are discarded at the adapter
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

## Evidence

- Integration contracts, API unit/PostgreSQL tests, and Web Playwright flow.
- `TASK-0101`, `TASK-0106`, and `TASK-0110` independent Quality acceptance.

## Decisions

- [Garmin through Intervals.icu](../../adr/20260907-connect-garmin-through-intervals-icu.md)
- [Import Intervals.icu history only on user request](../../adr/20260911-import-intervals-history-only-on-user-request.md)
- [Import supported Intervals wellness as typed Recovery](../../adr/20260912-import-supported-intervals-wellness-as-typed-recovery.md)
- [Recovery retention and authenticated connection erasure](../../adr/20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)

## Open questions

- Intervals.icu history availability, Supporter/dormancy policy, provider rate
  limits, and live long-running backfill observation.
- Production activation, migration application, deployment, and VM verification
  require separate operator approvals.

## Related material

- [Recovery](../domain/recovery-and-readiness.md)
- [Training](../domain/training-and-performance.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Deployment](../architecture/deployment.md)
