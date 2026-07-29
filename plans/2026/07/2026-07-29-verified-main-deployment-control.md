---
id: "plan-20260729-verified-main-deployment-control"
kind: plan
title: "Автоматическое обновление staging deployment-control"
status: active
date: 2026-07-29
owner: "4DreamTeam"
related_adrs:
  - "decisions-20260729-use-verified-main-for-staging-deployment-control"
---

# Автоматическое обновление staging deployment-control

## Цель

Сохранить ограниченный `shape-deploy` privilege boundary, но устранить ручное
копирование Compose/scripts на VM при каждом изменении deployment-control.

## Реализация

Wrapper принимает и валидирует `CONTROL_SHA`, fetch-ит `origin/main`, требует
совпадения SHA с fetched head и выполняет только root-owned checkout. Workflow
передаёт текущий `GITHUB_SHA`. Однократная установка обновлённого wrapper на VM
остаётся operator gate; дальнейшие изменения control files приезжают через
approved deployment.

## Проверка

- Некорректный, устаревший или не принадлежащий текущему `main` `CONTROL_SHA`
  отклоняется до Docker/migration действий.
- Workflow не передаёт writable deployment files.
- `shape-deploy` не получает дополнительных sudo или Docker privileges.
- Перед завершением выполняются shell syntax, workflow/static checks,
  documentation validation и независимый quality review.
