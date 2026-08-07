---
id: "decisions-20260729-use-verified-main-for-staging-deployment-control"
kind: adr
title: "Use verified main as the staging deployment-control source"
status: accepted
date: 2026-07-29
supersedes: "decisions-20260729-use-dedicated-staging-deployment-identity"
superseded_by: "decisions-20260807-use-stable-root-bootstrap-and-versioned-deployment-controller"
tags:
  - "deployment"
  - "security"
  - "github-actions"
---

# Use verified main as the staging deployment-control source

## Context

Static root-owned Compose files and scripts prevented GitHub Actions from
replacing privileged code but required manual VM installation for every
deployment-control fix. That overhead is unnecessary for staging.

## Decision

Keep the root-owned wrapper and single `sudoers` rule as the immutable
privilege boundary. For each approved deployment, the wrapper accepts
`CONTROL_SHA`, fetches only `origin/main` from the public repository, requires
an exact match with the fetched head, and checks out a root-owned control tree
at `/opt/shape-of-you/staging/control`. Compose and deployment scripts run only
from that tree.

GitHub Actions does not send scripts, Compose files, or shell fragments.
`shape-deploy` remains outside the Docker group and may call only the wrapper
without arguments. Manual Environment approval confirms trust in the current
`main` as privileged deployment-control source.

## Consequences

After one wrapper update, deployment-control changes no longer require SSH
copying. Compromised push access to `main` can influence root-level deployment
control at the next approved deployment, so branch protection and review are
mandatory before production.

## Considered alternatives

- Keep static assets and update manually: rejected because ordinary fixes
  require SSH maintenance.
- Grant Docker group, shell sudo, or writable SCP scripts: rejected because it
  breaks the narrow privilege boundary.
- Add a self-hosted runner: deferred because it creates a persistent privileged
  agent without a current need.

## Verification

- The wrapper rejects unknown, duplicate, malformed, or non-matching
  `CONTROL_SHA` before Docker or migration actions.
- The root-owned checkout and wrapper are not writable by `shape-deploy`.
- Workflow input is structured and contains neither SCP nor arbitrary remote
  shell.
- The operator installs the first wrapper revision; later Compose/script
  changes are verified through normal approved deployment.

## Related material

- [Dedicated deployment identity](20260729-use-dedicated-staging-deployment-identity.md)
- [Deployment topology](../wiki/architecture/deployment.md)
