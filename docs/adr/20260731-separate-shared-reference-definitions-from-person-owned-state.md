---
id: "decisions-20260731-separate-shared-reference-definitions-from-person-owned-state"
kind: adr
title: "Separate shared reference definitions, personal overlays, and person-owned state"
status: accepted
date: 2026-07-31
supersedes: []
superseded_by: null
tags:
  - "data-ownership"
  - "external-sources"
  - "reference-data"
  - "versioning"
---

# Separate shared reference definitions, personal overlays, and person-owned state

## Context

Person ownership protects measurements, observations, plans, and decisions from
authentication identity. Applying `person_id` mechanically to every future
entity would duplicate identical ingredients, exercises, device models, and
policy definitions for every Person.

The opposite extreme—one mutable global state—would let one user change
another's history, settings, or private content. A universal dictionary or
JSONB entity store would hide domain-type differences and weaken constraints.

## Decision

Distinguish four ownership classes in every bounded context:

1. **Shared reference definitions** — reusable product, exercise,
   provider/device model, policy, and other common concepts with stable identity
   and immutable typed versions.
2. **Person overlays and private items** — aliases, favorites, preferred
   parameters, availability, and private definitions. They belong to Person,
   reference shared definitions when applicable, and are never published
   automatically.
3. **Person-owned state** — facts, observations, plans, targets,
   recommendations, decisions, connections, consents, and media metadata. They
   require `person_id` and Person access rules.
4. **External source records** — source identity, checksum, parser version,
   license/terms, and ingestion lifecycle, separate from canonical domain
   identity and person-scoped fact provenance.

This is a cross-context invariant, not a generic catalog framework. Nutrition,
Training, Recovery, and Coaching retain typed module-owned tables, contracts,
and adapters. Each vertical approves exact schemas, versions, and matching.

Known applications:

- Nutrition: shared versioned brands, ingredients, and foods; overlays/private
  recipes; person-owned Meal snapshots.
- Training: shared exercises; aliases/equipment overlays; person-owned program
  versions, sessions, sets, records, and progression decisions.
- Recovery: shared provider/model/capability definitions; person-owned
  connections, consent, devices, observations, and retention state.
- Coaching/policy: shared immutable policy versions; person-owned targets,
  allowed overrides, activation, and decisions pinned to exact policy version
  and parameter snapshot.

Media objects are not shared reference data. Cross-Person deduplication of
private binaries is forbidden until a separate privacy/security decision.

## Considered alternatives

- Decide ownership independently per vertical: flexible but repetitive and
  inconsistent.
- Make everything Person-scoped: simple authorization but duplicate knowledge.
- Make every definition globally mutable: avoids copies but breaks history and
  private ownership.
- Build a universal catalog/facts/policy platform: uniform but premature and
  weakly typed.
- Shared invariant with separate typed implementations: prevents recurring
  mistakes without a generic framework. Selected.

## Consequences

- Person ownership applies to human data, not reusable reference knowledge.
- Shared revisions cannot be silently overwritten.
- Overlays do not copy or mutate canonical content.
- External provider identity does not leak into core domain columns.
- Each vertical enforces shared/private/access constraints in database and
  application layers.
- Exact schemas still require their own decisions; this ADR alone authorizes no
  Training, Recovery, or Coaching implementation.

## Verification

- Every vertical Architecture Review classifies entities into the four classes.
- Multiple People reuse one shared definition without copied content.
- Private items and Person state require the appropriate grant.
- Historical facts and decisions pin exact reference/policy versions.
- Source records are idempotent by source identity and never merge by name
  alone.
- No universal polymorphic entity table appears.

## Related material

- [User, Person, and access](20260730-separate-user-access-from-person-data-ownership.md)
- [Layered Nutrition catalog](20260731-use-layered-versioned-nutrition-catalog.md)
- [Data ownership](../wiki/architecture/data-ownership.md)
- [Bounded contexts](../wiki/domain/bounded-contexts.md)
- [DEV-023 completion plan](../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
