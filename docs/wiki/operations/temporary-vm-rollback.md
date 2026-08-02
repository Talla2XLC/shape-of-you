---
id: "operations-temporary-vm-rollback"
kind: architecture
title: "Temporary deployment rollback"
status: draft
tags:
  - "deployment"
  - "rollback"
  - "staging"
---

# Temporary deployment rollback

## Summary

Application rollback restores previous API/edge image digests and never
automatically rolls back PostgreSQL schema.

## Content

Successful releases store secret-free manifest:

```text
/opt/shape-of-you/staging/releases/<commit-sha>/release.env
```

`current` and `previous` symlinks identify the last two successful releases.
After separate approval:

```sh
/opt/shape-of-you/staging/control/deploy/staging/scripts/rollback.sh
```

Or target a release:

```sh
/opt/shape-of-you/staging/control/deploy/staging/scripts/rollback.sh \
  <target-commit-sha>
```

The script pulls previous images, updates API/edge, and reruns smoke without
migrations. Automatic application rollback is allowed only when
`SCHEMA_BACKWARD_COMPATIBLE=true`; otherwise stop for roll-forward or an
approved restore decision.

Database rollback never uses down migration. Incompatible schema needs
expand/migrate/contract or restore from a previously verified backup with
separate approval.

## Evidence

- Deployment/rollback scripts and temporary deployment ADR.

## Decisions

- Application rolls back by immutable digest; database rollback is separate.

## Open questions

- Keep live VM rollback evidence current; a first deployment has no previous
  release.

## Related material

- [Deployment](temporary-vm-deployment.md)
- [Backup](postgresql-backup-and-restore.md)
- [Migrations](../data/backend-migrations.md)
