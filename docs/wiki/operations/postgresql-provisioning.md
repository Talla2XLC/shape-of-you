---
id: "operations-postgresql-provisioning"
kind: data
title: "Provisioning PostgreSQL staging"
status: draft
tags:
  - "postgresql"
  - "provisioning"
  - "staging"
---

# Provisioning PostgreSQL staging

## Кратко

Для Shape of You создаются отдельные database и login role внутри
существующего PostgreSQL 17.4. Операция ещё не выполнена и требует отдельного
approval.

## Содержание

Provisioning выполняется текущей административной role только один раз.
Секретный пароль генерируется оператором и не помещается в SQL files,
documentation, terminal history или chat.

Команды выполняются вне transaction через административное подключение к
database `postgres`:

```sql
CREATE ROLE shape_of_you_api
  LOGIN
  PASSWORD '<generated-secret>'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION;

CREATE DATABASE shape_of_you_api
  OWNER shape_of_you_api
  TEMPLATE template0
  ENCODING 'UTF8';

REVOKE ALL ON DATABASE shape_of_you_api FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE shape_of_you_api TO shape_of_you_api;
```

После подключения к `shape_of_you_api`:

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO shape_of_you_api;
```

Эта role используется API и one-shot migration service. Она не получает
superuser, role-management или database-creation privileges.

Проверка перед первой migration:

```sql
SELECT
  current_database(),
  current_user,
  has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
  has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
  has_schema_privilege(current_user, 'public', 'CREATE') AS can_migrate;
```

PostgreSQL может выдавать `CONNECT` к другим databases через `PUBLIC`.
Provisioning Shape of You не меняет ACL чужих databases. Гарантированное
запрещение соединений с ними требует отдельного согласованного изменения ACL
или `pg_hba.conf`; отсутствие object grants проверяется отдельно владельцем
cluster.

После provisioning полный service URL сохраняется только как GitHub
Environment secret `STAGING_DATABASE_URL`.

## Основания

- Подтверждённые административные privileges `CREATEDB`, `CREATEROLE`,
  `SUPERUSER`.
- ADR временного deployment и автономности deployable service.

## Решения

- Runtime не использует существующую административную role.
- На временном staging migrations и API используют одну выделенную role.

## Открытые вопросы

- Provisioning ещё не выполнен.
- Строгая network/database isolation контролируется владельцем общего cluster.

## Связанные материалы

- [Временный deployment](temporary-vm-deployment.md)
- [Backup и restore](postgresql-backup-and-restore.md)
- [Backend migration notes](../data/backend-migrations.md)
