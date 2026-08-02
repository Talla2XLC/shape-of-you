---
id: decisions-20260728-use-canonical-markdown-wiki-in-git
kind: adr
title: "Use a canonical Markdown Wiki in Git"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - documentation
  - git
  - wiki
---

# Use a canonical Markdown Wiki in Git

## Context

The managed Wiki in 4DreamTeam v0.5.8 stores authority in shared SQLite. A
reliable generated Git export would require a renderer, manifest, hashes,
staleness checks, path rewriting, rebuild logic, and separate database backup.

The current Wiki is small. The project values readable architecture review,
portability, and one source of truth.

## Decision

Use ordinary canonical Markdown:

- `docs/wiki/**/*.md` is the only Wiki authority;
- `docs/adr/**/*.md` is the only ADR authority;
- agents edit these files through normal repository tools;
- 4DreamTeam continues to manage board, memory, sources, workflow, quality,
  and release gates;
- existing managed Wiki pages may remain in SQLite only as a frozen legacy
  copy and are not used for discovery, reading, writing, or decisions;
- generated mirrors and two equal sources of truth are forbidden;
- `docs/` is not registered in `4dt-sources`; `sources/` remains the runtime
  boundary for separately approved material.

Git, IDE search, and `rg` are sufficient at the current scale; a separate Wiki
index and MarkdownStore backend are unnecessary.

## Considered alternatives

- SQLite-first with generated Markdown: rejected because it introduces a
  second representation and substantial synchronization infrastructure.
- A Markdown-first `4dt-wiki` backend: deferred because the installed version
  has no storage interface or plugin mechanism and would require upstream work
  or a fork.
- Replace 4DreamTeam entirely: rejected as unnecessary.

## Consequences

- Wiki and ADR changes are visible in Git diff, blame, and review.
- Managed-Wiki-specific Workspace View and `4dt-search` semantics do not apply
  to canonical documentation.
- A small repository validator replaces `4dt-wiki validate` for these files.
- Workspace policy forbids using the managed Wiki as project knowledge.
- The frozen legacy copy is not a second authority and changes only through a
  specific operator decision.
- If a future 4DreamTeam version supports this workflow natively, redundant
  workspace overrides should be removed.

## Verification

- Every canonical page passes `node scripts/validate-docs.mjs`.
- Board, memory, and sources remain operational.
- Project knowledge discovery, reading, and writing use only `docs/wiki` and
  `docs/adr`.
- `docs/` is not registered in `4dt-sources`.

## Related material

- [Documentation guide](../README.md)
- [Repository and runtime](../wiki/architecture/repository-and-runtime.md)
- [Workspace rules](../../AGENTS.md)
