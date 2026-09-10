---
id: "architecture-api-connections"
kind: architecture
title: "Connections API"
status: draft
tags:
  - "api"
  - "integrations"
  - "oauth"
  - "privacy"
---

# Connections API

## Summary

Provides the authenticated browser contract for the disabled-by-default
`Garmin via Intervals.icu` connection. The product names both providers and
does not accept a Garmin password, Garmin token, or personal Intervals.icu API
key.

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
- `POST /v1/integrations/garmin-intervals/disconnect` revokes local consent and
  stops new imports before best-effort remote disconnect.

The status projection contains lifecycle (`unavailable`, `connecting`,
`active`, `degraded`, or `disconnected`), bounded `failureCode`, and
`lastAttemptAt`, `lastSuccessfulSyncAt`, `lastDataAt`, `connectedAt`, and
`disconnectedAt`. It never contains credentials or provider response bodies.

Disconnect retains imported facts. Deleting imported connection data remains a
separate fresh-passkey Recovery erasure action and follows the fail-closed
journal lifecycle. Failed remote disconnect is retried independently while
local import stays disabled.

The Connections page presents the two-provider disclosure, safe degraded
reason, synchronization timestamps, disconnect, and the separate erasure
action. Browser storage does not hold OAuth code, state, or token material.

## Evidence

- Integration contracts, API unit/PostgreSQL tests, and Web Playwright flow.
- `TASK-0101` independent Quality acceptance.

## Decisions

- [Garmin through Intervals.icu](../../adr/20260907-connect-garmin-through-intervals-icu.md)
- [Recovery retention and authenticated connection erasure](../../adr/20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)

## Open questions

- Intervals.icu OAuth application approval, credentials, Supporter/dormancy
  policy, and live provider smoke testing.
- Production activation, migration application, deployment, and VM verification
  require separate operator approvals.

## Related material

- [Recovery](../domain/recovery-and-readiness.md)
- [Training](../domain/training-and-performance.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Deployment](../architecture/deployment.md)
