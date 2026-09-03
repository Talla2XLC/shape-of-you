---
id: "decisions-20260903-bound-automatic-staging-delivery"
kind: adr
title: "Ограничить автоматическую staging-доставку по типу изменения и времени операции"
status: accepted
date: 2026-09-03
supersedes: "decisions-20260729-auto-deploy-main-to-staging"
superseded_by: null
tags:
  - "deployment"
  - "staging"
  - "github-actions"
  - "reliability"
---

# Ограничить автоматическую staging-доставку по типу изменения и времени операции

## Context

Автоматическая доставка каждого push в `main` полезна для изменений runtime,
но изменения только в документации и планах не меняют образы и staging. Их
сборка и deployment расходуют время CI без эксплуатационной пользы.

Длительный deployment проходит через один SSH-сеанс. Без client keepalive
runner не отличает неактивный сетевой канал от продолжающейся удалённой
операции. API и Identity migrations также не имеют собственного временного
предела, поэтому зависание одной операции определяется только общим лимитом
GitHub job и не даёт точной диагностики.

## Decision

Workflow публикации сохраняет автоматический trigger для `main`, но применяет
нативный `push.paths-ignore` к Markdown, `docs/**` и `plans/**`. Workflow не
запускается, только когда все изменённые пути относятся к документации или
планам. Любое изменение вне этих путей, включая смешанный push, сохраняет
полную цепочку quality, публикации образов и staging deployment. Ручной
`workflow_dispatch` остаётся без path-фильтра.

Существующий SSH-вызов GitHub Actions сохраняет `BatchMode`, выделенный ключ и
строгую проверку known hosts, дополняясь client keepalive:
`ServerAliveInterval=30` и `ServerAliveCountMax=6`. Серверная SSH-конфигурация
не меняется.

Versioned deployment script ограничивает отдельно API migration и Identity
migration пятью минутами через GNU `timeout`. После `TERM` допускается
30 секунд на завершение до `KILL`. Каждая migration получает детерминированное
имя one-shot container внутри существующего сериализованного Compose project.
При failure script показывает безопасный container/Compose status, выполняет
force-remove только этого container и проверяет его отсутствие. Код `137`
описывается неоднозначно как `SIGKILL` или timeout escalation, а не как
доказанный timeout. VM preflight проверяет наличие `timeout`. Пределы являются
частью versioned script и не добавляют environment variables или новый
deployment protocol.

## Considered alternatives

- Добавить change-detector job и условия ко всем publish jobs: сохраняет
  повторный post-merge quality run для documentation-only push, но создаёт
  дополнительный job, outputs и условные зависимости. PR `CI` уже проверяет
  документацию, поэтому сложность не оправдана.
- Использовать только общий `timeout-minutes` deployment job: не определяет,
  какая migration зависла, и завершает весь SSH-сеанс без локальной
  диагностики или контролируемого сигнала процессу.
- Настроить PostgreSQL `statement_timeout` или `lock_timeout`: меняет поведение
  общей СУБД и не покрывает зависание Docker client, сети или migration runner.
- Изменить server-side SSH keepalive: затрагивает общую инфраструктуру коллеги,
  тогда как проблема ограничена CI-клиентом.

## Consequences

Documentation-only и plan-only push больше не публикуют неизменные образы и не
трогают staging. Обычные изменения `main` по-прежнему автоматически
доставляются. Failed deployment job можно повторить с исходными digest outputs
и reusable workflow из исходного commit SHA.

Зависшая migration завершается до общего лимита job с точным названием этапа.
Даже если Compose client не остановил daemon-managed container, script удаляет
его по заранее известному имени и fail-closed проверяет отсутствие.
Узел staging должен иметь GNU `timeout`; отсутствие команды останавливает
deployment на preflight до запуска migrations. PostgreSQL, его порт `5431`,
Compose-проект `talking-to-ai`, shared ingress и инфраструктура коллеги не
изменяются.

## Verification

- Contract tests проверяют path filters, SSH keepalive, фиксированные пределы,
  API/Identity timeout, container cleanup, неоднозначный `137`, обычный failure
  и отсутствие нового migration environment contract.
- Все существующие staging deployment contract tests продолжают проходить.
- YAML workflows разбираются локально, shell scripts проходят syntax checks.
- Canonical documentation validator подтверждает ADR и Wiki links.
- Реальные failed-job reruns проверены read-only через GitHub Actions API.

## Related material

- [Предыдущее решение об automatic staging deployment](20260729-auto-deploy-main-to-staging.md)
- [Stable bootstrap и versioned controller](20260807-use-stable-root-bootstrap-and-versioned-deployment-controller.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [Temporary VM deployment](../wiki/operations/temporary-vm-deployment.md)
