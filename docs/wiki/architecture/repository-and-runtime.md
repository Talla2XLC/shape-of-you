---
id: "architecture-repository-and-runtime"
kind: architecture
title: "Repository and runtime"
status: draft
tags:
  - "architecture"
  - "runtime"
---

# Repository and runtime

## Summary

The repository is a modular monorepo. Colocation does not imply runtime
coupling or premature service decomposition.

## Content

One Git/4DreamTeam workspace contains canonical Wiki in `docs/wiki/`, ADR in
`docs/adr/`, and Russian plans in `plans/YYYY/MM/`. The pnpm workspace contains
the API in `apps/api` and shared transport/config packages in
`packages/contracts` and `packages/config`.

Canonical Wiki/ADR are ordinary Git Markdown. 4DreamTeam manages board, memory,
sources, and workflow; its managed Wiki is frozen legacy state. The repository
validator checks canonical documents without a mirror or sync pipeline.

Deployable services cannot depend directly on one another through workspace
packages. Approved cross-cutting reuse uses explicit shared packages with
reviewed ownership and dependency direction.

Docker may use the monorepo as build context, but runtime includes only built
API artifacts and transitive dependencies. API owns its Dockerfile,
`package.json`, `AGENTS.md`, migrations, database, credentials, and integration
tests.

Current topology is one NestJS backend and one API-owned PostgreSQL database.
Nest modules are logical boundaries. New deployables or Kafka require measured
drivers such as scale, independent ownership/release, isolation, replay, or
multiple consumers.

Temporary staging uses GHCR images in a separate Compose project. Project nginx
is a deployment adapter, not a domain boundary.

## Evidence

- Operator repository/runtime rules and accepted ADRs.

## Decisions

- One deployable backend remains accepted; multiple services are not.
- Canonical Markdown is the only project-knowledge authority.

## Open questions

- Remaining module boundaries, target cloud after temporary staging,
  authentication/authorization/TLS, and SLOs.

## Related material

- [Bounded contexts](../domain/bounded-contexts.md)
- [Drivers](drivers.md)
- [Modular monorepo ADR](../../adr/20260728-modular-monorepo.md)
- [Service autonomy ADR](../../adr/20260728-deployable-service-autonomy.md)
- [Canonical Wiki ADR](../../adr/20260728-use-canonical-markdown-wiki-in-git.md)
- [Temporary deployment ADR](../../adr/20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
