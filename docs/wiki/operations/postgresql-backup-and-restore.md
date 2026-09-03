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

Before real wearable data is enabled, the backup boundary must also retain an
append-only Recovery erasure manifest independently of any restorable database
snapshot. Every restore stays isolated and unready until the manifest is proven
complete for the backup time range and replayed. A missing or incomplete
manifest is a fail-closed restore blocker; point-in-time recovery never revokes
an erasure that happened later. The manifest retention must exceed the maximum
backup lifetime with an operational safety margin.

Create each immutable manifest directly in owner-approved storage mounted
outside the database backup boundary. The command creates a new mode-`0600`
file and refuses to overwrite an existing one:

```sh
pnpm --filter @shape-of-you/api recovery-erasure:manifest \
  --action export \
  --output <new-independent-protected-path>
```

Restore into an isolated database, then apply a manifest before starting any
API process or attaching external ingress:

```sh
pnpm --filter @shape-of-you/api recovery-erasure:manifest \
  --action apply \
  --manifest <independent-protected-path> \
  --required-through <owner-approved-erasure-cutoff>
```

`DATABASE_URL` must target the intended source for export and the isolated
restore for apply. `required-through` is the latest erasure cutoff approved for
opening the restore, not the backup creation time. The command fails on a
missing, group/world-readable, malformed, modified, or incomplete manifest.
Only a successful apply may unblock the remaining restore verification. The
manifest contains opaque Person/connection/request identifiers, reason and
request time; it contains no health values, provider record IDs, labels,
credentials, or authentication proof.

## Evidence

- Shared PostgreSQL 17.4 and accepted database/credential/migration ownership.

## Decisions

- Unrelated databases are outside Shape of You backup scope.
- A backup is not a rollback path until restore is verified.
- A restored database cannot serve traffic until Recovery erasure replay is
  verified.

## Open questions

- Approved backup and erasure-manifest storage/retention and verified owner
  restore procedure.

## Related material

- [Deployment topology](../architecture/deployment.md)
- [Provisioning](postgresql-provisioning.md)
- [Rollback](temporary-vm-rollback.md)
- [Recovery retention and erasure ADR](../../adr/20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)
