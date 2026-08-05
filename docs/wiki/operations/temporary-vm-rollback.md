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
automatically rolls back PostgreSQL schema or ACME state.

## Content

Successful releases store secret-free manifest:

```text
/opt/shape-of-you/staging/releases/<commit-sha>/release.env
```

The manifest includes the allowlisted deployment topology, so rollback uses
the same shared or standalone overlay as the target release. Automatic rollback
refuses a target from another topology; after a VM/topology move, complete a
verified deployment to establish a new rollback baseline.

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
approved restore decision. Direct rollback shares the deployment/certificate
renewal lock and refuses to start while either operation is active.

The HTTPS topology is a one-way operational cutover. A release created before
the release manifest gained `CERTBOT_IMAGE` and `CERTBOT_DIGEST` cannot be
rendered by the current Compose contract and is rejected before any container
change. Roll back only to a TLS-capable release; otherwise prepare an explicit
roll-forward decision. Certificate and ACME account volumes remain intact
across application rollback. The shared ingress and external network are host
infrastructure and are not changed by application rollback. A topology-cutover
failure uses the separate [shared-ingress rollback](shared-vm-ingress.md#rollback).

Database rollback never uses down migration. Incompatible schema needs
expand/migrate/contract or restore from a previously verified backup with
separate approval.

## Evidence

- Deployment/rollback scripts and temporary deployment ADR.

## Decisions

- Application rolls back by immutable digest; database rollback is separate.
- [Shared Host/SNI ingress](../../adr/20260805-route-shared-vm-ingress-by-host-and-sni.md)

## Open questions

- Keep live VM rollback evidence current; a first deployment has no previous
  release.

## Related material

- [Deployment](temporary-vm-deployment.md)
- [Backup](postgresql-backup-and-restore.md)
- [Migrations](../data/backend-migrations.md)
