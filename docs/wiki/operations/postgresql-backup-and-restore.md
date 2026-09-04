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
append-only Recovery erasure journal independently of every restorable database
snapshot and release directory. The primary model is a strict typed SQLite
journal, not JSON. It records accepted intent before physical deletion and
completion evidence afterward. The erasure worker cannot claim a request until
a sealed accepted checkpoint exists and PostgreSQL has been acknowledged.

Every restore stays isolated and unready until a sealed journal checkpoint is
proven complete through the owner-approved erasure cutoff and replayed. Restore
suppression follows accepted intent even if completion is absent. A missing,
unreadable, modified, permissive, or incomplete journal is a fail-closed restore
blocker; point-in-time recovery never revokes an erasure that happened later.
Journal retention must exceed the maximum lifetime of every restorable logical
backup and PITR window by the agreed safety margin.

Synchronize the live journal to a new sealed checkpoint in owner-approved
storage outside the PostgreSQL and release failure boundaries. Both paths are
explicit; the checkpoint path must not already exist:

```sh
pnpm --filter @shape-of-you/api recovery-erasure:journal \
  --action sync \
  --journal <owner-approved-live-journal-path> \
  --checkpoint <new-immutable-independent-checkpoint-path>
```

`DATABASE_URL` must target the intended source database. The command reads one
repeatable snapshot, appends accepted/completed events and a completeness
checkpoint, seals and verifies the new mode-`0600` SQLite copy, and only then
acknowledges those events in PostgreSQL. If sealing fails, acknowledgement is
not written and physical deletion remains blocked. Tool success cannot prove
the durability of an arbitrary filesystem path: the cluster owner must approve
the storage and immutable independent-copy procedure.

Inspect a sealed checkpoint without database access:

```sh
pnpm --filter @shape-of-you/api recovery-erasure:journal \
  --action inspect \
  --journal <immutable-independent-checkpoint-path> \
  --required-through <owner-approved-erasure-cutoff>
```

Restore into an isolated database, then apply the sealed journal before
starting any API process or attaching external ingress:

```sh
pnpm --filter @shape-of-you/api recovery-erasure:journal \
  --action apply \
  --journal <immutable-independent-checkpoint-path> \
  --required-through <owner-approved-erasure-cutoff>
```

For apply, `DATABASE_URL` must target only the isolated restore.
`required-through` is the latest erasure cutoff approved for opening the
restore, not the backup creation time. Only successful apply plus the remaining
restore checks may unblock readiness. The journal contains opaque
Person/connection/request identifiers, reason, event times, and integrity
metadata; it contains no health values, provider record IDs, labels,
credentials, authentication proof, or raw payloads.

The automated safety drill starts a disposable local PostgreSQL 17 instance on
loopback with a dynamically selected port that is explicitly not `5431`, makes
a real custom-format backup, restores it into a separate database, applies an
accepted-only checkpoint, and verifies that connection-derived raw and derived
facts remain absent while unrelated manual facts and shared definitions remain.
It does not use Docker or the shared cluster. This test evidence does not replace
the separately approved drill with an actual owner-provided backup.

## Evidence

- Shared PostgreSQL 17.4 and accepted database/credential/migration ownership.

## Decisions

- Unrelated databases are outside Shape of You backup scope.
- A backup is not a rollback path until restore is verified.
- A restored database cannot serve traffic until Recovery erasure replay is
  verified.

## Open questions

- Approved backup and erasure-journal storage/retention and verified owner
  restore procedure.

## Related material

- [Deployment topology](../architecture/deployment.md)
- [Provisioning](postgresql-provisioning.md)
- [Rollback](temporary-vm-rollback.md)
- [Recovery retention and erasure ADR](../../adr/20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)
- [Independent typed Recovery erasure journal ADR](../../adr/20260904-use-independent-typed-recovery-erasure-journal.md)
