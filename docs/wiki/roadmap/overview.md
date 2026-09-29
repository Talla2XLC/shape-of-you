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

The roadmap records completed foundation and staging authority transfer,
current backend and Web capabilities, and later scope without treating an
unimplemented Intake parser or mobile client as delivered.

## Content

1. **DEV-027 — Workspace and baseline — complete:** repository baseline,
   canonical Markdown Wiki/ADR, plans, and Product/Domain/Architecture docs.
2. **DEV-023 — Backend API and domain extraction — core domains implemented:**
   backend foundation, Person/access/provenance,
   WeightMeasurement corrections, Physical State/Goals, Nutrition, Training,
   Recovery, Coaching, and a PostgreSQL Intake queue with the Weight route.
   Versioned daily closure and the bounded progress overview are implemented.
   A production parser and remaining Intake routes are not implemented and
   are deferred from near-term delivery by the TASK-0149 product decision.
   The existing Intake foundation remains in place.
3. **DEV-024 — Staging PostgreSQL migration and cutover — complete:**
   pull-based typed import, backfill, reconciliation, and an exclusive-writer
   transition without dual-write. All five bounded domain adapters, controlled
   apply for non-empty domains, conflict-free staging reconciliation, deployed
   23-tool MCP coverage,
   14 writer/lifecycle canaries, the frozen switch-time checkpoint, and the
   ChatGPT MCP-only writer switch are complete. The bounded post-switch
   observation is Quality- and Architecture-accepted as `READY`: the project,
   23-tool surface, existing synthetic read-back, and frozen workbook evidence
   remained stable. TASK-0067 completed the explicit staging PostgreSQL
   authority transfer without creating a second writer. Google Sheets is now a
   non-authoritative frozen legacy workbook retained as an indefinite
   read-only reference. Archive, delete, and ACL disposition are not roadmap
   items. Any future rollback remains separately approved.
4. **DEV-025 — Web client — current slice implemented:** static passkey-first Nuxt client,
   API-owned browser session, bounded progress overview, and dated daily
   drill-down are implemented. An authenticated one-action Coach launcher now
   opens the Person-bound persistent ChatGPT Work conversation with the
   Shape of You Staging MCP source. Broader Web workflows require separate
   product scope rather than following automatically from this roadmap.
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
- Intake expansion requires a concrete need beyond the current Coach workflow,
  such as non-chat or offline ingestion or an API-owned resumable multi-fact
  request; it is not a current delivery commitment (TASK-0149).

## Open questions

- Which additional Web/mobile workflows warrant product approval.
- Whether DEV numbering maps to an external tracker.

## Related material

- [Product scope](../product/scope.md)
- [Migration strategy](../architecture/migration-strategy.md)
- [Pull-based import and writer cutover](../../adr/20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Repository and runtime](../architecture/repository-and-runtime.md)
- [DEV-023 plan](../../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
