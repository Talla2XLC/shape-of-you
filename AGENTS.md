# Shape of You — Workspace Rules

## Workspace

This directory is both:

- the single `4DreamTeam` workspace for Shape of You;
- the root of the Shape of You Git modular monorepo.

Do not create `sources/shape-of-you` or another nested project root.
Product, architecture, delivery, quality, and release work is performed through
the installed `$4DreamTeam` workflow and its managed tools. Canonical Wiki and
ADR documents are ordinary Markdown files in the repository and follow the
rules below.

## Session Start

At the start of a session, use the installed 4DreamTeam wrappers to:

1. run `4dt-memory doctor` and load contract defaults;
2. restore pending wake context without dumping all memory;
3. check `4dt-board`, `4dt-sources`, and the local 4DreamTeam storage;
4. run `scripts/validate-docs.ps1` before using canonical documentation;
5. report degraded state instead of inventing missing context.

The board, source registry, memory, and workflow state are managed by tools.
Do not edit their internal storage directly.

## Canonical Wiki and ADR

- `docs/wiki/**/*.md` is the only source of truth for current Wiki knowledge.
- `docs/adr/**/*.md` is the only source of truth for architecture decisions.
- Edit canonical pages with ordinary repository file tools.
- Every agent and workflow uses canonical Markdown as the source of project
  knowledge.
- The managed 4DreamTeam Wiki is a frozen legacy copy.
- Do not use the managed Wiki for discovery, reading, or writing project
  documentation or architecture decisions.
- An exception requires an explicit operator decision for the specific
  operation and scope.
- Do not register `docs/` in `4dt-sources`. The `sources/` directory remains
  the built-in runtime boundary for separately approved source materials.
- If a future 4DreamTeam version supports this workflow natively, remove
  redundant workspace overrides instead of preserving them.
- Do not create generated Wiki mirrors, synchronization pipelines, manifests,
  or a second documentation source of truth.
- Use templates from `docs/templates/` and preserve required metadata,
  statuses, and sections.
- Before a commit, release, or completion of a major task, run:

  `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-docs.ps1`

  In PowerShell 7, `pwsh -NoProfile -File` may be used.
- Architecture changes must be visible in the Git diff: update an ADR and only
  the affected current-state Wiki pages.
- Wiki pages describe the current state concisely and link to ADRs without
  copying the full decision history. Plans describe execution and do not
  duplicate architecture authority.

## Architecture-First Rules

- This is a long-term production project.
- Do not write implementation code before explicit architecture approval.
- Design every new entity before creating or implementing it.
- Discuss every architecture change before applying it.
- Compare alternatives before making a debatable decision.
- If changing a decision within a year could be expensive, present alternatives
  and trade-offs before approval.
- Record every architecture decision as a canonical ADR in `docs/adr/`.
- Write plans, canonical Wiki pages, ADRs, and guides in Russian.
- Preserve technical names, API names, commands, paths, IDs, frontmatter keys,
  and controlled enum values when translation would change the contract.

## Planning

- Keep active plans in `plans/YYYY/MM/`.
- After completion, move a plan to the corresponding `completed/` directory.
- Create and maintain all plans in Russian.
- A plan authorizes only its stated scope and does not override architecture,
  quality, safety, or approval gates.

## Monorepo and Service Boundaries

The project starts as a modular monorepo.

Every deployable service must have:

- its own `Dockerfile`;
- its own `package.json`;
- its own `AGENTS.md`;
- its own database;
- its own migrations;
- its own credentials;
- its own integration tests.

Cross-service SQL is forbidden. Services communicate only through APIs or
events. Database, credential, migration, and integration-test ownership
boundaries must not be implicitly shared between deployable services.

## Code Documentation

- Write concise English TSDoc for exported functions, classes, interfaces, and
  types that form a module contract.
- Document purpose, parameters, return values, thrown errors, ownership, and
  non-obvious invariants when they are relevant to correct use.
- Do not add comments that merely repeat the implementation. Obvious private
  helpers do not require documentation.
- Update TSDoc when the documented contract changes.

## Delivery Gates

- Architecture and ADR approval precede implementation.
- Implementation requires an approved plan.
- Independent quality review follows developer work.
- Every major task receives an Architecture Review before completion.
- Before completion, verify accepted changes against canonical Wiki and ADR
  documents.
- Staging, commits, pushes, tags, releases, deployments, migrations,
  destructive actions, production access, and secret access require the
  corresponding explicit approvals.
- Never disclose credentials, private keys, tokens, `.env` contents, dumps, or
  production data in chat, documentation, plans, reports, or commits.

## Architecture Review

A task is major when it materially affects product scope, the domain model,
bounded contexts, service or module boundaries, data ownership, public
contracts, integrations, deployment topology, or another decision with a high
cost of change.

Before completing a major task, check and record:

1. whether the solution contains unnecessary complexity;
2. whether it introduces premature microservices or deployable boundaries;
3. whether Domain-Driven Design and the approved domain model are preserved;
4. whether information is duplicated across Wiki pages, ADRs, plans, task
   timelines, or other sources of truth;
5. whether the solution can be simplified without losing required scalability.

If the review finds a better solution, present it first and explain the
trade-offs. Do not change architecture silently. Architecture Review does not
replace an ADR: an accepted architecture change still requires a new or
superseding ADR.

## Source Boundaries

The workspace `sources/` directory is only a staging area for approved
materials, not the project root. Register external paths through `4dt-sources`
with operator approval. Do not read secrets or unrelated files.

## Language and Communication

Write plans, canonical Wiki pages, ADRs, guides, user-facing statuses,
comparisons, questions, and decision summaries in Russian. This includes
implementation plans, operational guides, onboarding guides, runbooks, and
other human-facing documentation.

Write all `AGENTS.md` files in English.

Stable technical identifiers and contract terms may remain in English.
