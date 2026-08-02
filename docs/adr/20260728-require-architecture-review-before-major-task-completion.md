---
id: "decisions-20260728-require-architecture-review-before-major-task-completion"
kind: adr
title: "Require Architecture Review before major task completion"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "architecture-governance"
  - "quality-gate"
---

# Require Architecture Review before major task completion

## Context

In a long-term project, accidental complexity can accumulate through
individually reasonable tasks. Independent quality review alone does not prove
that a solution remains simple, preserves domain boundaries, avoids premature
distribution, or prevents duplicated documentation authority.

## Decision

Perform an explicit Architecture Review before completing every major task.
The canonical definition and operational checklist live in the root
`AGENTS.md`.

## Considered alternatives

- Review only formal ADR work: cheaper, but architecture consequences also
  arise in tasks not initially presented as decisions.
- Rely on code review or QA: those gates test different properties and do not
  provide a system-level complexity and domain-boundary review.

## Consequences

A major task cannot complete until review covers unnecessary complexity,
premature microservices, Domain-Driven Design alignment, duplicated authority,
and possible simplification without losing required scalability.

A better architecture must be presented to the operator with trade-offs
before adoption. Review cannot silently change architecture and does not
replace an ADR.

## Verification

- The operator explicitly required this gate on 2026-07-28.
- The canonical procedure is the `Architecture Review` section of root
  `AGENTS.md`.

## Related material

- `../wiki/architecture/overview.md`
- Root `AGENTS.md`
