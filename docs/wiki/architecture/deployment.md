---
id: "architecture-deployment"
kind: architecture
title: "Deployment topology"
status: draft
tags:
  - "deployment"
  - "infrastructure"
  - "runtime"
---

# Deployment topology

## Кратко

Утверждена временная staging topology на общей VM: images собираются в GitHub
Actions, а собственный nginx Shape of You публикует web и API через один
внешний port. Repository artifacts для topology подготовлены, но GitHub
configuration, database provisioning и deployment на VM ещё не выполнены.

## Содержание

### Delivery

GitHub Actions выполняет проверки, собирает immutable OCI images и публикует
их в GHCR с tag по commit SHA. Manual workflow с Environment `staging`
принимает конкретные image digests, а VM получает только deployment package и
готовые images; application build context и toolchain ей не нужны.

### Runtime boundary

Собственный nginx Shape of You публикует `http://2.58.15.24:3001/`.
Маршрут `/` зарезервирован для будущего web и до его появления возвращает
явный staging response, `/api/` — маршрутизирует запросы в текущий API. API и
будущий web доступны только во внутренней Docker network. Чужой nginx и его
Compose не изменяются.

Nginx — временный deployment adapter без бизнес-логики и данных. Он не
является новым domain service и не меняет границы modular backend.

### Данные

На первом этапе API использует существующий PostgreSQL cluster, но владеет
отдельной database `shape_of_you_api`, отдельной login role, credentials и
migrations. PostgreSQL работает в соседнем container и уже опубликован
владельцем VM на host port `5431`. API обращается к этому port через
`host.docker.internal`, не подключаясь к network или service name чужого
Compose.

Внешний доступ к `5431` и отсутствие SSL являются принятым ограничением
throwaway staging, а не security baseline проекта. Shape of You не создаёт
новую публикацию PostgreSQL и не меняет существующие firewall rules.
Рекомендуемый доступ разработчика после deployment — SSH tunnel.

### Security gate

Текущий API не имеет authentication и authorization. До появления domain,
HTTPS и контроля доступа внешний endpoint разрешён только как throwaway
staging с синтетическими данными, тестовыми credentials, rate limit и
ограничением размера запросов. Реальные пользовательские данные запрещены.

### Переносимость

API остаётся stateless, получает конфигурацию через environment, использует
health/readiness probes, graceful shutdown и stdout/stderr logs. Migrations
выполняются отдельным one-shot Compose service из того же API image digest.
Обычный API process migrations не запускает. Kubernetes-артефакты не
создаются до появления подтверждённой необходимости.

Runtime `DATABASE_URL` хранится в GitHub Environment secret
`STAGING_DATABASE_URL`. Deployment job передаёт его по SSH через stdin и
создаёт root-owned `/etc/shape-of-you/staging/api.env` с mode `0600`.
Release manifests содержат только commit SHA и image digests.

Условия выхода и процедура переноса определены в связанном ADR. Решения об
authentication, HTTPS, secrets, backup retention, SLO и целевом cloud требуют
отдельного проектирования.

## Основания

- Read-only проверка доступных VM и существующих контейнеров 2026-07-28.
- Ограничения временного staging, принятые оператором 2026-07-28.
- Подтверждённый оператором доступ к PostgreSQL 17.4 через host port `5431`
  без SSL и возможность создать отдельные database/login role, 2026-07-29.
- Repository manifests в `.github/workflows/` и `deploy/staging/`.

## Решения

- [Временный deployment на общей VM](../../adr/20260728-use-temporary-vm-deployment-with-shared-postgresql.md).

## Открытые вопросы

- Фактическая доступность `host.docker.internal:5431` из API container на VM.
- Проверенные resource limits и отсутствие конфликта host port `3001`.
- Согласованная с владельцем общего cluster backup/restore procedure.
- Domain, TLS termination, authentication и authorization до real-data gate.

## Связанные материалы

- [Репозиторий и runtime](repository-and-runtime.md)
- [Backend runtime](backend-runtime.md)
- [Владение данными](data-ownership.md)
- [Backend migration notes](../data/backend-migrations.md)
- [Временный deployment](../operations/temporary-vm-deployment.md)
- [Rollback](../operations/temporary-vm-rollback.md)
- [Provisioning PostgreSQL](../operations/postgresql-provisioning.md)
- [Backup и restore](../operations/postgresql-backup-and-restore.md)
