---
id: "operations-temporary-vm-rollback"
kind: architecture
title: "Rollback временного deployment"
status: draft
tags:
  - "deployment"
  - "rollback"
  - "staging"
---

# Rollback временного deployment

## Кратко

Application rollback возвращает предыдущие API/edge image digests и не
откатывает PostgreSQL schema автоматически.

## Содержание

Каждый успешный deployment хранит release manifest без secrets в:

```text
/opt/shape-of-you/staging/releases/<commit-sha>/release.env
```

Symlinks `current` и `previous` указывают на последний успешный и предыдущий
release.

После отдельного approval rollback запускается:

```sh
/opt/shape-of-you/staging/system/scripts/rollback.sh
```

Либо для конкретного release:

```sh
/opt/shape-of-you/staging/system/scripts/rollback.sh \
  <target-commit-sha>
```

Script получает прежние images, обновляет API/edge и повторяет smoke.
Migration runner не запускается.

Автоматический application rollback после неуспешного deployment разрешён
только при `SCHEMA_BACKWARD_COMPATIBLE=true`. Если совместимость не
подтверждена, deployment останавливается для roll-forward либо отдельного
решения о restore.

Database rollback не выполняется down migration. Для несовместимого изменения
schema требуется expand/migrate/contract rollout либо restore из заранее
проверенного backup с отдельным approval.

## Основания

- `deploy/staging/scripts/deploy.sh`.
- `deploy/staging/scripts/rollback.sh`.
- ADR временного deployment.

## Решения

- Application artifacts откатываются по immutable digest.
- Database rollback является отдельной операцией.

## Открытые вопросы

- Rollback ещё не проверен на VM.
- Первый deployment не имеет предыдущего release.

## Связанные материалы

- [Временный deployment](temporary-vm-deployment.md)
- [Backup и restore](postgresql-backup-and-restore.md)
- [Backend migration notes](../data/backend-migrations.md)
