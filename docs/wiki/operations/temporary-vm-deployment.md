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

- Commit passed `CI`; API, Identity, edge, and Certbot GHCR images are selected
  by full digest.
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
- Separate databases/logins `shape_of_you_api` and `shape_of_you_identity`
  exist.
- Password-locked `shape-deploy` exists outside Docker group; operator installed
  root wrapper and sudoers rule.
- `/etc/shape-of-you/staging/api.env` and `identity.env` are `root:root` mode
  `0600`.
- Shared-cluster backup checkpoint is agreed.

Environment secrets:

```text
STAGING_DATABASE_URL
STAGING_IDENTITY_DATABASE_URL
STAGING_IDENTITY_TOTP_ENCRYPTION_KEYS
STAGING_IDENTITY_OAUTH_SIGNING_KEYS
STAGING_IDENTITY_OAUTH_COOKIE_KEYS
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
STAGING_IDENTITY_TOTP_ACTIVE_KEY_ID
STAGING_IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID
```

Database URL shape:

```text
postgresql://shape_of_you_api:<secret>@host.docker.internal:5431/shape_of_you_api
postgresql://shape_of_you_identity:<secret>@host.docker.internal:5431/shape_of_you_identity
```

Never log or store the value in release manifests.

The OAuth signing-key ring contains private key material and the cookie key
ring contains bearer-equivalent provider secrets. Create and store them only
in the protected GitHub `staging` Environment. The corresponding active key id
is a non-secret variable. The deploy workflow and root wrapper require the
complete TOTP and OAuth groups whenever Identity deployment is enabled, then
write them only to root-owned `identity.env`. Do not print either generated
ring, copy it into chat, or commit it.

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
  --file deploy/staging/compose.identity.yaml \
  config

docker compose \
  --file deploy/staging/compose.yaml \
  --file deploy/staging/compose.standalone.yaml \
  --file deploy/staging/compose.identity.yaml \
  config
```

Deployment, renewal, and rollback select the same overlay from the allowlisted
topology stored in `release.env`; operators do not hand-edit the base Compose
file during a move.

### Publication and deployment

`publish-staging.yml` publishes SHA tags for API, Identity, edge, and the
project Certbot image and records provenance/SBOM; digest is deployment
authority. After quality and publication for a `main` push, it automatically
invokes `deploy-staging.yml` with all four digests. Manual targeted retry
supplies full commit SHA, all image digests, separate API and Identity schema
backward-compatibility flags, and the write-smoke choice. Fitness Tracker
imports are not part of deployment; controlled runs use the operator
workstation workflow documented in the migration strategy.

The Environment job invokes only:

```sh
sudo -n /usr/local/sbin/shape-of-you-staging-deploy
```

The stable bootstrap accepts a bounded `key=value` request, extracts only
`CONTROL_SHA`, verifies it against current `origin/main`, and invokes the fixed
`deploy/staging/scripts/deployment-controller.sh` path from that exact commit.
The versioned controller strictly validates the complete allowlist, creates
runtime env, uses temporary `DOCKER_CONFIG`, and runs `deploy.sh`. CI sends no
Compose, scripts, paths, or arbitrary shell. Successful release updates
`current` and `previous`.

Only a change to the bootstrap trust boundary or systemd/sudoers assets needs
operator installation from a verified checkout:

```sh
sudo sh deploy/staging/system/install-root-owned-assets.sh
```

GitHub Actions never runs this installer. Ordinary controller, Compose,
migration, smoke, and runtime-field changes arrive automatically with the
verified commit and require no SSH maintenance.

The completed Identity cutover used a backward-compatible preparation release
before the digest, database URL, and Identity schema-compatibility declaration
became one mandatory input group. The controller writes
`/etc/shape-of-you/staging/identity.env` independently from `api.env`. An
Identity release can automatically roll back only when both API and Identity
schema compatibility and predefined-client compatibility are explicitly true.
Older releases remain renderable without the optional Identity overlay and
expect the historical edge `503`.

Before the first OAuth/MCP-capable deployment, add the two OAuth secrets and
active signing-key variable listed above, perform the one-time replacement of
the old field-aware wrapper with the reviewed stable bootstrap, and deploy the
accepted release. Stage that exact commit through a non-`main` preparation ref
so the VM installation completes before updating `main`; this avoids an
automatic deployment racing the old wrapper. All later controller protocol
changes use the normal automatic `main` flow. Create the exact API subject
binding through the provided operator CLI. For the reserved ChatGPT client,
set the non-secret staging Environment variable
`STAGING_IDENTITY_CHATGPT_REDIRECT_URI` to the exact stable callback
`https://chatgpt.com/connector_platform_oauth_redirect`. Every Identity
deployment rejects any other value, runs migrations, then executes
`oauth-client:reconcile-predefined` before replacing runtime.
Missing or invalid configuration and database drift that cannot be reconciled
abort before replacement. Subject binding remains an explicit operation;
reserved client reconciliation is automatic and never deletes clients absent
from the manifest.

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
old installed root wrapper; the stable bootstrap removes this class of
steady-state rollout race.

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
- [Stable ChatGPT connector callback](../../adr/20260827-adopt-stable-chatgpt-connector-platform-oauth-callback.md)

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
