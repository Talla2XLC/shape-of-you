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
  `visudo`; ports `80` and `443` are allowed by the provider firewall.
- In `shared-ingress` mode, `/opt/shared-vm-ingress` exclusively owns those
  ports, external network `shared-vm-ingress` exists, HTTP reaches
  `shape-of-you-edge:8080`, and SNI/PROXY routing reaches port `8443`.
- In `standalone` mode, the ports are free or already owned by the Shape of You
  Compose project; no external ingress network is required.
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
STAGING_DEPLOYMENT_TOPOLOGY
```

Database URL shape:

```text
postgresql://shape_of_you_api:<secret>@host.docker.internal:5431/shape_of_you_api
```

Never log or store the value in release manifests.

`STAGING_DEPLOYMENT_TOPOLOGY` accepts `shared-ingress` or `standalone`. The
current shared VM uses `shared-ingress`; the workflow defaults to that value
while the variable is absent. Set it explicitly before enabling automatic
deployment. A dedicated VM uses `standalone` and must have ports `80/443` free
or already owned by the Shape of You Compose project.

The corresponding render contracts are explicit:

```sh
docker compose \
  --file deploy/staging/compose.yaml \
  --file deploy/staging/compose.shared-ingress.yaml \
  config

docker compose \
  --file deploy/staging/compose.yaml \
  --file deploy/staging/compose.standalone.yaml \
  config
```

Deployment, renewal, and rollback select the same overlay from the allowlisted
topology stored in `release.env`; operators do not hand-edit the base Compose
file during a move.

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

The initial HTTP-to-HTTPS cutover used a temporary deployment gate. With
separate approval, the operator:

1. completed the coordinated [shared ingress](shared-vm-ingress.md) maintenance
   cutover and validated both existing talking-to-ai traffic and Shape of You
   HTTP routing;
2. set `STAGING_ACME_EMAIL` to the operational certificate contact and
   `STAGING_PUBLIC_IPV4` to the VM public IPv4;
3. updated the VM checkout to the reviewed `main` commit and ran the root asset
   installer above;
4. manually dispatched `Deploy staging` with the exact commit and image
   digests published by the reviewed `main` run;
5. verified certificate issuance, HTTPS smoke, both existing applications, and
   rollback readiness;
6. retired the temporary gate.

The cutover completed on 2026-08-05. Every successful `main` publication now
invokes staging deployment automatically. Direct `Deploy staging` dispatch
remains available for an explicit retry or operator-selected release. The
historical sequence prevented the new workflow input contract from racing the
old installed root wrapper; it is not a steady-state switch.

### TLS activation and renewal

The first TLS-capable deployment verifies both DNS answers, the external
network and shared-ingress listeners in shared mode, or exclusive port
availability in standalone mode. If no certificate exists, it removes the old
edge endpoint, starts the HTTP-only bootstrap edge under the selected
transport, verifies both public Host routes with a temporary challenge,
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
- [Shared Host/SNI ingress](../../adr/20260805-route-shared-vm-ingress-by-host-and-sni.md)

## Open questions

- Runbook evidence must be refreshed after each separately approved staging
  migration/deployment/rollback drill.

## Related material

- [Topology](../architecture/deployment.md)
- [Shared ingress](shared-vm-ingress.md)
- [Rollback](temporary-vm-rollback.md)
- [Provisioning](postgresql-provisioning.md)
- [Backup](postgresql-backup-and-restore.md)
- [SSH tunnel](postgresql-ssh-tunnel.md)
