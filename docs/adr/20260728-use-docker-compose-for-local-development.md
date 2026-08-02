---
id: "decisions-20260728-use-docker-compose-for-local-development"
kind: adr
title: "Use Docker Compose for local development"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "development"
  - "infrastructure"
---

# Use Docker Compose for local development

## Context

Local development needs reproducible coordination of applications and
infrastructure dependencies without prematurely defining production topology.

## Decision

Use Docker Compose only for local development orchestration after approved
runtime components exist. This decision does not select production
orchestration or authorize empty infrastructure scaffolding.

## Considered alternatives

- Install dependencies directly on the host: initially simpler but less
  reproducible across environments.
- Use local Kubernetes: closer to some production topologies but unjustified
  before deployment requirements exist.

## Consequences

Compose configuration is introduced only with approved runtime components.
Production hosting and orchestration remain separate decisions.

## Verification

- The operator explicitly accepted the decision on 2026-07-28.
- Baseline work does not create speculative Compose services.

## Related material

- `../wiki/architecture/repository-and-runtime.md`
- `../wiki/architecture/quality-attributes.md`
