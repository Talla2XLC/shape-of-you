---
id: "operations-postgresql-backup-and-restore"
kind: architecture
title: "Backup и restore PostgreSQL staging"
status: draft
tags:
  - "postgresql"
  - "backup"
  - "restore"
---

# Backup и restore PostgreSQL staging

## Кратко

Shape of You использует database `shape_of_you_api` внутри общего PostgreSQL
cluster. Проект не меняет общую backup policy владельца cluster.

## Содержание

До первой migration должны быть созданы отдельные:

```text
database: shape_of_you_api
login role: shape_of_you_api
```

Текущий административный доступ применяется только для provisioning.
Регулярные API и migration jobs используют выделенную role.

Перед schema migration deployment требует согласованный backup checkpoint.
Допустимый минимальный logical backup после одобрения владельцем cluster:

```sh
pg_dump --format=custom --file=<protected-path> shape_of_you_api
```

Credentials не передаются в аргументах процесса, logs или документацию.
Фактическая команда должна использовать одобренный владельцем cluster способ
authentication.

Restore сначала проверяется в отдельной test database:

```sh
createdb <temporary-restore-database>
pg_restore --exit-on-error --dbname=<temporary-restore-database> <backup-file>
```

Затем проверяются migration journal, наличие `weight_measurements` и
synthetic read/write. Удаление test database является destructive action и
требует отдельного approval.

Retention, encryption at rest, storage path и удаление backup определяет
владелец общего PostgreSQL cluster.

## Основания

- Общий PostgreSQL 17.4 на временной VM.
- Отдельное владение database/credentials/migrations в принятом ADR.

## Решения

- Никакие чужие databases не входят в backup/restore scope Shape of You.
- Restore verification предшествует использованию backup как rollback path.

## Открытые вопросы

- Согласованный storage path и retention.
- Проверенная restore procedure владельца cluster.

## Связанные материалы

- [Deployment topology](../architecture/deployment.md)
- [Provisioning PostgreSQL](postgresql-provisioning.md)
- [Rollback](temporary-vm-rollback.md)
- [Backend migration notes](../data/backend-migrations.md)
