---
id: "decisions-20260728-use-nodejs-typescript-and-pnpm-workspaces"
kind: adr
title: "Node.js, TypeScript и pnpm workspaces"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "monorepo"
  - "technology"
---

# Node.js, TypeScript и pnpm workspaces

## Контекст

Проекту нужна единая поддерживаемая языковая и workspace-модель для backend, web-facing packages, shared contracts и tooling в modular monorepo.

## Решение

Использовать Node.js, TypeScript и pnpm workspaces как начальный стек разработки приложений.

Это решение не требует, чтобы каждый будущий компонент использовал Node.js, если последующее ADR обоснует конкретную другую потребность.

## Рассмотренные альтернативы

- Несколько языков приложений: больше специализации, но выше операционная и когнитивная стоимость до появления доменных границ, оправдывающих такое решение.
- npm или Yarn workspaces: жизнеспособны, но pnpm выбран из-за поддержки workspaces и изоляции зависимостей.

## Последствия

Repository tooling и application packages используют общие соглашения TypeScript. Версии Node.js и TypeScript, а также инструменты build, lint, test и monorepo orchestration пока не определены.

Само ADR не создаёт package manifests.

## Проверка

- Решение явно принято оператором 2026-07-28.
- Package manifests в рамках этого решения не создаются.

## Связанные материалы

- `../wiki/architecture/drivers.md`
- `../wiki/architecture/repository-and-runtime.md`
