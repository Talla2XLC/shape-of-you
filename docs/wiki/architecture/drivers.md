---
id: "architecture-drivers"
kind: architecture
title: "Architecture drivers"
status: draft
tags:
  - "architecture"
  - "drivers"
---

# Architecture drivers

## Summary

Safe decision support, migration continuity, explainability, domain evolution,
and long-term maintainability drive architecture—not early distribution.

## Content

Product drivers:

- preserve and improve the operational Google Sheets system;
- expose one consistent backend contract to web and mobile;
- create safe explainable daily decisions from longitudinal evidence;
- preserve user confirmation and provenance of facts/actions.

Technical drivers:

- migrate through inventory, mapping, backfill, reconciliation, dual-run,
  cutover, and rollback;
- maintain strict ownership and forbid cross-service SQL;
- use append-only evidence and idempotency where defined;
- develop in a modular monorepo and create deployables only when justified;
- use PostgreSQL with transparent SQL through Drizzle.

Accepted constraints include Node.js, TypeScript, pnpm, PostgreSQL, Drizzle,
and Docker Compose for local development. Temporary shared-VM staging is
accepted; target cloud/production topology is not. New service boundaries,
event infrastructure, and API capabilities require separate design.

## Evidence

- Operator baseline from 2026-07-28 and accepted ADRs.

## Decisions

- Drivers constrain options but do not authorize implementation.

## Open questions

- Scale, data volume, concurrency, availability, latency, recovery objectives,
  hosting, budget, privacy, threat model, and regulation.

## Related material

- [Quality attributes](quality-attributes.md)
- [Data ownership](data-ownership.md)
- [Deployment](deployment.md)
- [Migration](migration-strategy.md)
- [Bounded contexts](../domain/bounded-contexts.md)
