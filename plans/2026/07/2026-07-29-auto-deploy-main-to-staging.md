---
id: "plan-20260729-auto-deploy-main-to-staging"
kind: plan
title: "Автоматический deployment main в staging"
status: active
date: 2026-07-29
owner: "4DreamTeam"
related_adrs:
  - "decisions-20260729-auto-deploy-main-to-staging"
---

# Автоматический deployment main в staging

## Цель

После quality и публикации immutable images автоматически доставлять каждый
успешный `main` в throwaway staging.

## Границы

В scope: GitHub Actions orchestration и актуализация canonical docs. Не в
scope: automatic production deployment, изменение VM privileges, PostgreSQL
topology или removal manual recovery workflow.

## Проверка

- Publish jobs экспортируют digests только из build outputs.
- Reusable deployment получает SHA/digests после обоих publish jobs.
- Active deployment не отменяется новым push.
- PR не запускает publish/deploy.
