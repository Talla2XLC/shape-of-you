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

## IDE-Visible Primary Working Tree

- Make every source-code, test, plan, ADR, and canonical documentation change
  directly in `/Users/MmM/WebstormProjects/shape-of-you`, which is the primary
  working tree opened by the operator in the IDE.
- Do not implement or retain project changes in `.codex/worktrees/**` or any
  other hidden or secondary Git worktree.
- If a Codex session starts in a generated secondary worktree, stop before the
  first write and switch all repository operations to the primary working
  tree.
- The operator must be able to inspect every live change in the primary IDE
  Git tree throughout implementation.

## Session Start

At the start of a session, use the installed 4DreamTeam wrappers to:

1. run `4dt-memory doctor` and load contract defaults;
2. restore pending wake context without dumping all memory;
3. check `4dt-board`, `4dt-sources`, and the local 4DreamTeam storage;
4. run `node scripts/validate-docs.mjs` before using canonical documentation;
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

  `node scripts/validate-docs.mjs`
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
- Write plans and canonical ADRs in Russian so the operator can review and
  approve decisions directly. Write canonical Wiki pages, guides, READMEs,
  general templates, and other agent-facing documentation in English. The ADR
  template is the intentional Russian-language exception.
- Preserve technical names, API names, commands, paths, IDs, frontmatter keys,
  controlled enum values, and validator-required ADR section headings when
  translation would change the contract.

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
- Statically reject generated PostgreSQL identifiers longer than 63 UTF-8
  bytes. PostgreSQL silently truncates overlong identifiers, so successful
  migration execution alone is not sufficient validation.
- Staging, commits, pushes, tags, releases, deployments, migrations,
  destructive actions, production access, and secret access require the
  corresponding explicit approvals.
- When asking the operator to create a Git commit or push changes, always
  propose a concise Conventional Commit message suitable for the current diff.
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

After the accepted TASK-0067 authority transfer, staging PostgreSQL through the
`Shape of You Staging` MCP contract is the operational authority. The
`Fitness Tracker` workbook is a non-authoritative frozen legacy source for
approved historical or rollback reads:

- spreadsheet ID:
  `1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik`;
- direct URL:
  `https://docs.google.com/spreadsheets/d/1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik/edit`;
- use the exact URL or spreadsheet ID for approved Google Sheets connector
  reads;
- do not treat a failed Drive title search as evidence that access is missing;
- keep the workbook read-only; a Google Sheets write requires a separately
  approved rollback operation, and archive/read-only ACL changes require their
  own explicit approval.

Canonical migration context and authority rules remain in
`docs/wiki/data/google-sheets-inventory.md` and related ADR/Wiki pages.

With explicit operator approval for a named host and purpose, DevOps may invoke
an existing operator-managed OpenSSH profile from `~/.ssh/config`. Do not read,
copy, print, or store private-key or SSH configuration contents; use strict
host-key checking. Otherwise, use workspace-managed SSH material only when the
task explicitly requires it.

## Language and Communication

Write all plans and canonical ADRs in Russian.

Write canonical Wiki pages, guides, READMEs, general templates, runbooks,
onboarding material, and other agent-facing or repository documentation in
English. The ADR template follows the Russian ADR language. Write all
`AGENTS.md` files in English. Keep validator-required ADR section headings in
English as structural keys while writing ADR titles and prose in Russian.

Communicate with the operator in the operator's language. User-facing statuses,
comparisons, questions, and decision summaries are currently written in
Russian.

Preserve stable technical identifiers, paths, commands, API names, frontmatter
keys, controlled values, and contract terms exactly. Localized application
strings and realistic test fixtures may use the language required by their
product scenario; they are not documentation.
