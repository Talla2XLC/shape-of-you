---
id: "decisions-20260811-model-versioned-person-local-day-closures"
kind: adr
title: "Model versioned Person-local day closures without owning domain facts"
status: accepted
date: 2026-08-11
supersedes: []
superseded_by: null
tags:
  - "daily-projection"
  - "day-lifecycle"
  - "domain"
  - "postgresql"
  - "timezones"
---

# Model versioned Person-local day closures without owning domain facts

## Context

Shape of You already stores independently owned physical-state, nutrition,
training, recovery, and coaching facts. The legacy `Daily_Log` combines those
facts and derived values in one row, but the accepted architecture rejects a
broad `DayRecord` aggregate because it would move authority across domain
modules and reproduce spreadsheet coupling.

The remaining DEV-023 gap is narrower. A user needs a stable Person-local date
for a daily view, an explicit distinction between an open and closed day, a
reproducible closure result, and a visible response when facts are corrected or
arrive after closure. The design must preserve each module as the authority for
its facts and must not make day closure a transaction spanning all modules.

Time-zone changes make implicit server dates unsafe. A closure needs the IANA
time zone and local date that the user selected for that operation. Source
facts retain their own timestamps, local dates, provenance, correction, and
supersession semantics.

## Decision

Introduce `DayClosure` in the existing API modular monolith as a versioned,
Person-owned coordination artifact. Do not introduce a broad `JournalDay` or
`DayRecord` aggregate.

A closure is identified by a generated id and records:

- the owning `Person`;
- the Person-local calendar date;
- the IANA time zone used to interpret that date;
- a monotonically increasing version for that Person and local date;
- the closure timestamp and actor/source provenance;
- the versioned projection policy used to compose the result;
- an immutable summary snapshot and typed references to the facts and decision
  artifacts included by that projection;
- an optional supersession link and reason when the closed result is replaced.

At most one closure version is active for a Person and local date. The absence
of an active closure means that the date is open; an additional mutable
`JournalDay` row is not required. Closing an already closed date with the same
idempotency key returns the existing result. Reopening does not delete or edit
the closure: it supersedes the active version with an explicit reason. Closing
again appends a new version.

Daily projections are composed by an application-level query over module-owned
read ports. The projection may include physical-state, nutrition, training,
recovery, and coaching sections, but it never writes those modules and never
becomes their authority. An open-day query is a live projection. A closed-day
query returns the immutable closure snapshot plus a freshness status computed
from later facts or corrections. Late or corrected evidence does not silently
rewrite a closed snapshot; it marks the closure as stale until the user or an
explicit policy reopens and closes the date again.

Use one API-owned PostgreSQL transaction for closure rows, their snapshot, and
their typed reference manifest. Do not use a distributed transaction, event
bus, new service, or cross-service SQL. Module read ports provide the data to
compose the candidate snapshot before the closure transaction; optimistic
freshness checks reject the close if the referenced module state changed during
composition. A bounded retry may rebuild the candidate.

Each module-owned read port returns all current facts for the exact local date;
the public-list pagination limits are never used to compose or refresh a
closure. A closed date must subsequently be queried with the same IANA time
zone that was recorded on the closure, otherwise the API returns a conflict.
The current HTTP commands record the owner Person as actor and `manual` as the
source channel in both the closure and its operation ledger.

The initial public contract supports:

- reading a daily projection by explicit local date and IANA time zone;
- closing an open date with an idempotency key;
- reopening an active closure with an explicit reason;
- reading closure history and freshness status.

Automatic midnight closure, scheduled jobs, real-data migration, frontend
screens, LLM behavior, subscriptions, billing, and notification delivery are
outside this decision.

## Considered alternatives

- **A broad mutable `DayRecord` owning all daily values:** rejected because it
  crosses aggregate and module ownership, requires wide transactions, and
  recreates the `Daily_Log` coupling already rejected by the architecture.
- **A mutable `JournalDay` row with an `open` or `closed` status:** rejected for
  the first slice because open state can be represented by the absence of an
  active closure, while mutable status would add a second lifecycle authority
  and make closure history harder to audit.
- **Only compute daily views dynamically and persist no closure:** simpler for
  dashboards, but cannot represent an explicit user close, reproduce what was
  shown at close time, or distinguish late evidence from silent historical
  changes.
- **Copy all referenced facts into a new daily authority:** rejected because it
  duplicates module facts and correction rules. The closure stores only a
  projection snapshot and typed references needed for reproducibility.
- **Close days automatically at midnight:** deferred because travel, delayed
  sources, user intent, and retry policy are not yet validated. Explicit close
  is the smaller safe contract.

## Consequences

- Domain facts remain independently owned and correctable by their modules.
- Closed daily summaries are reproducible and audit-friendly, while late or
  corrected evidence stays visible instead of silently mutating history.
- The API gains one narrow coordination module and module read ports, but no
  deployable, database, credential, broker, or scheduler.
- Projection policy and snapshot schema require versioning so historical
  closures remain readable after calculation changes.
- The first version requires an explicit local date and IANA time zone; choosing
  a default Person time zone is a separate profile decision.
- A later unified history or web dashboard can consume the same read contract
  without owning domain rules.

## Verification

- Database constraints allow at most one active closure per Person/local date
  and reject invalid version, date, time-zone, supersession, and idempotency
  states.
- Migration tests cover clean install, upgrade, rollback readiness, concurrent
  close/reopen requests, and PostgreSQL identifier byte limits.
- Integration tests prove idempotent close, append-only reopen/reclose,
  optimistic freshness rejection, and stale status after late or corrected
  evidence.
- Contract tests prove an open projection is live and a closed projection uses
  its immutable versioned snapshot and typed references.
- Tests prove closure never creates, changes, corrects, or deletes facts owned
  by Physical State, Nutrition, Training, Recovery, or Coaching.
- Architecture Review confirms there is no broad daily aggregate, new service,
  duplicated authority, or unnecessary asynchronous infrastructure.

## Related material

- [Independent facts over a broad DayRecord](20260728-prefer-independent-facts-over-broad-day-record.md)
- [Candidate aggregates](../wiki/domain/candidate-aggregates.md)
- [Integrity and lifecycle](../wiki/data/integrity-and-lifecycle.md)
- [DEV-023 completion plan](../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
- [TASK-0039 implementation plan](../../plans/2026/08/completed/2026-08-11-task-0039-person-local-day-closures.md)
