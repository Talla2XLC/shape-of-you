---
id: "decisions-20260729-auto-deploy-main-to-staging"
kind: adr
title: "Automatically deploy main to staging"
status: accepted
date: 2026-07-29
supersedes: null
superseded_by: null
tags:
  - "deployment"
  - "staging"
  - "github-actions"
---

# Automatically deploy main to staging

## Context

Staging contains only synthetic data. Manually starting deployment after every
successful immutable image publication adds no useful operator gate. The
current `main` should be delivered continuously without manually copying
digests.

## Decision

A push to `main` runs quality, publishes API and edge images, and automatically
invokes reusable `Deploy staging` with the resulting digests. Deployment stays
serialized and never cancels an active migration. Manual dispatch remains for
targeted retry and rollback. Until a separate staging branch exists, `main` is
the only trigger branch.

## Considered alternatives

- Keep manual deployment: rejected because throwaway staging gains no valuable
  approval gate and retains repetitive work.
- Cancel an active deployment on a new push: rejected because interrupting a
  migration is more dangerous than serially delivering a stale release.
- Use a separate `workflow_run`: deferred because safe immutable digest
  transfer becomes more complex without a current need.

## Consequences

Every successful `main` may change staging. Real data, public registration, and
production use therefore remain forbidden. The `staging` Environment continues
to own secrets, and the workflow receives no broad VM privileges.

## Verification

- One `main` push creates quality, publish, and deploy in one workflow chain.
- Deploy receives digests only from publish job outputs.
- Pull requests run CI without deployment.
- Manual `Deploy staging` dispatch remains available for recovery.

## Related material

- [Temporary deployment on a shared VM](20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
- [Deployment topology](../wiki/architecture/deployment.md)
