---
id: "architecture-repository-and-runtime"
kind: architecture
title: "Репозиторий и runtime"
status: draft
tags:
  - "architecture"
  - "runtime"
---

# Репозиторий и runtime

## Кратко

Репозиторий является modular monorepo; совместное размещение не означает runtime coupling или преждевременную декомпозицию на сервисы.

## Содержание

### Модель репозитория

Единый корень Git-репозитория и workspace 4DreamTeam — `D:/Projects/shape-of-you`. Канонические проектные знания хранятся в `docs/wiki/`, архитектурные решения — в `docs/adr/`, планы — в `plans/YYYY/MM/`. Реализация использует pnpm workspace: deployable API находится в `apps/api`, а реально используемые transport contracts и runtime config — в `packages/contracts` и `packages/config`.

### Хранение документации

Канонические Wiki и ADR — обычный Markdown в Git. 4DreamTeam отвечает за board, memory, sources и workflow state, но managed Wiki не используется как content store этого workspace. Read-only validator репозитория проверяет форму документов; renderer, synchronization pipeline и search index не вводятся.

### Границы зависимостей

Deployable services не должны напрямую зависеть друг от друга через `package.json` или workspace dependency. Повторное использование cross-cutting кода допускается только через явные shared packages — например contracts, observability, configuration и testing — после review владения и направления зависимостей.

### Артефакты runtime

Полная копия монорепозитория используется как Docker build context, но runtime запускает только собранный `apps/api` и его транзитивные dependencies. API имеет собственные `Dockerfile`, `package.json`, `AGENTS.md`, Drizzle migrations и integration tests.

### Начальная позиция по deployment

Modular monorepo не требует microservices. DEV-023 реализован как один Fastify backend с одной PostgreSQL database. Новая deployable boundary требует конкретного driver — масштабирования, владения, изоляции или независимого release — и отдельного ADR.

Для временного staging утверждён deployment на общей VM: OCI images собираются
в GitHub Actions, публикуются в GHCR и запускаются отдельным Compose project.
Собственный nginx проекта является deployment adapter и даёт единую точку
входа для web и API, не создавая новую domain boundary. Подробности и
ограничения описаны на странице [Deployment topology](deployment.md).

## Основания

- Ограничения репозитория и runtime, предоставленные оператором.
- ADR по modular monorepo и автономности сервисов.

## Решения

- Текущая topology утверждена как один deployable backend; декомпозиция на несколько сервисов не утверждена.
- Canonical Markdown — единственный source of truth проектных знаний.

## Открытые вопросы

- Границы следующих модулей внутри текущего backend после review bounded contexts.
- Целевая cloud topology после выхода из временного staging.
- Authentication, authorization, TLS и измеримые SLO до реальных пользователей.

## Связанные материалы

- [Bounded contexts](../domain/bounded-contexts.md)
- [Архитектурные drivers](drivers.md)
- [ADR о modular monorepo](../../adr/20260728-modular-monorepo.md)
- [ADR об автономности deployable service](../../adr/20260728-deployable-service-autonomy.md)
- [ADR о canonical Markdown Wiki](../../adr/20260728-use-canonical-markdown-wiki-in-git.md)
- [ADR о временном deployment](../../adr/20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
