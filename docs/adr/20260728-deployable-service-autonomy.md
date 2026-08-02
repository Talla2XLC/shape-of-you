---
id: "decisions-20260728-deployable-service-autonomy"
kind: adr
title: "Require autonomy for every deployable service"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "architecture"
  - "service-boundaries"
---

# Require autonomy for every deployable service

## Context

Monorepo colocation must not blur service ownership, dependency direction, or
operational isolation.

## Decision

Every deployable service has its own `Dockerfile`, `package.json`, `AGENTS.md`,
database boundary, Drizzle schema, migrations, seed data, credentials, and
integration tests.

A deployable service must not import another service through a package or
workspace dependency. Reuse is allowed only through explicit shared packages.
These constraints apply when services are created and do not authorize
premature service decomposition.

## Considered alternatives

- Shared build and persistence configuration: fewer files initially but
  obscures ownership and independent delivery.
- Direct package dependencies between services: convenient reuse but makes
  service boundaries nominal.

## Consequences

Each deployable can be built, configured, migrated, tested, and released
within its own boundary. CI may use the monorepo as build context, but the
runtime artifact contains only the deployable and its transitive dependencies.

The service template, required metadata, and credential mechanism require
separate design before another service is created.

## Verification

- The operator explicitly set these requirements on 2026-07-28.
- No deployable is created without satisfying them.

## Related material

- `../wiki/architecture/overview.md`
- `20260728-modular-monorepo.md`
- `20260728-api-or-event-only-cross-service-communication.md`
