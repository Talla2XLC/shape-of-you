---
id: "decisions-20260818-use-russian-for-adrs-and-plans"
kind: adr
title: "Использовать русский язык для ADR и планов"
status: accepted
date: 2026-08-18
supersedes: ["decisions-20260802-use-english-for-canonical-documentation-and-russian-for-plans"]
superseded_by: null
tags:
  - "documentation"
  - "language"
---

# Использовать русский язык для ADR и планов

## Context

Canonical Wiki, ADR, guides и другие agent-facing документы ранее были
переведены на английский для единообразного поиска и работы coding agents.
Планы остались на русском, потому что оператор непосредственно проверяет и
утверждает их.

ADR проходят такой же operator approval gate, как планы. Англоязычный ADR
вынуждает оператора согласовывать архитектурное решение не на рабочем языке и
создаёт риск утвердить неточно понятую формулировку. При этом Wiki и guides
прежде всего служат current-state knowledge для агентов и сохраняют пользу от
единого английского технического корпуса.

## Decision

Новые и содержательно изменяемые canonical ADR в `docs/adr/**/*.md` пишутся на
русском языке. Планы в `plans/**/*.md` также пишутся на русском.

Canonical Wiki pages, guides, READMEs, runbooks, onboarding material,
`AGENTS.md` и другие agent-facing repository documents остаются на английском.
ADR template является намеренным русскоязычным исключением среди templates.

Исторические accepted ADR не переводятся массово: они остаются неизменной
decision history до тех пор, пока конкретное решение не требует superseding или
содержательного обновления. Новый или superseding ADR на русском связывается с
ними обычными stable IDs и Markdown links.

Technical identifiers не переводятся: paths, IDs, frontmatter keys,
controlled values, commands, API names, enum values, database objects и code
symbols сохраняют точное написание. Validator-required ADR section headings
также остаются английскими structural keys; title и весь decision prose пишутся
по-русски. Operator-facing communication остаётся на языке оператора, сейчас
русском.

## Considered alternatives

- **Сохранить английский для Wiki и ADR, русский только для планов:** удобно
  для agent retrieval, но не даёт оператору надёжно согласовывать ADR на рабочем
  языке. Отклонено.
- **Перевести всю canonical документацию на русский:** упрощает operator review,
  но ухудшает единообразие agent-facing knowledge и технический поиск.
  Отклонено.
- **Хранить параллельные русскую и английскую версии ADR:** обслуживает обе
  аудитории, но создаёт два источника истины и постоянную синхронизацию.
  Отклонено.
- **Оставить Wiki/guides на английском, а ADR и планы писать на русском:**
  сохраняет один source of truth, удобный operator approval и стабильный
  agent-facing current-state корпус. Выбрано.

## Consequences

- Оператор читает и утверждает architecture decisions и execution plans на
  одном рабочем языке.
- Агенты продолжают получать current-state Wiki и operational guides на
  английском.
- В repository допустима намеренная языковая граница по назначению artifact, но
  не параллельные переводы одного документа.
- Новые ADR должны сохранять exact technical identifiers внутри русского
  текста.
- Existing historical ADR остаются английскими и не создают массовый шумный
  diff.

## Verification

- Root `AGENTS.md` явно требует русский язык для ADR и планов и английский для
  Wiki/guides/`AGENTS.md`.
- `docs/templates/adr.md` содержит русскоязычную структуру ADR.
- Новые или содержательно изменённые ADR написаны по-русски без перевода stable
  identifiers, controlled values и validator-required section headings.
- Параллельные translated mirrors не создаются.
- `node scripts/validate-docs.mjs` проходит.

## Related material

- [Предыдущее языковое решение](20260802-use-english-for-canonical-documentation-and-russian-for-plans.md)
- [Canonical Markdown Wiki](20260728-use-canonical-markdown-wiki-in-git.md)
- [Documentation guide](../README.md)
- [Workspace rules](../../AGENTS.md)
