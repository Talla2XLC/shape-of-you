---
id: "decisions-20260729-use-dedicated-staging-deployment-identity"
kind: adr
title: "Use a dedicated identity and constrained root wrapper for staging deployment"
status: accepted
date: 2026-07-29
supersedes: []
superseded_by: "decisions-20260729-use-verified-main-for-staging-deployment-control"
tags:
  - "deployment"
  - "security"
  - "github-actions"
---

# Use a dedicated identity and constrained root wrapper for staging deployment

## Context

Temporary staging runs on a shared VM where Docker requires privileged access.
The operator's personal account must not become the GitHub Actions identity.
Docker group membership or broad sudo is effectively root-equivalent because
the daemon can run privileged containers and mount the host filesystem.

Uploading a mutable deployment package would let CI execute changeable remote
scripts with privilege, which is too broad even for a temporary environment.

## Decision

- GitHub Actions connects only as `shape-deploy`, which has a locked password,
  no Docker group membership, no shell-wide sudo, and no access to the
  operator's account.
- `sudoers` allows exactly `/usr/local/sbin/shape-of-you-staging-deploy`
  without arguments or a password.
- The wrapper, Compose file, and scripts are installed as `root:root` under
  `/opt/shape-of-you/staging/system` and are not writable by `shape-deploy`.
- The wrapper reads a limited set of `key=value` records from stdin, rejects
  duplicates and unknown keys, validates SHAs, digests, and flags, never
  evaluates input as shell code, and never prints credentials.
- A protected GitHub Environment job provides `DATABASE_URL` and a short-lived
  GHCR token. The wrapper writes runtime secrets to a root-owned `0600` file,
  uses a temporary Docker config, and runs only the static script.
- CI sends no Compose file, script, or arbitrary shell command. Updating static
  deployment assets is a separate operator maintenance action with review and
  approval.

## Considered alternatives

- Use the operator account: rejected because CI access cannot be minimized or
  audited independently.
- Add `shape-deploy` to Docker group: rejected as root-equivalent access.
- Allow `sudo docker`, `sudo compose`, or SCP-delivered scripts: rejected
  because the command and writable-code scope remains too broad.
- Use a self-hosted runner: deferred because it adds a persistent privileged
  trust boundary without a current need.

## Consequences

Compose/script changes require the operator to install reviewed root-owned
assets. In exchange, workflow code has no direct Docker/root access and cannot
replace executable deployment code.

This decision does not remove shared-VM, public PostgreSQL port, or unauthenticated
HTTP risks. It only constrains delivery identity and privilege; production
requires a separate security review.

## Verification

- `shape-deploy` is outside Docker group; `sudo -l -U shape-deploy` shows only
  the wrapper.
- Wrapper and system assets are `root:root` and not writable by the account.
- Workflow contains no SCP package or arbitrary remote shell.
- Invalid keys, duplicates, digests, or arguments fail before deployment.
- Deployment, migration, smoke checks, and immutable-digest rollback work only
  after separate approval.

## Related material

- [Temporary deployment on a shared VM](20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [Operational runbook](../wiki/operations/temporary-vm-deployment.md)
