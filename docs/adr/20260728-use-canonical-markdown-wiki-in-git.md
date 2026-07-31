---
id: decisions-20260728-use-canonical-markdown-wiki-in-git
kind: adr
title: "Каноническая Markdown Wiki в Git"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - documentation
  - git
  - wiki
---

# Каноническая Markdown Wiki в Git

## Контекст

Managed Wiki в 4DreamTeam v0.5.8 хранит авторитетное содержимое в общей базе SQLite. Чтобы надёжно сделать его видимым в Git через generated export, потребовались бы renderer, manifest, hashes, stale checking, переписывание путей, rebuild logic и отдельное резервное копирование базы.

Текущая Wiki невелика. Проекту важны человекочитаемый архитектурный review, переносимость и единственный источник истины.

## Решение

Использовать обычный канонический Markdown:

- `docs/wiki/**/*.md` — единственный authority для Wiki;
- `docs/adr/**/*.md` — единственный authority для ADR;
- агенты изменяют эти файлы обычными инструментами репозитория;
- 4DreamTeam продолжает использоваться для board, memory, sources, workflow, quality и release gates;
- существующие страницы managed Wiki могут физически оставаться в SQLite только как frozen legacy copy и не используются для discovery, чтения, записи или архитектурных решений;
- generated mirrors и два равноправных источника истины запрещены;
- `docs/` не регистрируется в `4dt-sources`, а `sources/` сохраняется как runtime boundary для отдельно одобренных исходных материалов.

При текущем объёме достаточно Git, поиска IDE и `rg`; отдельный индекс Wiki и backend MarkdownStore не нужны.

## Рассмотренные альтернативы

- SQLite-first с generated Markdown отклонён из-за второго представления и существенной инфраструктуры синхронизации.
- Markdown-first backend для `4dt-wiki` отложен: в установленной версии нет storage interface или plugin mechanism, поэтому потребовалось бы изменение upstream либо fork.
- Полная замена 4DreamTeam отклонена как ненужная.

## Последствия

- Изменения Wiki и ADR видны в Git diff, blame и review.
- Специфичные для managed Wiki возможности Workspace View и семантика `4dt-search` недоступны для canonical documentation.
- Небольшой репозиторный validator заменяет `4dt-wiki validate` для документации.
- Workspace policy запрещает ролям использовать managed Wiki как источник проектных знаний.
- Frozen legacy copy не является вторым источником истины и может быть изменена только по явному решению оператора для конкретной операции и scope.
- Если будущая версия 4DreamTeam нативно поддержит этот workflow, лишние workspace overrides следует удалить.

## Проверка

- Каждая canonical page проходит `node scripts/validate-docs.mjs`.
- Board, memory и sources остаются работоспособны.
- Discovery, чтение и запись проектных знаний направлены только в `docs/wiki` и `docs/adr`.
- `docs/` не зарегистрирован в `4dt-sources`.

## Связанные материалы

- [Руководство по документации](../README.md)
- [Репозиторий и runtime](../wiki/architecture/repository-and-runtime.md)
- [Правила workspace](../../AGENTS.md)
