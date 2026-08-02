---
id: "domain-bounded-contexts"
kind: domain
title: "Draft bounded contexts"
status: draft
tags:
  - "bounded-contexts"
  - "domain"
---

# Draft bounded contexts

## Summary

The accepted draft has five logical bounded contexts. They are modeling
boundaries, not approved deployable services.

## Content

1. **Physical State and Goals:** weight/body facts, versioned goals, long-term
   progress, and constraints.
2. **Nutrition:** shared catalog, private overlays/recipes, Meal facts, and
   recommendation inputs.
3. **Training and Performance:** shared exercises, versioned programs,
   sessions/sets, records, and progression candidates.
4. **Recovery and Readiness:** shared device definitions, Person observations,
   readiness evidence, and load-risk assessment.
5. **Coaching and Decision Support:** evidence-linked immutable
   recommendations and separate user decisions.

`Observation` is a conceptual/value pattern, not a context, data owner, or
service.

Supporting capabilities:

- **Observation Intake and Timeline:** implemented natural-language
  orchestration with typed items, independent clarification/confirmation,
  PostgreSQL queue, idempotent routing, and append-only chronology. Only the
  Weight route exists; production parser and other routes do not.
- **Data Integrity and Migration:** reconciliation, deterministic self-healing,
  backfill, dual-run evidence, integrity reporting, cutover, and rollback.

Coaching consumes published evidence without rewriting source facts. Intake
routes confirmed commands to owning contexts. Shared terminology never implies
shared persistence. One modular backend may implement several contexts; never
map contexts mechanically to microservices.

Key ownership decisions: facts are immutable and Person-owned; shared
definitions are versioned; overlays/private items belong to Person;
recommendations, user decisions, and execution remain separate; assessments
pin policies/evidence; projections do not become authority.

## Evidence

- Google Sheets inventory and [five-context ADR](../../adr/20260728-retain-five-draft-bounded-contexts.md).

## Decisions

- Retain five contexts and do not merge Physical State with Recovery yet.
- Service/database distribution is not approved.

## Open questions

- Day-closure ownership, whether supporting capabilities ever justify
  contexts, production parser, and authenticated wearable erasure.

## Related material

- [Domain overview](overview.md)
- [Data ownership](../architecture/data-ownership.md)
- [Body sessions](body-measurement-session.md)
- [Physical goals](physical-goal.md)
- [Recovery](recovery-and-readiness.md)
- [Coaching](coaching-and-decision-support.md)
- [Intake](intake.md)
