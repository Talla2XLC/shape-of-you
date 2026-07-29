---
id: "decisions-20260729-use-verified-main-for-staging-deployment-control"
kind: adr
title: "Проверяемый main как источник staging deployment-control"
status: accepted
date: 2026-07-29
supersedes: "decisions-20260729-use-dedicated-staging-deployment-identity"
superseded_by: null
tags:
  - "deployment"
  - "security"
  - "github-actions"
---

# Проверяемый main как источник staging deployment-control

## Контекст

Static root-owned Compose/scripts исключали подмену privileged code со стороны
GitHub Actions, но требовали ручной установки на VM после каждого исправления
deployment-control. Для staging это создаёт ненужную операционную нагрузку.

## Решение

Root-owned wrapper и единственный `sudoers` rule остаются неизменяемой
privilege boundary. При каждом approved deployment wrapper принимает
`CONTROL_SHA`, fetch-ит только `origin/main` публичного repository, требует
точного совпадения SHA с fetched head и checkout-ит root-owned control tree в
`/opt/shape-of-you/staging/control`. Только из этого tree запускаются Compose
file и deployment scripts.

GitHub Actions не передаёт scripts, Compose file или shell fragments. Пользователь
`shape-deploy` по-прежнему не получает Docker group и может вызвать только
wrapper без аргументов. Manual Environment approval становится подтверждением
доверия к текущему `main` как к privileged deployment-control source.

## Последствия

После однократного обновления wrapper изменение deployment-control больше не
требует SSH-copy на VM. Компрометация права push в `main` становится риском
root-level deployment control при следующем ручном approved deployment;
следовательно, branch protection и review для `main` обязательны до production.

## Рассмотренные альтернативы

- Оставить Compose/scripts static и обновлять их вручную. Отклонено: простой
  bugfix требует SSH maintenance и тормозит staging delivery.
- Дать GitHub Actions Docker group, shell sudo или SCP writable scripts.
  Отклонено: это разрушает ограниченную privilege boundary.
- Добавить self-hosted runner. Отложено: он создаёт постоянный privileged
  agent и не нужен для текущего масштаба.

## Проверка

- Wrapper отклоняет неизвестный, повторный, некорректный или не совпадающий с
  fetched `origin/main` `CONTROL_SHA` до Docker/migration действий.
- Root-owned control checkout и wrapper недоступны на запись `shape-deploy`.
- Workflow передаёт только structured input и не использует SCP или remote
  arbitrary shell.
- Первая установка обновлённого wrapper выполняется оператором; последующие
  изменения Compose/scripts проверяются в обычном approved deployment.

## Связанные материалы

- [Выделенная deployment identity](20260729-use-dedicated-staging-deployment-identity.md)
- [Deployment topology](../wiki/architecture/deployment.md)
