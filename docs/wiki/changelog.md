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

### 2026-08-07 — Minimal passkey-first Nuxt client

- Added a static Nuxt 4 client with a public landing page, fragment-only
  first-passkey enrollment, discoverable-passkey sign-in, and minimal passkey
  and session management over existing Identity contracts.
- Preserved the exact Identity origin, host-only session cookie, session-bound
  CSRF, WebAuthn RP ID, API/MCP routes, and Identity protocol paths without
  adding CORS, a frontend backend, a database, or another deployable runtime.
- Embedded the static output in the existing unprivileged edge image and added
  runtime host/path E2E coverage, immutable asset headers, safe client fallback,
  and upstream-failure precedence.
- Added deterministic Playwright coverage with a virtual WebAuthn authenticator
  for fragment non-persistence, enrollment failures and cancellation, sign-in,
  security mutations, unauthenticated redirects, keyboard focus, reduced
  motion, and mobile width. ChatGPT provisioning and deployment remain deferred.

### 2026-08-07 — Stable staging deployment bootstrap

- Reduced the installed root-owned deployment entrypoint to a bounded
  bootstrap that verifies exact `origin/main` and invokes one fixed controller
  path from that commit.
- Moved the evolving field allowlist, secret handoff, registry login, and
  deployment orchestration into the versioned controller.
- Preserved the dedicated `shape-deploy` identity, fixed sudoers rule, shared
  deployment/renewal lock, strict controller validation, and no Docker-group
  or arbitrary-shell access for CI.
- Added a bootstrap security contract to CI. One final bootstrap installation
  remains; subsequent deployment-protocol changes require no SSH maintenance.

### 2026-08-07 — OAuth-protected MCP resource server

- Added a stateless Streamable HTTP MCP endpoint inside the API with eight
  allowlisted tools over existing weight, body measurement, meal, and workout
  application contracts.
- Added ES256/JWKS token verification, exact issuer/resource/scope checks,
  API-owned Identity subject mappings, active Person-grant enforcement, and
  request-scoped Person context without synthetic fallback.
- Added protected-resource metadata, per-tool OAuth security schemes,
  standards-complete challenges, an idempotent subject-binding CLI, and
  staging runtime handoff for Identity OAuth keys.
- Passed independent quality review and repository gates. Deployment, secrets,
  subject binding, ChatGPT client provisioning, and external smoke remain
  separate operations.

### 2026-08-06 — Reproducible local API and Identity environment

- Added persistent local API and Identity stacks with separate PostgreSQL
  databases, credentials, migrations, volumes, and private database networks.
- Added service-owned local environment examples and explicit commands for
  containerized and host-based development.
- Added a disposable cross-service E2E stack that starts from clean databases,
  checks both services, and removes its project resources after every run.
- Reused the same E2E command in CI without staging credentials or external
  databases.

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
