---
id: "operations-postgresql-backup-and-restore"
kind: architecture
title: "Staging PostgreSQL backup and restore"
status: draft
tags:
  - "postgresql"
  - "backup"
  - "restore"
---

# Staging PostgreSQL backup and restore

## Summary

Shape of You owns database `shape_of_you_api` inside a shared cluster and does
not modify the cluster owner's overall backup policy.

## Content

Administrative access is only for provisioning. API and migrations use the
dedicated role. Before schema migration, agree on a backup checkpoint. Minimal
logical backup after cluster-owner approval:

```sh
pg_dump --format=custom --file=<protected-path> shape_of_you_api
```

Never pass credentials in process arguments, logs, or documentation. Use the
owner-approved authentication mechanism.

Verify restore first in a separate test database:

```sh
createdb <temporary-restore-database>
pg_restore --exit-on-error --dbname=<temporary-restore-database> <backup-file>
```

Then verify migration journal, expected tables, and synthetic read/write.
Deleting the test database is destructive and needs separate approval.
Cluster owner defines retention, at-rest encryption, storage path, and deletion.

## Evidence

- Shared PostgreSQL 17.4 and accepted database/credential/migration ownership.

## Decisions

- Unrelated databases are outside Shape of You backup scope.
- A backup is not a rollback path until restore is verified.

## Open questions

- Approved storage/retention and verified owner restore procedure.

## Related material

- [Deployment topology](../architecture/deployment.md)
- [Provisioning](postgresql-provisioning.md)
- [Rollback](temporary-vm-rollback.md)
