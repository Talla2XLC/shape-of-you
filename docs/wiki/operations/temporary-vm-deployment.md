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

- Commit passed `CI`; API, edge, and Certbot GHCR images are selected by full
  digest.
- Environment `staging` contains required secrets/variables.
- Both `staging.shape-of-you.ru` and `identity.staging.shape-of-you.ru` resolve
  publicly to `STAGING_PUBLIC_IPV4`.
- VM has Docker Engine, Compose plugin, `curl`, `getent`, `flock`, systemd, and
  `visudo`; ports `80` and `443` are allowed by the provider firewall and are
  free or owned by this Compose project.
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
STAGING_ACME_EMAIL
STAGING_PUBLIC_IPV4
```

Repository variable used as the initial cutover gate:

```text
STAGING_TLS_AUTOMATION_ENABLED
```

Database URL shape:

```text
postgresql://shape_of_you_api:<secret>@host.docker.internal:5431/shape_of_you_api
```

Never log or store the value in release manifests.

### Publication and deployment

`publish-staging.yml` publishes SHA tags for API, edge, and the project Certbot
image and records provenance/SBOM; digest is deployment authority. After
quality and publication for a `main` push, it automatically invokes
`deploy-staging.yml`. Manual targeted retry supplies full commit SHA, all three
image digests, schema backward-compatibility flag, and write-smoke choice.

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

For the initial HTTP-to-HTTPS cutover, keep
`STAGING_TLS_AUTOMATION_ENABLED` absent or set to `false` before merging. The
push publishes all three images but skips deployment. Then, with separate
approval:

1. allow inbound TCP `80` and `443` and confirm no unrelated listener owns
   them;
2. set `STAGING_ACME_EMAIL` to the operational certificate contact and
   `STAGING_PUBLIC_IPV4` to the VM public IPv4;
3. update the VM checkout to the reviewed `main` commit and run the root asset
   installer above;
4. set `STAGING_TLS_AUTOMATION_ENABLED=true`;
5. manually dispatch `Publish staging images` for the same `main` commit.

After the verified cutover, leave the gate at `true`; later `main` pushes return
to normal automatic deployment. This sequence prevents the new workflow input
contract from racing the old installed root wrapper.

### TLS activation and renewal

The first TLS-capable deployment verifies both DNS answers and exclusive port
ownership. If no certificate exists, it starts the HTTP-only bootstrap edge,
requests one certificate for both exact names through the HTTP-01 webroot,
copies only the serving chain/key into the nginx volume, validates nginx, and
starts the HTTPS edge. Existing ACME state is reused on later deployments.

The installer enables `shape-of-you-staging-cert-renew.timer`. It checks twice
daily with a randomized delay. A renewal run shares the deployment lock, runs
`certbot renew`, refreshes the serving copy, validates nginx, and reloads it.
Before the first TLS-capable release is active, the wrapper exits successfully
without attempting Compose.

Read-only checks:

```sh
systemctl list-timers shape-of-you-staging-cert-renew.timer
systemctl status shape-of-you-staging-cert-renew.timer
journalctl -u shape-of-you-staging-cert-renew.service --since today
curl -I http://staging.shape-of-you.ru/
curl -I https://staging.shape-of-you.ru/
```

A manual renewal invocation, certificate issuance, firewall change, or service
restart is a VM mutation and requires separate approval. Never copy ACME
account data, private keys, or runtime environment contents into logs or chat.

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
- [Automated staging TLS](../../adr/20260805-automate-staging-tls-with-nginx-certbot-and-systemd.md)

## Open questions

- Runbook evidence must be refreshed after each separately approved staging
  migration/deployment/rollback drill.

## Related material

- [Topology](../architecture/deployment.md)
- [Rollback](temporary-vm-rollback.md)
- [Provisioning](postgresql-provisioning.md)
- [Backup](postgresql-backup-and-restore.md)
- [SSH tunnel](postgresql-ssh-tunnel.md)
