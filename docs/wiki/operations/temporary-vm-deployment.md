---
id: "operations-temporary-vm-deployment"
kind: architecture
title: "Temporary VM deployment"
status: draft
tags:
  - "deployment"
  - "github-actions"
  - "staging"
---

# Temporary VM deployment

## Summary

Runbook for shared-VM Shape of You staging. VM, PostgreSQL, GitHub, migration,
and deployment mutations always require the corresponding explicit approval.

## Content

### Preconditions

- Commit passed `CI`; API/edge GHCR images are selected by full digest.
- Environment `staging` contains required secrets/variables.
- VM has Docker Engine, Compose plugin, and `curl`; port `3001` is free or
  owned by this Compose project.
- Database/login `shape_of_you_api` exists.
- Password-locked `shape-deploy` exists outside Docker group; operator installed
  root wrapper and sudoers rule.
- `/etc/shape-of-you/staging/api.env` is `root:root` mode `0600`.
- Shared-cluster backup checkpoint is agreed.

Environment secrets:

```text
STAGING_DATABASE_URL
STAGING_VM_SSH_PRIVATE_KEY
STAGING_VM_KNOWN_HOSTS
```

Variables:

```text
STAGING_VM_HOST
STAGING_VM_USER
STAGING_VM_PORT
GHCR_NAMESPACE
```

Database URL shape:

```text
postgresql://shape_of_you_api:<secret>@host.docker.internal:5431/shape_of_you_api
```

Never log or store the value in release manifests.

### Publication and deployment

`publish-staging.yml` publishes SHA tags for API/edge and records provenance/
SBOM; digest is deployment authority. After quality and publication for a
`main` push, it automatically invokes `deploy-staging.yml`. Manual targeted
retry supplies full commit SHA, API/edge digests, schema backward-compatibility
flag, and write-smoke choice.

The Environment job invokes only:

```sh
sudo -n /usr/local/sbin/shape-of-you-staging-deploy
```

Wrapper accepts allowlisted stdin, creates runtime env, uses temporary
`DOCKER_CONFIG`, verifies `CONTROL_SHA` against current `origin/main`, and runs
root-owned
`/opt/shape-of-you/staging/control/deploy/staging/scripts/deploy.sh`.
CI sends no Compose, scripts, or arbitrary shell. Successful release updates
`current` and `previous`.

After wrapper changes, operator installs from a verified checkout:

```sh
sudo sh deploy/staging/system/install-root-owned-assets.sh
```

GitHub Actions never runs this installer.

### Stop

Stopping is a VM mutation and needs approval:

```sh
docker compose \
  --project-name shape-of-you-staging \
  --env-file <release-env-file> \
  --file deploy/staging/compose.yaml \
  down
```

This does not affect unrelated Compose/PostgreSQL.

## Evidence

- Staging Compose, publish/deploy workflows, and deployment scripts.

## Decisions

- [Temporary deployment ADR](../../adr/20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
- [Dedicated identity ADR](../../adr/20260729-use-dedicated-staging-deployment-identity.md)
- [Automatic staging ADR](../../adr/20260729-auto-deploy-main-to-staging.md)

## Open questions

- Runbook evidence must be refreshed after each separately approved staging
  migration/deployment/rollback drill.

## Related material

- [Topology](../architecture/deployment.md)
- [Rollback](temporary-vm-rollback.md)
- [Provisioning](postgresql-provisioning.md)
- [Backup](postgresql-backup-and-restore.md)
- [SSH tunnel](postgresql-ssh-tunnel.md)
