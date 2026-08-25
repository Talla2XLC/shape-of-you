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
verticals, asynchronous Intake foundations, an explicit shared day lifecycle,
and the first DEV-024 controlled Weight importer are implemented. Production
parsing, real-data execution, recurring dual-run, and cutover remain separate
stages.

## Content

### 2026-08-25 — Partial Nutrition evidence and imported closed days

- Replaced Nutrition-wide blocking with identity-scoped reconciliation inside
  the same importer transaction; unrelated valid Meals are no longer suppressed
  by incomplete catalog evidence.
- Added partial historical Meal reads with nullable nutrients, explicit
  completeness, null-not-zero daily totals, and chart gaps for incomplete days
  while keeping public HTTP/MCP writes complete-only.
- Preserved raw legacy meal kind, Photo marker, and unresolved source Food ID in
  typed relational audit instead of discarding or inventing target data.
- Added bounded `Daily_Log` closure input. `Closed` is applied after same-run
  Meals as an idempotent source-authoritative `DayClosure`; Training remains
  optional and is not a closure prerequisite.

### 2026-08-24 — Nutrition adapter in the unified Fitness Tracker importer

- Added one Nutrition adapter to the existing `fitness-tracker:import` command
  over `Brands`, `Ingredients`, `Foods`, `Food_Ingredients`, and `Meals`; no
  separate migrator, deployable, database, or writer was added.
- Preserved durable source IDs, Person-private catalog ownership, typed
  relational audit, atomic fail-closed apply, and date-only Meal precision with
  one immutable serving snapshot item per valid legacy row.
- Added five-sheet source-drift detection, referential validation, safe
  `created / unchanged / conflict / invalid` reporting, schema migration, and
  unit/integration/every-prefix migration coverage.
- Completed the exact-workbook read-only staging dry-run with `created=38`,
  `unchanged=0`, `conflict=81`, and `invalid=40`. No apply, deployment,
  cutover, authority transfer, or post-remediation Sheets write occurred; the
  private snapshot and tunnel were removed.

### 2026-08-24 — Body adapter in the unified Fitness Tracker importer

- Added Body to the existing `fitness-tracker:import` command and shared atomic
  lifecycle; no separate migrator, deployable, database, or writer was added.
- Preserved date-only Body evidence as `local_date` with null `measuredAt`,
  stable workbook/sheet/`Measurement_ID` provenance, partial typed metric
  sessions, private Notes/Source, and blocking Photo references.
- Added typed relational Body import audit and schema-v2 domain-minimal private
  snapshots while retaining schema-v1 Weight compatibility.
- Completed a Body-only exact-workbook read and staging read-only dry-run with
  `created=0`, `unchanged=0`, `conflict=0`, `invalid=0`; the authoritative Body
  sheet contained no data rows. No apply, Sheets write, deployment, cutover, or
  authority transfer occurred.

### 2026-08-24 — Controlled staging Weight apply

- Applied one clean bounded Weight manifest through the existing unified
  transactional importer, creating 20 missing facts with relational provenance
  and typed import audit; no existing fact was overwritten.
- Verified idempotency immediately against the identical manifest:
  `created=0`, `unchanged=20`, `conflict=0`, `invalid=0`.
- Removed the private snapshot and SSH tunnel after verification. Google Sheets
  remains authoritative; no Sheets write, recurring automation, cutover, or
  authority transfer occurred.

### 2026-08-23 — Local controlled Weight dry-run input

- Replaced the unused staging importer profile and credential plumbing with a
  local operator-run path through the existing unified importer.
- Added a versioned, bounded private snapshot envelope with canonical checksum,
  exact workbook metadata, mode `0600`, no-overwrite behavior, and strict
  symlink, size, row, and cell validation.
- Kept connector authentication outside the backend: Codex reads the exact
  workbook through the connected operator account and the API receives only
  the ephemeral snapshot. Staging deployment receives no Google credential.
- Google Sheets writes, PostgreSQL `apply`, recurring dual-run, cutover, and
  authority transfer remain separately gated.
- Completed the first bounded live Sheets-to-staging PostgreSQL dry-run through
  the official read-only target reader: `created=20`, `unchanged=0`,
  `conflict=0`, `invalid=0`. The private snapshot and SSH tunnel were removed
  immediately afterwards.

### 2026-08-23 — Unified Fitness Tracker importer and Weight apply

- Added one `fitness-tracker:import --domain weight --mode dry-run|apply`
  command and reusable PostgreSQL apply lifecycle; future domains plug in typed
  adapters instead of receiving separate migrators.
- Added relational import batches and typed Weight audit records, exact
  provenance batch links, advisory locking, target re-read, atomic rollback,
  exact blocked retry, and concurrent duplicate protection.
- Added explicit Weight `instant|local_date` precision. Existing and public
  create/correct facts remain exact instants; imported date-only facts expose a
  null `measuredAt` without synthetic midnight.
- Apply writes no Google Sheets data, blocks every fact write on any conflict or
  invalid row, and never overwrites an existing fact. Real-data execution,
  recurring dual-run, cutover, and authority transfer remain separately gated.

### 2026-08-21 — Controlled Weight import dry-run

- Added a shared typed import dry-run kernel and Weight adapter inside the API,
  with no writer port, persisted import state, new deployable, schema change,
  or generic JSON fact model.
- Added exact-workbook Google Sheets reads through a dedicated API-owned service
  identity, `spreadsheets.readonly`, bounded `Weight`/`Daily_Log` ranges, and
  metadata-derived sheet IDs; runtime secrets remain outside Git.
- Preserved spreadsheet/sheet/date source identity separately from content
  checksum, retained date-only `local_date` precision, and classified results
  as `created`, `unchanged`, `conflict`, or `invalid` without overwrites.
- Added Weight authority/mirror reconciliation, deterministic safe reporting,
  private no-overwrite reports with mode `0600`, and PostgreSQL comparison in
  `BEGIN READ ONLY` transactions with zero-write integration evidence.
- Kept Google Sheets and the separate ChatGPT fitness project authoritative;
  live credential execution, apply/backfill, Recovery/Garmin MCP coverage,
  recurring dual-run, cutover, and rollback execution remain separately gated.

### 2026-08-18 — Progress overview and dated day drill-down

- Made `/progress` the authenticated landing and OAuth default while
  preserving signed same-origin return to explicitly requested protected
  routes.
- Added week/month/year factual progress with a selectable accessible sparse
  chart, explicit **No entries** behavior, newest-first factual dates, and
  canonical `/days/:localDate?timezone=...` drill-down.
- Added one API `GET /v1/progress-overview` read model bounded to 366 inclusive
  local dates and constant-count module-owned range reads; missing facts remain
  gaps rather than synthetic zeros.
- Preserved `/day` compatibility through safe replacement, kept `DayClosure`
  strictly per-day, and added no database, migration, cache, deployable, broad
  `DayRecord`, or cross-service SQL.

### 2026-08-18 — Russian ADR approval language

- Changed the documentation language boundary so new or substantively changed
  ADRs and plans are written in Russian for direct operator approval.
- Kept canonical Wiki pages, guides, READMEs, runbooks, and `AGENTS.md` in
  English and preserved exact technical identifiers in Russian artifacts.
- Kept historical accepted ADRs unchanged instead of creating translated
  mirrors or a second source of truth.

### 2026-08-17 — Safe browser return routes and session-aware navigation

- Changed successful browser OAuth to open `/day` by default and restore only
  a validated same-origin path and query bound to the signed HttpOnly OAuth
  transaction.
- Added an empty, non-cacheable `204/401` API session-presence contract so the
  static landing page can show **Open my day** without receiving credentials or
  Person authorization details.
- Added reusable protected-route reauthentication, responsive content-sized
  `/day` layout, and browser coverage for default login, authenticated landing
  revisit, session loss, and exact protected-route restoration.
- Preserved the static Nuxt delivery, API/Identity ownership boundary, MCP
  bearer contract, Person mapping, schemas, and deployable topology.

### 2026-08-17 — Stable OAuth identity and full browser acceptance

- Added an API-owned operational CLI for explicit Person-access bootstrap and
  lifecycle changes outside build and deployment flows.
- Reused the sole active real Person during bootstrap and retained fail-closed
  handling for revoked or ambiguous state.
- Standardized ID-token, access-token, and API mapping identity on the immutable
  Identity account UUID used as OAuth `sub`.
- Added a disposable HTTPS browser acceptance path with separate databases,
  ephemeral keys, virtual WebAuthn, real OAuth redirects/code exchange, the
  API-owned session cookie, and an authorized daily projection read.
- Added a credential-free access-required page for authenticated accounts that
  have not been authorized to a Person.

### 2026-08-12 — Versioned Person-local daily closures

- Added API-owned versioned `DayClosure` snapshots for an explicit local date
  and IANA timezone without introducing a broad `DayRecord` or mutable
  `JournalDay` aggregate.
- Open daily reads are composed live through module-owned application services;
  closed reads return the immutable snapshot and become stale when current
  evidence differs.
- Added idempotent close/reopen commands, typed immutable fact/decision
  manifests, append-only reclose history, API contracts, OpenAPI, clean and
  upgrade migration checks, and lifecycle integration coverage.
- No scheduler, new deployable, cross-service SQL, frontend UI, or automatic
  midnight closure was added.

### 2026-08-11 — Deployment-managed predefined OAuth clients

- Added a typed, versioned Identity manifest for reserved OAuth client policy
  while keeping the exact ChatGPT callback in validated staging Environment
  configuration.
- Added transactional `created`/`updated`/`unchanged` reconciliation after
  Identity migrations and before runtime replacement, with timestamp-stable
  repeats, reserved-ID protection, and fail-closed referenced-scope drift.
- Added schema-plus-client automatic rollback compatibility and executable
  controller, injection, concurrency, grant-preservation, and rollback gates.
- GitHub Environment configuration and the first staging reconciliation remain
  separate operational approvals.

### 2026-08-11 — Durable OAuth connections for external clients

- Added the standard OIDC `offline_access` contract to Identity discovery and
  exact administrator-managed client allowlists while retaining ten-minute
  audience-bound access tokens and rotating refresh-token families.
- Kept `openid` and `offline_access` in typed OIDC grant scopes and kept MCP
  resource permissions separate in protected-resource metadata, grants, and
  access tokens.
- Added expiry-boundary refresh, MCP read, reuse rejection, concurrent
  revocation, exactly-once security audit, and bounded-pool regression coverage.
- ChatGPT connection recreation and the external expiry-boundary verification
  remain separately gated.

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
