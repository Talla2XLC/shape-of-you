---
id: "operations-temporary-vm-deployment"
kind: architecture
title: "Временный deployment на VM"
status: draft
tags:
  - "deployment"
  - "github-actions"
  - "staging"
---

# Временный deployment на VM

## Кратко

Runbook описывает подготовленный, но ещё не выполненный deployment Shape of
You на общей VM. Все команды изменения VM, PostgreSQL и GitHub выполняются
только после отдельных approvals.

## Содержание

### Предварительные условия

- В Git существует commit, прошедший workflow `CI`.
- API и edge images опубликованы в GHCR и выбраны по полным digests.
- GitHub Environment `staging` содержит required secrets и variables.
- На VM установлены Docker Engine, Compose plugin и `curl`.
- Host port `3001` свободен либо принадлежит текущему Compose project.
- Созданы database/login role `shape_of_you_api`.
- Создан отдельный password-locked пользователь `shape-deploy` без группы
  `docker`; root-owned wrapper и `sudoers` policy устанавливаются оператором.
- `/etc/shape-of-you/staging/api.env` содержит только runtime secrets и имеет
  owner `root:root`, mode `0600`.
- Согласован backup checkpoint общего PostgreSQL cluster.

### GitHub Environment

Secrets:

```text
STAGING_DATABASE_URL
STAGING_VM_SSH_PRIVATE_KEY
STAGING_VM_KNOWN_HOSTS
```

Variables:

```text
STAGING_VM_HOST
STAGING_VM_USER
STAGING_VM_PORT
GHCR_NAMESPACE
```

`STAGING_DATABASE_URL` имеет форму:

```text
postgresql://shape_of_you_api:<secret>@host.docker.internal:5431/shape_of_you_api
```

Значение не выводится в logs и не записывается в release manifest.

### Publication

`publish-staging.yml` после quality gates публикует:

```text
ghcr.io/<namespace>/shape-of-you-api:sha-<commit>
ghcr.io/<namespace>/shape-of-you-edge:sha-<commit>
```

Deployment authority — digest, а не tag. Workflow сохраняет provenance и SBOM.

### Deployment

`publish-staging.yml` автоматически запускает `deploy-staging.yml` после
quality и публикации обоих images для каждого push в `main`. Ручной запуск
`deploy-staging.yml` сохраняется для targeted retry и требует:

- полный commit SHA;
- API digest;
- edge digest;
- явное значение schema backward compatibility;
- решение, выполнять ли synthetic write smoke.

Job использует Environment `staging` и через SSH stdin вызывает единственный
root-owned wrapper без аргументов:

```sh
sudo -n /usr/local/sbin/shape-of-you-staging-deploy
```

Wrapper принимает только allowlisted values, создаёт runtime env, выполняет
GHCR login во временном `DOCKER_CONFIG`, проверяет `CONTROL_SHA` как текущий
`origin/main` и запускает script из root-owned checkout
`/opt/shape-of-you/staging/control/deploy/staging/scripts/deploy.sh`. GitHub Actions не
передаёт на VM Compose file, scripts или произвольную shell-команду. Успешный
release становится `current`, предыдущий — `previous`.

Перед первым запуском и после изменения самого root wrapper оператор из проверенного checkout запускает
`sudo sh deploy/staging/system/install-root-owned-assets.sh`. Скрипт не
выполняется GitHub Actions и устанавливает wrapper и `sudoers` как `root:root`.
Обычное обновление Compose/scripts после этого не требует SSH-copy на VM.

### Остановка

Остановка относится к изменению VM и требует отдельного approval:

```sh
docker compose \
  --project-name shape-of-you-staging \
  --env-file <release-env-file> \
  --file deploy/staging/compose.yaml \
  down
```

PostgreSQL container и чужой Compose этой командой не затрагиваются.

## Основания

- `deploy/staging/compose.yaml`.
- `.github/workflows/publish-staging.yml`.
- `.github/workflows/deploy-staging.yml`.
- Активный план временного deployment.

## Решения

- [ADR о временном deployment](../../adr/20260728-use-temporary-vm-deployment-with-shared-postgresql.md).
- [ADR о выделенной deployment identity](../../adr/20260729-use-dedicated-staging-deployment-identity.md).
- [ADR об автоматическом deployment main](../../adr/20260729-auto-deploy-main-to-staging.md).

## Открытые вопросы

- Первый root-owned installation wrapper/assets, отдельный SSH key для
  `shape-deploy` и их Environment configuration ещё не выполнены.
- Первый deployment, migration/smoke и rollback drill ещё не выполнены.

## Связанные материалы

- [Deployment topology](../architecture/deployment.md)
- [Rollback](temporary-vm-rollback.md)
- [Provisioning PostgreSQL](postgresql-provisioning.md)
- [Backup и restore](postgresql-backup-and-restore.md)
- [SSH tunnel](postgresql-ssh-tunnel.md)
