---
id: "decisions-20260728-use-nodejs-typescript-and-pnpm-workspaces"
kind: adr
title: "Use Node.js, TypeScript, and pnpm workspaces"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "monorepo"
  - "technology"
---

# Use Node.js, TypeScript, and pnpm workspaces

## Context

The modular monorepo needs one maintainable language and workspace model for
the backend, web-facing packages, shared contracts, and tooling.

## Decision

Use Node.js, TypeScript, and pnpm workspaces as the initial application stack.
A future component may use another language when a subsequent ADR establishes
a concrete need.

## Considered alternatives

- Multiple application languages: enables specialization but adds operational
  and cognitive cost before domain boundaries justify it.
- npm or Yarn workspaces: both are viable; pnpm was selected for workspace
  support and dependency isolation.

## Consequences

Repository tooling and application packages share TypeScript conventions.
Node.js and TypeScript versions and the build, lint, test, and monorepo tools
are selected as implementation needs emerge. This ADR alone does not create
package manifests.

## Verification

- The operator explicitly accepted the decision on 2026-07-28.
- Package manifests are introduced only by approved implementation work.

## Related material

- `../wiki/architecture/drivers.md`
- `../wiki/architecture/repository-and-runtime.md`
