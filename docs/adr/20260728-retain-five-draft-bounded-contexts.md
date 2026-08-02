---
id: decisions-20260728-retain-five-draft-bounded-contexts
kind: adr
title: "Retain five draft bounded contexts"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - bounded-contexts
  - domain
  - modular-monolith
---

# Retain five draft bounded contexts

## Context

Source inventory confirmed distinct language and ownership for physical state,
nutrition, training, recovery, and coaching. A single `Observations` context
would reduce boundary count but prematurely merge physical-state and recovery
lifecycles before privacy, policy, and consistency differences are understood.

## Decision

Retain five draft bounded contexts:

1. Physical State and Goals.
2. Nutrition.
3. Training and Performance.
4. Recovery and Readiness.
5. Coaching and Decision Support.

`Observation` may be a shared conceptual pattern or value structure. It is not
a bounded context or deployable service boundary.

## Considered alternatives

- Merge Physical State and Recovery into Observations: deferred because the
  simplification may hide ownership, privacy, and lifecycle differences.
- Create a context per table or AI engine: rejected as spreadsheet-driven and
  prematurely decomposed.
- Convert all five contexts directly into services: rejected as premature
  microservices.

## Consequences

- The logical context map remains stable while aggregates and policies mature.
- One modular backend may initially implement several contexts.
- Shared observation structures do not imply shared database ownership.
- Context merging, splitting, or deployable distribution requires another
  ADR.

## Verification

- Module proposals assign responsibility to one context or an explicit
  supporting technical capability.
- Architecture Review verifies that Observation has not become an implicit
  service or shared aggregate.

## Related material

- [Bounded contexts](../wiki/domain/bounded-contexts.md)
- [Domain overview](../wiki/domain/overview.md)
- [Repository and runtime](../wiki/architecture/repository-and-runtime.md)
