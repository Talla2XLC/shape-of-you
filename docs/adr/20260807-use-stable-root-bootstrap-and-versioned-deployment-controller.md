---
id: "decisions-20260807-use-stable-root-bootstrap-and-versioned-deployment-controller"
kind: adr
title: "Use a stable root bootstrap and versioned deployment controller"
status: accepted
date: 2026-08-07
supersedes: "decisions-20260729-use-verified-main-for-staging-deployment-control"
superseded_by: null
tags:
  - "deployment"
  - "security"
  - "github-actions"
---

# Use a stable root bootstrap and versioned deployment controller

## Context

The root-owned staging wrapper already verifies an exact `origin/main` commit
before executing deployment scripts from that commit. However, the wrapper
also parses every release field, writes runtime environments, authenticates to
the registry, and starts the deployment. Adding an Identity or API runtime
setting therefore changes the installed privileged wrapper protocol and
requires manual VM maintenance before the corresponding `main` push. This
creates a recurring rollout race between a new workflow and an old wrapper.

## Decision

Keep one small root-owned bootstrap as the immutable `sudoers` boundary. It
accepts no arguments and stores a bounded `key=value` request in a root-only
temporary file. It validates the envelope shape and extracts only one exact
`CONTROL_SHA`. It then fetches the fixed public repository and `main` branch,
requires `CONTROL_SHA` to equal the fetched head, checks out that commit in the
root-owned control tree, and invokes one fixed deployment-controller path from
that tree with the original request on standard input.

Move release-field parsing, domain-specific validation, runtime environment
creation, registry login, Compose selection, migrations, smoke, rollback
metadata, and cleanup into the versioned deployment controller. The controller
continues to reject unknown, duplicate, malformed, or incomplete fields and
receives no command, path, or script name from CI.

The bootstrap retains the deployment/renewal lock, a fixed sanitized `PATH`,
fixed repository and branch, exact-head verification, root ownership, bounded
input, and deterministic cleanup. The `shape-deploy` account remains outside
the Docker group and may invoke only the bootstrap without arguments.

## Considered alternatives

- Keep the field-aware wrapper and reinstall it for protocol changes: rejected
  because ordinary feature delivery would continue to require coordinated SSH
  maintenance.
- Grant GitHub Actions Docker-group, broad sudo, or arbitrary remote-command
  access: rejected because each is effectively unrestricted root access.
- Let the installed wrapper replace itself: rejected because partial updates
  can brick the only deployment entrypoint and add recovery complexity.
- Pass an arbitrary controller path or uploaded script from CI: rejected
  because it bypasses the verified `origin/main` source boundary.

## Consequences

One final operator-approved installation replaces the old field-aware wrapper
with the stable bootstrap. Future release fields and validation rules change
only in the versioned controller and deploy automatically with the matching
verified commit. A change to the bootstrap trust model itself still requires
manual installation.

As before, an accepted commit on `main` can execute root-level deployment code
at the next deployment. Branch protection, review, exact commit verification,
and protected Environment credentials therefore remain mandatory.

## Verification

- Contract tests prove the bootstrap has no domain-specific release fields,
  accepts no arguments, bounds and preserves the request, verifies exact
  `origin/main`, and invokes only the fixed controller path.
- Controller tests retain strict field allowlisting, duplicate rejection,
  schema/digest/URL validation, root-only environment creation, and registry
  credential cleanup.
- Shell syntax, staging Compose renders, rollback, TLS, Identity, and write
  smoke contracts pass.
- After the one-time bootstrap installation, a later harmless controller-only
  protocol fixture is deployable without changing the installed bootstrap.

## Related material

- [Verified main deployment control](20260729-use-verified-main-for-staging-deployment-control.md)
- [Dedicated deployment identity](20260729-use-dedicated-staging-deployment-identity.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [Temporary VM runbook](../wiki/operations/temporary-vm-deployment.md)
