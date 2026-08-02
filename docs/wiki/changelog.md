---
id: "changelog"
kind: roadmap
title: "Change log"
status: draft
tags: []
---

# Change log

## Summary

The project knowledge baseline was created on 2026-07-28. Core DEV-023 backend
verticals and asynchronous Intake foundations are implemented. Production
parsing, shared day lifecycle, and real-data migration remain separate stages.

## Content

### 2026-08-02 — English canonical documentation

- Changed repository language policy: plans remain Russian; Wiki, ADRs,
  READMEs, guides, templates, and agent-facing documentation use English.
- Translated all canonical Wiki and ADR pages without changing stable IDs,
  statuses, links, technical contracts, or architecture authority.
- Updated the documentation validator and fixtures to require English section
  names and return English diagnostics.
- Added an ADR that rejects both duplicate bilingual documentation and English
  operator plans.

### 2026-08-02 — Intake queue and WeightMeasurement routing

- Added asynchronous idempotent IntakeRequest API with `202 Accepted`.
- Added independent typed items, clarification/confirmation, relational Weight
  detail, and append-only audit timeline without generic JSON/JSONB payloads.
- Added PostgreSQL lease queue with `SKIP LOCKED`, retry/backoff, and terminal
  failure without Kafka, broker, or a new service.
- Added atomic WeightMeasurement routing and passed 64 tests, migration-prefix
  upgrades, typecheck, build, lint, and docs validation.
- Production parser and other typed routes remain future slices.

### 2026-07-31 — Nutrition, Training, Recovery, and Coaching

- Added layered shared/private Nutrition catalog, immutable Meal snapshots,
  corrections, and daily totals.
- Added versioned exercise catalog/programs, immutable WorkoutSessions and
  sets, records, and progression projections.
- Added typed Recovery observations, consent/device ownership, versioned
  assessment policies, and evidence-linked assessments.
- Added immutable typed Coaching recommendations, policy pinning, evidence,
  and separate user decisions.
- Added source-neutral staging records for future external catalogs without
  connectors, scrapers, schedulers, or automatic name merge.

### 2026-07-30 — Physical State, identity, provenance, and corrections

- Separated authentication `User`, fitness-data `Person`, and many-to-many
  `PersonAccessGrant`.
- Replaced public arbitrary provenance with typed `SourceReference` and
  Person/source-scoped dedupe.
- Added append-only corrections and history for WeightMeasurement.
- Added BodyMeasurementSession with typed values and versioned PhysicalGoal.
- Defined `Weight` as migration authority and `Daily_Log.Weight` as a
  reconciliation projection.

### 2026-07-29 — Backend and staging foundation

- Created the Node.js/TypeScript/pnpm modular monorepo and first deployable API.
- Added WeightMeasurement contracts, PostgreSQL/Drizzle, Docker/Compose,
  migration service, staging edge, smoke/rollback scripts, and GitHub Actions.
- Established isolated API database/credentials and no cross-service SQL.

### 2026-07-28 — Discovery and architecture baseline

- Initialized the Git repository and 4DreamTeam workspace.
- Accepted modular-monorepo, service-autonomy, communication, and Architecture
  Review decisions.
- Added Vision/Product/Domain/Architecture knowledge and five draft contexts.
- Kept Google Sheets authoritative until verified dual-run and cutover.
- Selected canonical Markdown Wiki and ADR in Git; managed Wiki became frozen
  legacy state.
- Rejected broad `DayRecord` ownership in favor of independent facts and
  projections.

## Evidence

- Canonical Wiki/ADR state and completed plans in this repository.

## Decisions

- This log summarizes delivery and never replaces ADR rationale or task
  evidence.

## Open questions

- Remaining DEV-023 scope and approved DEV-024 real-data migration sequence.

## Related material

- [Getting started](start/overview.md)
- [Roadmap](roadmap/overview.md)
- [Architecture overview](architecture/overview.md)
