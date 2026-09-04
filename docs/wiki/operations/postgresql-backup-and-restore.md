---
id: "operations-postgresql-backup-and-restore"
kind: architecture
title: "Staging PostgreSQL backup and restore"
status: accepted
tags:
  - "postgresql"
  - "backup"
  - "restore"
---

# Staging PostgreSQL backup and restore

## Summary

Shape of You owns database `shape_of_you_api` inside a shared cluster and does
not modify the cluster owner's overall backup policy. As verified on
2026-09-04, PostgreSQL WAL/PITR archiving and automated host backup jobs are not
configured. One owner-created custom-format logical backup is retained manually
on the database VM with owner-only access and no deletion deadline.

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

The current manual backup is stored in an owner-controlled same-host backup
directory with directory mode `0700` and file mode `0600`. It was restored
successfully into an isolated PostgreSQL 17 instance before being accepted as a
usable copy. This is a logical-restore checkpoint, not disaster recovery: loss
of the VM can remove both the live database and the manual backup.

Before real wearable data is enabled, the restore boundary must also retain an
append-only Recovery erasure journal outside every restorable database snapshot,
release directory, and manual backup directory. The primary model is a strict
typed SQLite journal, not JSON. It records accepted intent before physical
deletion and completion evidence afterward. The erasure worker cannot claim a
request until a sealed accepted checkpoint exists and PostgreSQL has been
acknowledged.

The owner-approved temporary location is a separate owner-controlled directory
on the same database VM. The directory must use mode `0700`; live journal and
sealed checkpoint files must use mode `0600`. Same-host storage protects against
restoring an old logical PostgreSQL dump because that restore does not replace
the SQLite journal. It does not protect against loss, compromise, or filesystem
rollback of the whole VM. Off-host or immutable copying remains the recommended
target state.

TASK-0099 provisioned this location under the VM operator account as
`~/recovery-erasure-journal`, with a separate `checkpoints/` directory. The
first live journal and sealed checkpoint were verified offline through their
exact completeness cutoff. Both directories are mode `0700`; both SQLite files
are regular owner files mode `0600`.

The repository now defines the unattended non-empty synchronization path. A
root-owned systemd timer runs a one-shot, non-root container from the active
immutable API image. The runner passes the existing root-owned API environment
file directly to Docker and bind-mounts the owner-only host journal before the
command starts. It requires the existing live journal, validates fixed
ownership and modes, and fails without acknowledging PostgreSQL when storage is
missing, unsafe, corrupt, or unwritable. The verified deployment controller
installs or refreshes these versioned assets only after a successful normal
deployment; no VM wrapper edit is part of a release. Staging activation and
runtime verification still require their separately approved deployment and VM
operations.

Every restore stays isolated and unready until a sealed journal checkpoint is
proven complete through the owner-approved erasure cutoff and replayed. Restore
suppression follows accepted intent even if completion is absent. A missing,
unreadable, modified, permissive, or incomplete journal is a fail-closed restore
blocker; point-in-time recovery never revokes an erasure that happened later.
Journal retention must exceed the maximum lifetime of every restorable logical
backup and PITR window by the agreed safety margin. Because manual backups
currently have no maximum lifetime, journal events and sealed checkpoints must
be retained indefinitely. Do not delete or rotate them until the cluster owner
first defines a finite backup lifetime and separately approves a journal safety
margin.

Synchronize the live journal to a new sealed checkpoint in the temporary
owner-approved same-host journal directory, outside PostgreSQL, release, and
manual-backup directories. Both paths are explicit; the checkpoint path must
not already exist:

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

The first TASK-0099 checkpoint covered a verified empty erasure-request set, so
the CLI performed no acknowledgement update. It was safe to seal in the running
API container's private temporary filesystem, compare both file hashes after
streaming to owner-only `.partial` host files, and publish them by atomic rename.
This is a bootstrap-only exception. Never use temporary container storage plus
post-sync copying when at least one erasure request exists: PostgreSQL could be
acknowledged before the durable host copy exists.

For unattended operation, `sync-pending` checks for unacknowledged accepted or
completed events under a PostgreSQL advisory lock. An empty queue creates no
checkpoint. A non-empty queue receives an internally generated UTC-plus-UUID
path opened exclusively, so an existing checkpoint cannot be replaced. The
command flushes the checkpoint file and parent directory and verifies the
sealed copy before writing acknowledgement timestamps. Any failure leaves the
request quarantined and the erasure worker fail-closed. The long-lived API has
no journal mount, and the timer does not create a second database identity.

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
It does not use Docker or the shared cluster. TASK-0098 supplemented this with
an owner-created custom-format backup: the archive restored successfully into a
loopback-only PostgreSQL 17 instance on port `55432`, schema-only checks found
both journal acknowledgement columns, and the instance was stopped. The local
copy and temporary restore data were then deleted with explicit approval; the
verified manual backup remains on the VM.

## Evidence

- Shared PostgreSQL 17.4 and accepted database/credential/migration ownership.
- On 2026-09-04, `archive_mode=off`, `wal_keep_size=0`, `wal_level=replica`, and
  `pg_stat_archiver` had no archive activity.
- No PostgreSQL backup systemd timer, system cron job, root/user crontab entry,
  or logical backup under `/var/backups` was found during the approved read-only
  inspection.
- TASK-0098 owner-backed restore completed without shared-cluster writes,
  migrations, Docker, compose, service changes, deployment, commit, or push.
- TASK-0099 created and offline-verified the first same-host live journal and
  sealed completeness checkpoint. The running API kept the same container ID
  and start time, remained healthy, and had zero restarts; no compose, deploy,
  migration, PostgreSQL configuration, or port change occurred.
- TASK-0100 added the repository-managed systemd one-shot/timer, direct-mount
  runner, pending-only journal command, durable checkpoint boundary, advisory
  serialization, and CI contracts. Independent Quality accepted the source;
  no deployment or VM operation was performed as part of that review.

## Decisions

- Unrelated databases are outside Shape of You backup scope.
- A backup is not a rollback path until restore is verified.
- A restored database cannot serve traffic until Recovery erasure replay is
  verified.
- Same-host Recovery journal storage is a temporary accepted limitation for
  logical-restore safety only; it is not VM disaster recovery.
- Journal retention is indefinite while any manual backup has no deletion
  deadline.

## Open questions

- Deployment and runtime verification of the repository-managed journal timer
  on staging before direct Garmin ingestion processes real erasure requests.
- A future finite backup retention policy and journal safety margin.
- Independent off-host or immutable storage for VM-loss protection.

## Related material

- [Deployment topology](../architecture/deployment.md)
- [Provisioning](postgresql-provisioning.md)
- [Rollback](temporary-vm-rollback.md)
- [Recovery retention and erasure ADR](../../adr/20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)
- [Independent typed Recovery erasure journal ADR](../../adr/20260904-use-independent-typed-recovery-erasure-journal.md)
- [Temporary same-host Recovery erasure journal ADR](../../adr/20260904-temporarily-use-same-host-recovery-erasure-journal.md)
- [Automated Recovery erasure journal synchronization ADR](../../adr/20260904-automate-recovery-erasure-journal-with-root-scheduled-one-shot.md)
