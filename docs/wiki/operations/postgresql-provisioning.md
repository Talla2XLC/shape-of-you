---
id: "operations-postgresql-provisioning"
kind: data
title: "Provision staging PostgreSQL"
status: draft
tags:
  - "postgresql"
  - "provisioning"
  - "staging"
---

# Provision staging PostgreSQL

## Summary

Shape of You uses a dedicated database and login role inside the existing
PostgreSQL 17.4 cluster. Provisioning is an operator-approved one-time action.

## Content

Generate the password outside SQL files, documentation, terminal history, and
chat. Run as the existing administrative role against database `postgres`:

```sql
CREATE ROLE shape_of_you_api
  LOGIN PASSWORD '<generated-secret>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;

CREATE DATABASE shape_of_you_api
  OWNER shape_of_you_api TEMPLATE template0 ENCODING 'UTF8';

REVOKE ALL ON DATABASE shape_of_you_api FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE shape_of_you_api TO shape_of_you_api;
```

Then connect to `shape_of_you_api`:

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO shape_of_you_api;
```

API and one-shot migrations use this role; it receives no superuser, role, or
database-creation privileges. Verify before migration:

```sql
SELECT
  current_database(), current_user,
  has_database_privilege(current_user, current_database(), 'CONNECT') AS can_connect,
  has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
  has_schema_privilege(current_user, 'public', 'CREATE') AS can_migrate;
```

PostgreSQL may grant CONNECT to other databases through PUBLIC. This procedure
does not alter unrelated ACLs; strict cluster isolation needs a separately
approved ACL/`pg_hba.conf` change. Store the service URL only as GitHub
Environment secret `STAGING_DATABASE_URL`.

## Evidence

- Confirmed administrative privileges and deployment/service-autonomy ADRs.

## Decisions

- Runtime never uses the administrative role. Staging API and migrations share
  only the dedicated API role.

## Open questions

- Shared-cluster network/database isolation remains with the cluster owner.

## Related material

- [Deployment](temporary-vm-deployment.md)
- [Backup/restore](postgresql-backup-and-restore.md)
- [Migrations](../data/backend-migrations.md)
