---
id: "decisions-20260730-separate-user-access-from-person-data-ownership"
kind: adr
title: "Separate User access from Person fitness-data ownership"
status: accepted
date: 2026-07-30
supersedes: []
superseded_by: null
tags:
  - "access-control"
  - "authentication"
  - "data-ownership"
  - "identity"
---

# Separate User access from Person fitness-data ownership

## Context

Fitness data belongs to the human described by measurements, nutrition,
training, recovery, and coaching decisions. An authentication account performs
actions but is not always that human: one account may manage several people,
and one person's data may be shared with an owner, coach, or viewer.

Using `user_id` as the sole owner would simplify the first single-user case but
couple domain identity to an authentication protocol and force migration when
multi-access appears. `Subject` is accurate in privacy contexts but too generic
for product language.

## Decision

Use three distinct concepts:

- `User` — account authentication identity;
- `Person` — domain identity of the human whose fitness data is stored;
- `PersonAccessGrant` — explicit authority for a `User` to work with a
  particular `Person`.

Domain facts, plans, observations, recommendations, and media metadata use
`person_id`. Authentication sessions belong to `User`. `User` and `Person`
have a many-to-many relationship; the initial role vocabulary is `owner`,
`editor`, `viewer`, and `coach`. Permission matrix and invitation lifecycle
belong to a separate security task.

The application never grants access merely because a client supplied
`person_id`. It resolves the selected Person through the authenticated User and
an active grant. Trusted import and background work use explicit auditable actor
contexts, not arbitrary Users.

Until authentication exists, staging remains synthetic-only. An explicitly
configured synthetic Person adapter is allowed only in tests/staging and must
be removed before the DEV-024 real-data gate. `Profile` is not owner identity;
it is a mutable view or settings collection for a Person.

## Considered alternatives

- `user_id` on all facts: smallest schema but conflates account and human.
- `subject_id`: correct boundary but weak product language.
- `profile_id`: UI-friendly but a mutable profile is not stable human identity.
- `athlete_id`: too narrow for nutrition, recovery, and general health state.
- `person_id` with access grants: preserves ownership and supports multi-access
  without a premature identity service. Selected.

## Consequences

- New person-owned facts, plans, observations, recommendations, targets,
  connections, and media metadata are scoped to Person. Shared reusable
  definitions follow a separate ADR and are not copied per Person.
- `WeightMeasurement` gains `person_id` before real-data migration; synthetic
  migration does not transfer authority from Google Sheets.
- Authorization is an application concern rather than repository-local logic.
- Account deletion, access revocation, and fitness-data erasure have distinct
  lifecycles and need privacy/retention policy.
- One modular backend and one API-owned database remain; no identity
  microservice is created.
- Security Review approves permissions, invites, and actor audit before real
  data.

## Verification

- Integration tests prove many-to-many access and deny missing grants.
- Mutations get `person_id` from verified application context, not request body.
- Revoking a grant does not delete the Person or facts.
- Revoking a session does not change domain ownership.
- Synthetic context cannot activate implicitly and is forbidden at the
  real-data gate.

## Related material

- [Data ownership](../wiki/architecture/data-ownership.md)
- [Provenance and identifiers](../wiki/data/provenance-and-identifiers.md)
- [Revocable authentication sessions](20260729-store-revocable-auth-sessions-in-postgresql.md)
- [Shared fact contracts plan](../../plans/2026/07/completed/2026-07-30-person-identity-provenance-and-corrections.md)
- [Shared reference definitions and person-owned state](20260731-separate-shared-reference-definitions-from-person-owned-state.md)
