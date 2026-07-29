---
id: "plan-20260729-dedicated-staging-deployment-identity"
kind: plan
title: "Выделенная identity для staging deployment"
status: active
date: 2026-07-29
owner: "4DreamTeam"
related_adrs:
  - "decisions-20260728-use-temporary-vm-deployment-with-shared-postgresql"
  - "decisions-20260729-use-dedicated-staging-deployment-identity"
---

# Выделенная identity для staging deployment

## Цель

Исключить личную учётную запись оператора из пути GitHub Actions deployment и
дать техническому пользователю `shape-deploy` только проверяемое минимальное
право на запуск staging rollout.

## Границы

В scope входят root-owned wrapper, `sudoers` policy, refactoring workflow,
операционные инструкции и проверка. Не входят изменение firewall, PostgreSQL,
чужих containers, фактический deployment, commit или push без отдельных
approvals.

## Этапы

1. Зафиксировать решение в ADR и текущую topology в canonical Wiki.
2. Добавить статический root wrapper и узкий `sudoers` policy в repository.
3. Убрать SCP и remote arbitrary commands из GitHub Actions workflow.
4. Провести локальную проверку shell syntax, YAML, документации и diff.
5. После отдельного approval оператор устанавливает root-owned assets на VM,
   создаёт отдельный SSH key для `shape-deploy` и добавляет его в Environment
   `staging`.
6. После отдельного approval выполнить первый deployment, migration/smoke и
   rollback drill; только затем закрыть план.

## Критерии готовности текущей реализации

- В Git есть root wrapper без `eval` и без исполнения входных shell fragments.
- Workflow передаёт только allowlisted structured input через stdin wrapper.
- `shape-deploy` не получает Docker group, общий sudo или личный SSH key.
- Документация описывает статические assets, секреты, rollback и оставшиеся
  operator gates без значений credentials.

## Риски

Root wrapper остаётся privileged, потому что deployment использует Docker. Его
код и `sudoers` должны оставаться root-owned. Compose/scripts получаются через
проверяемый `main` согласно superseding ADR, что не создаёт новый deployable
service и не меняет domain/data ownership boundaries.

## Architecture Review

1. **Избыточная сложность:** один wrapper и один `sudoers` rule проще и уже,
   чем выдача Docker group или набор разрешённых Docker commands. Root wrapper
   меняется редко, а control files обновляются через проверяемый `main`.
2. **Преждевременные сервисные границы:** wrapper и nginx остаются deployment
   adapters, а не deployable services или bounded contexts.
3. **Domain-Driven Design:** deployment identity не меняет domain model, API
   contracts, отдельную database API или ownership migrations.
4. **Единый источник истины:** ADR хранит решение, Wiki — текущее состояние,
   этот план — последовательность исполнения. Дублирующий managed Wiki или
   generated mirror не создаётся.
5. **Упрощение без потери масштаба:** self-hosted runner, Kubernetes и новый
   PostgreSQL cluster не добавляются. Immutable images и stateless runtime
   сохраняют возможность последующей миграции.

Выбранный вариант является наименьшим изменением, которое исключает личную
учётную запись оператора и Docker-equivalent права из CI path.
