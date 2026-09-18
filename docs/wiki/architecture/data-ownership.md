---
id: "architecture-data-ownership"
kind: architecture
title: "Data ownership"
status: draft
tags:
  - "architecture"
  - "data"
---

# Data ownership

## Summary

Staging PostgreSQL is authoritative for operational fitness data through
API-owned domain modules. Persistence follows domain boundaries and forbids
cross-service database access.

## Content

TASK-0067 completed the approved authority transfer after reconciliation,
exclusive-writer switch, and bounded observation. Google Sheets is now a
non-authoritative frozen legacy source; governance still prohibits writes, and
its ACL/archive disposition remains separate.

Each deployable owns its database, Drizzle schema, migrations, seed data,
credentials, and lifecycle. A shared physical PostgreSQL cluster does not
change logical ownership. Temporary staging gives API its own
`shape_of_you_api` database/login but shares cluster failures and upgrades.

Authentication `User` and domain `Person` are distinct. Fitness facts belong to
Person; User access requires an active `PersonAccessGrant` role (`owner`,
`editor`, `viewer`, or `coach`). Client-supplied `person_id` alone grants
nothing. Until authentication, only explicit synthetic context is allowed.

The Identity deployable owns its authentication and OAuth persistence boundary.
Its separate Drizzle schema now contains account/WebAuthn/recovery state and
typed OAuth client, grant, session, interaction, authorization-code, and
refresh-family state. Runtime database wiring, passkey/TOTP recovery, and the
initial OAuth protocol flow are implemented.

API-local User remains the authorization principal. The API-owned
`identity_subject_mappings` table binds an exact Identity `(issuer, subject)`
to one User; Identity never writes this table and never owns Person grants or
fitness facts. Each authenticated MCP call resolves that mapping and a current
active `PersonAccessGrant`. No token claim or first login implicitly creates a
Person relationship.

Ownership classes:

- shared immutable reference definitions (brands, ingredients, foods,
  exercises, providers/models, policies);
- Person overlays and private items;
- Person-owned facts, plans, observations, consent, connections,
  recommendations, decisions, and media metadata;
- external source records with provider identity/checksum/parser/review
lifecycle.

Historical facts pin exact shared versions and relevant snapshots. Recovery
consent governs future collection; revocation is not erasure. An account-level
Intervals.icu connection owns its encrypted Person token, import enablement,
sync state, technical delivery identities, and links to typed Recovery and
Training facts. Provider payload JSON is not domain authority. API owns the
implemented durable erasure request, quarantine, dependency-aware deletion,
and minimal receipt. Physical deletion is gated by durable acknowledgement
that accepted intent was sealed outside PostgreSQL.
The backup boundary owns the independently recoverable typed append-only SQLite
journal and must replay every accepted intent before restored data can become
ready. Completion evidence is recorded afterward but is not required to
suppress restored data. Identity supplies a short-lived, single-use,
purpose-bound fresh-passkey authority through an API contract; it does not
access API persistence.

Media binaries live in private S3-compatible storage; PostgreSQL owns metadata
and authorization. Object-key knowledge grants no access.

Forbidden: cross-service SQL/foreign keys, shared multi-service schemas or
migrations, and shared database credentials. Cross-boundary data uses APIs,
events, or owned published read models with explicit freshness contracts.

The progress overview is an API application read model, not a new owner. It
coordinates bounded reads exported by the existing Physical State, Nutrition,
Training, Recovery, and Coaching modules and derives no durable `DayRecord`.
The exact-date `DailyProjection` follows the same rule: it composes current
facts and owns no lifecycle or historical authority.
Provider-neutral profile coverage follows the same composition boundary.
Recovery, Training, Nutrition, and Weight publish lean current-evidence
summaries; Progress applies a versioned presentation policy without storing a
profile aggregate or reading provider counters. Source connections continue to
own import lifecycle only. SourceReference also classifies whether evidence is
eligible for Person-facing context or exists only for operational verification.
Operational evidence keeps its Person ownership, immutable facts, correction
chains, and audit provenance, but coverage and readiness projections exclude it
independently of provider, channel, or date. This classification is internal;
public writers cannot hide Person evidence by assigning it.

The current Recovery context is another API application read model, not a new
owner or bounded context. Integration owns connection lifecycle, safe sync
metadata, normalized inbox delivery evidence, and links to current imported
facts. Recovery owns typed observations and their correction, withdrawal,
consent, retention, and erasure semantics. Coaching composes those published
reads for one Person-local date and owns only the provider-neutral presentation
policy. It does not persist the composition, read raw provider payloads, or add
volatile sync state to immutable DailyAssessment snapshots and checksums.

## Evidence

- Operator authority/boundary rules and linked ADRs.

## Decisions

- Logical ownership matters more than physical cluster separation.
- `User` owns authentication; `Person` owns fitness state.
- Shared definitions, overlays, Person state, and source records have different
  lifecycles; no universal Person-scoped model.

## Open questions

- Final context ownership, read-model transport/lifecycle, retention/erasure,
  encryption/backup/access, media restore, permissions/invitations, actor audit.

## Related material

- [Migration strategy](migration-strategy.md)
- [Bounded contexts](../domain/bounded-contexts.md)
- [Service autonomy ADR](../../adr/20260728-deployable-service-autonomy.md)
- [Identity ADR](../../adr/20260730-separate-user-access-from-person-data-ownership.md)
- [Shared-reference ADR](../../adr/20260731-separate-shared-reference-definitions-from-person-owned-state.md)
- [Recovery retention and erasure ADR](../../adr/20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)
- [Temporary same-host Recovery erasure journal ADR](../../adr/20260904-temporarily-use-same-host-recovery-erasure-journal.md)
- [Garmin through Intervals.icu ADR](../../adr/20260907-connect-garmin-through-intervals-icu.md)
- [Identity and external tool access](identity-and-external-tool-access.md)
- [Progress overview API](../api/progress-overview.md)
- [Provider-neutral profile data coverage ADR](../../adr/20260913-show-provider-neutral-profile-data-coverage.md)
- [Operational evidence isolation ADR](../../adr/20260913-separate-operational-evidence-from-person-context.md)
- [Connected Recovery freshness for Coach ADR](../../adr/20260918-expose-connected-recovery-freshness-to-coach.md)
- [Capture-first Coach and DayClosure removal](../../adr/20260829-remove-day-closure-and-use-capture-first-coach.md)
