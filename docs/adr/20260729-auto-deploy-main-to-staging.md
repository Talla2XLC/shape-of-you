---
id: "decisions-20260729-auto-deploy-main-to-staging"
kind: adr
title: "Автоматический deployment main в staging"
status: accepted
date: 2026-07-29
supersedes: null
superseded_by: null
tags:
  - "deployment"
  - "staging"
  - "github-actions"
---

# Автоматический deployment main в staging

## Контекст

Staging содержит только synthetic data, а ручной запуск deployment после
каждой успешной публикации immutable images создаёт ненужный операторский шаг.
Нужна непрерывная доставка текущего `main` без ручного переноса digests.

## Решение

Push в `main` запускает quality, публикует API и edge images и автоматически
вызывает reusable `Deploy staging` с полученными digests. Deploy job остаётся
serialized и не отменяет активную migration. Manual dispatch сохраняется для
targeted retry и rollback. До появления отдельной ветки staging `main` является
единственным trigger branch; смена на `staging` не меняет topology или
privilege boundary.

## Рассмотренные альтернативы

- Оставить manual deployment. Отклонено: для throwaway staging это не даёт
  ценного approval gate и создаёт повторяемую ручную работу.
- Отменять активный deployment при новом push. Отклонено: прерывание migration
  опаснее доставки устаревшего release в serial queue.
- Trigger через отдельный `workflow_run`. Отложено: он усложняет безопасную
  передачу immutable digests без текущей потребности.

## Последствия

Каждый успешный `main` может изменить staging. Поэтому real data, public
registration и production usage остаются запрещены. Environment `staging`
продолжает хранить secrets; workflow не получает broad VM privileges.

## Проверка

- Один push в `main` создаёт quality, publish и deploy в одном workflow chain.
- Deploy получает digests только из outputs publish jobs.
- PR запускает CI без deployment.
- Manual dispatch `Deploy staging` доступен для recovery.

## Связанные материалы

- [Временный deployment на общей VM](20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
- [Deployment topology](../wiki/architecture/deployment.md)
