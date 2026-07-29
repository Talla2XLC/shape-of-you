---
id: "decisions-20260729-use-dedicated-staging-deployment-identity"
kind: adr
title: "Выделенная учётная запись и ограниченный root wrapper для staging deployment"
status: accepted
date: 2026-07-29
supersedes: []
superseded_by: "decisions-20260729-use-verified-main-for-staging-deployment-control"
tags:
  - "deployment"
  - "security"
  - "github-actions"
---

# Выделенная учётная запись и ограниченный root wrapper для staging deployment

## Контекст

Временная staging topology запускается на общей VM, где Docker уже требует
привилегированного доступа. Личная учётная запись оператора не должна быть
идентичностью GitHub Actions. Добавление технического пользователя в группу
`docker` или выдача широкого `sudo` фактически даёт root-equivalent доступ:
Docker daemon может запускать privileged containers и монтировать файловую
систему host.

Прежняя схема с передачей deployment package на VM позволяла бы CI выполнять
изменяемые удалённые scripts с привилегиями. Это слишком широкая граница для
временной среды, даже при отсутствии production данных.

## Решение

- GitHub Actions подключается только как отдельный пользователь `shape-deploy`.
  У него заблокирован пароль, нет membership в группе `docker`, нет shell-wide
  `sudo` и нет доступа к личной учётной записи оператора.
- `sudoers` разрешает ровно одну команду без пароля:
  `/usr/local/sbin/shape-of-you-staging-deploy` без аргументов.
- Эта команда, Compose file и deployment scripts устанавливаются оператором как
  `root:root` в `/opt/shape-of-you/staging/system`; пользователь `shape-deploy`
  не может их менять.
- Root wrapper принимает ограниченный набор строк `key=value` через stdin,
  отклоняет дубликаты и неожиданные keys, валидирует SHA, image digest и flags,
  не интерпретирует входные значения как shell code и не выводит credentials.
- Wrapper получает `DATABASE_URL` и краткоживущий GHCR token через защищённый
  GitHub Environment job, записывает runtime secret в root-owned файл mode
  `0600`, логинится в GHCR во временный Docker config и запускает только
  статический deployment script.
- GitHub Actions больше не передаёт на VM Compose file, scripts или произвольную
  shell-команду. Обычный deployment меняет только выбранные immutable images и
  runtime secret. Обновление статических deployment assets — отдельная
  операторская maintenance-операция с review и явным approval.

## Рассмотренные альтернативы

- Использовать личную учётную запись оператора. Отклонено: CI получает доступ,
  который нельзя минимизировать и аудитировать отдельно.
- Добавить `shape-deploy` в группу `docker`. Отклонено: это root-equivalent
  доступ и не является least privilege.
- Разрешить `sudo docker`, `sudo compose` или удалённые scripts по SCP.
  Отклонено: scope команд и writable code остаются слишком широкими.
- Использовать self-hosted runner на VM. Отложено: он добавляет постоянный
  runner-agent и сопоставимый privileged trust boundary без текущей потребности.

## Последствия

Deployment становится менее удобным для изменения Compose/scripts: до смены
static assets оператор вручную устанавливает проверенную версию root-owned
файлов. Взамен workflow не имеет прямого Docker/root доступа и не может
подменить исполняемый deployment code.

Решение не устраняет риски общей VM, публичного PostgreSQL port или HTTP staging
без authentication. Оно ограничивает только identity и privilege boundary
delivery path. До production требуется отдельный security review.

## Проверка

- `shape-deploy` не состоит в группе `docker`; `sudo -l -U shape-deploy`
  показывает только wrapper.
- Wrapper и system assets принадлежат `root:root` и не writable для
  `shape-deploy`.
- Workflow не содержит SCP, remote temporary package или remote arbitrary shell.
- Попытки передать неизвестный key, duplicate key, неверный digest или argument
  завершаются до вызова deployment script.
- Обычный deployment, migration, smoke check и rollback по immutable digest
  проходят в staging после отдельного approval на запуск.

## Связанные материалы

- [Временный deployment на общей VM](20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [Операционный runbook](../wiki/operations/temporary-vm-deployment.md)
