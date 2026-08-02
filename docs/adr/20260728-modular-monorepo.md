---
id: "decisions-20260728-modular-monorepo"
kind: adr
title: "Use a modular monorepo"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "architecture"
  - "service-boundaries"
---

# Use a modular monorepo

## Context

Shape of You is a long-term production project that began with an empty
repository. One repository simplifies coherent architecture governance while
still allowing deployable boundaries.

## Decision

Use a modular monorepo. The current workspace directory is the only project,
workspace, and Git root. Creating `sources/shape-of-you` or another nested
project root is forbidden.

Logical areas may include `apps/`, `services/`, `packages/`,
`infrastructure/`, `docs/adr/`, and `plans/`. Create directories only when
approved work needs them.

## Considered alternatives

- Multiple repositories: stronger physical isolation but premature delivery
  and coordination overhead for undefined components.
- An unstructured repository: simpler initially but does not preserve
  dependency direction or future deployable boundaries.

## Consequences

Repository colocation does not imply runtime coupling, a shared database,
shared credentials, or mandatory microservices. A future structural change
requires alternatives and a superseding ADR.

Package management, build orchestration, final directory structure, and
service decomposition remain subject to approved work.

## Verification

- The operator explicitly accepted the decision on 2026-07-28.
- Empty directories and speculative deployables are not authorized.

## Related material

- `../wiki/architecture/overview.md`
- `20260728-deployable-service-autonomy.md`
- `20260728-api-or-event-only-cross-service-communication.md`
