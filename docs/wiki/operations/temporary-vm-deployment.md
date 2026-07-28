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

Runbook описывает подготовленный, но ещё не проверенный deployment Shape of
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

`deploy-staging.yml` запускается вручную и требует:

- полный commit SHA;
- API digest;
- edge digest;
- явное значение schema backward compatibility;
- решение, выполнять ли synthetic write smoke.

Job использует Environment `staging`, передаёт deployment package на VM,
создаёт runtime env через SSH stdin, выполняет GHCR login во временном
`DOCKER_CONFIG`, затем запускает:

```sh
deploy/staging/scripts/deploy.sh <release-env-file>
```

Script проверяет inputs и Compose config, получает images, запускает one-shot
migration, обновляет API/edge и выполняет smoke. Успешный release становится
`current`, предыдущий — `previous`.

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

## Открытые вопросы

- Runbook не проверен на VM.
- GitHub Environment и secrets ещё не созданы.
- Database/login role ещё не созданы.

## Связанные материалы

- [Deployment topology](../architecture/deployment.md)
- [Rollback](temporary-vm-rollback.md)
- [Provisioning PostgreSQL](postgresql-provisioning.md)
- [Backup и restore](postgresql-backup-and-restore.md)
- [SSH tunnel](postgresql-ssh-tunnel.md)
