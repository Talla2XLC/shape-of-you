---
id: "decisions-20260802-use-english-for-canonical-documentation-and-russian-for-plans"
kind: adr
title: "Use English for canonical documentation and Russian for plans"
status: accepted
date: 2026-08-02
supersedes: []
superseded_by: null
tags:
  - "documentation"
  - "language"
---

# Use English for canonical documentation and Russian for plans

## Context

The project is maintained primarily through coding agents. Canonical Wiki and
ADR pages were initially written in Russian while source code, technical
identifiers, framework documentation, and most agent operating contracts use
English. This created mixed-language pages, increased ambiguity around domain
terms, and made retrieval and cross-reference work less consistent for agents.

Plans serve a different purpose: they are reviewed directly with the Russian-
speaking operator and benefit from remaining in the operator's working
language.

## Decision

Canonical Wiki pages, ADRs, READMEs, guides, templates, runbooks, onboarding
material, and other agent-facing repository documentation are written in
English.

Plans under `plans/**/*.md` are written in Russian. Operator-facing
collaboration follows the operator's language and is currently Russian.

Stable identifiers and contracts are never translated: paths, IDs,
frontmatter keys, controlled values, commands, API names, enum values, database
objects, and code symbols retain their exact spelling. Localized application
strings and realistic localized test fixtures are not documentation and may
remain in the language required by their product scenario.

Existing canonical documentation is translated without changing architectural
decisions, authority, status, links, or implementation claims.

## Considered alternatives

- Keep all project documentation in Russian: convenient for operator review,
  but preserves mixed terminology and adds friction for agent retrieval and
  technical maintenance. Rejected.
- Use English for every artifact, including plans and operator communication:
  maximizes uniformity but makes planning and approval less natural for the
  operator. Rejected.
- Maintain parallel Russian and English documentation: serves both audiences
  but creates duplicate sources of truth and synchronization work. Rejected.
- Use English canonical documentation with Russian plans and collaboration:
  keeps one technical source of truth while preserving a natural approval
  workflow. Selected.

## Consequences

- Agents work from a consistent English technical knowledge base.
- Plans remain easy for the operator to review and approve.
- No translated mirror or second documentation authority is introduced.
- Documentation reviews must distinguish localized product/test content from
  repository documentation.
- Historical board timeline entries are not rewritten; they remain immutable
  workflow evidence in the language used when created.

## Verification

- Canonical Wiki and ADR files contain no Russian prose.
- Repository READMEs, guides, templates, and `AGENTS.md` language rules are in
  English.
- Plans remain in Russian.
- `node scripts/validate-docs.mjs` and documentation tests pass.
- Stable IDs, links, commands, paths, and controlled values remain valid.

## Related material

- [Canonical Markdown Wiki in Git](20260728-use-canonical-markdown-wiki-in-git.md)
- [Documentation guide](../README.md)
- [Workspace rules](../../AGENTS.md)
- [Migration plan](../../plans/2026/08/completed/2026-08-02-translate-canonical-documentation-to-english.md)
