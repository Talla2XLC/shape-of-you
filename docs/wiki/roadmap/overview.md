---
id: "roadmap-overview"
kind: roadmap
title: "Roadmap overview"
status: draft
tags:
  - "delivery"
  - "roadmap"
---

# Roadmap overview

## Summary

The preliminary roadmap moves from foundation through backend extraction and
controlled data migration to web and mobile clients.

## Content

1. **DEV-027 — Workspace and baseline — complete:** repository baseline,
   canonical Markdown Wiki/ADR, plans, and Product/Domain/Architecture docs.
2. **DEV-023 — Backend API and domain extraction — in progress:** stable
   backend contract and domain logic extracted without premature data-authority
   transfer. Implemented: backend foundation, Person/access/provenance,
   WeightMeasurement corrections, Physical State/Goals, Nutrition, Training,
   Recovery, Coaching, and a PostgreSQL Intake queue with the Weight route.
   Versioned daily closure and the bounded progress overview are implemented.
   Missing: production parser and remaining Intake routes.
3. **DEV-024 — PostgreSQL migration and cutover:** pull-based typed import,
   backfill, reconciliation, and an exclusive-writer transition without
   dual-write. All five bounded domain adapters, controlled apply for non-empty
   domains, conflict-free staging reconciliation, deployed 23-tool MCP coverage,
   14 writer/lifecycle canaries, the frozen switch-time checkpoint, and the
   ChatGPT MCP-only writer switch are complete. The bounded post-switch
   observation is Quality- and Architecture-accepted as `READY`: the project,
   23-tool surface, existing synthetic read-back, and frozen workbook evidence
   remained stable. TASK-0067 completed the explicit staging PostgreSQL
   authority transfer without creating a second writer. Google Sheets is now a
   non-authoritative frozen legacy workbook. Remaining work is a separately
   approved workbook archive/read-only ACL disposition and any future rollback.
4. **DEV-025 — Web MVP — in progress:** static passkey-first Nuxt client,
   API-owned browser session, bounded progress overview, and dated daily
   drill-down are implemented; broader MVP workflow remains future scope.
5. **DEV-026 — Mobile client:** mobile access through the same contract.

Mandatory gates: product/context review before service design; ADR before
architecture implementation; stable backend before clients; verified dual-run
before authority transfer; Architecture Review before every major completion.
The DEV-024 authority gate is now complete; these rules remain the required
pattern for any future migration.

## Evidence

- Preliminary roadmap supplied by the operator on 2026-07-28.

## Decisions

- This sequence is directional, not a detailed schedule.

## Open questions

- Remaining DEV-023 priority and DEV-024–026 scope/dependencies/estimates.
- Whether DEV numbering maps to an external tracker.

## Related material

- [Product scope](../product/scope.md)
- [Migration strategy](../architecture/migration-strategy.md)
- [Pull-based import and writer cutover](../../adr/20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Repository and runtime](../architecture/repository-and-runtime.md)
- [DEV-023 plan](../../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
