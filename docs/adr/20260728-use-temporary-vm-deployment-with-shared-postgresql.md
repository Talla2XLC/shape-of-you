---
id: "decisions-20260728-use-temporary-vm-deployment-with-shared-postgresql"
kind: adr
title: "Use temporary shared-VM deployment with an isolated API database"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "deployment"
  - "infrastructure"
  - "postgresql"
---

# Use temporary shared-VM deployment with an isolated API database

## Context

Shape of You needs inexpensive temporary staging before real users and a move
to dedicated cloud infrastructure. The available VM already hosts unrelated
nginx and PostgreSQL workloads. This project does not control ports `80`/`443`
or the lifecycle of that Compose stack. One API and a lightweight proxy fit,
but a second PostgreSQL instance would add unnecessary memory pressure.

The current backend has no authentication or authorization, so plain HTTP is
not suitable for real personal data.

## Decision

Use this temporary topology until an exit condition is met:

- GitHub Actions tests code, builds immutable OCI images, and publishes GHCR
  SHA tags; the VM only pulls and runs images.
- Shape of You owns a separate Compose project and does not modify unrelated
  Compose or nginx configuration.
- A project nginx exposes only `http://2.58.15.24:3001/`: `/` is reserved for
  web and `/api/` routes to API. API and future web containers expose no host
  ports directly.
- This nginx is a deployment adapter without business logic or data, not a
  domain service or service boundary.
- API uses the existing PostgreSQL cluster but owns database
  `shape_of_you_api`, a dedicated login role, credentials, and migrations.
  Cross-service SQL, shared schemas, credentials, and migrations are forbidden.
- Choose container-to-PostgreSQL connectivity after read-only network and bind
  inspection, preferring minimal coupling and no public PostgreSQL exposure.
  IDE access uses an SSH tunnel only.
- Run migrations as a one-shot deployment step before the new API. Per-replica
  startup migration is not the target production model.
- Keep runtime portable: stateless API, environment configuration, `/health`,
  `/ready`, graceful shutdown, stdout/stderr logs, immutable images, and no
  host-path application state.
- Do not create Kubernetes, Helm, or cloud-specific manifests yet. A later move
  changes the deployment adapter, not domain architecture or ownership.

Until HTTPS, authentication, and authorization exist, port `3001` is throwaway
staging for synthetic data and test credentials only. Request limits, rate
limiting, and a PostgreSQL exposure ban reduce abuse but do not make HTTP safe
for personal data.

Exit when any of these becomes true:

- public registration or real external users are planned;
- personal or sensitive data must be stored;
- measurable SLA, RPO/RTO, or multiple replicas are required;
- sustained memory exceeds `70–75%` or swap pressure appears;
- the first independently released service is created;
- dependence on the unrelated PostgreSQL lifecycle becomes unacceptable.

Migration uses verified backup/restore or `pg_dump`/`pg_restore`, followed by
migrations, smoke tests, and reconciliation.

## Considered alternatives

- Reuse unrelated nginx routing: saves one light container but couples release
  to another image, Compose stack, and configuration permissions.
- Run dedicated nginx and PostgreSQL on the VM: cleaner ownership but an
  unjustified second database process before users exist.
- Use VM `46.30.188.217`: one vCPU and roughly `1 GiB` RAM leave too little
  headroom.
- Move immediately to dedicated cloud/Kubernetes: stronger isolation but
  premature cost, cluster operations, and manifests.
- Expose API directly on a host port: simpler but loses a single web/API edge
  and pushes edge concerns into the application.

## Consequences

The project gets cheap reversible staging, remains independent of unrelated
nginx, avoids premature microservices, and ties each artifact to a commit.

The topology still shares PostgreSQL failure and resource domains. Database
and credential isolation is not failure isolation. Public HTTP remains limited
to synthetic data.

Production Compose, workflows, nginx assets, secret delivery, backup/restore,
and firewall changes require an approved implementation plan. This ADR does
not authorize deployment or VM mutation by itself.

## Verification

- CI builds and publishes immutable commit-linked image digests.
- The VM contains no application build context.
- Only the selected edge port is public; API, web, and PostgreSQL are not
  separately exposed.
- API credentials cannot access unrelated databases; migrations target only
  `shape_of_you_api`.
- Redeploy and rollback use immutable image references.
- Only synthetic data is used before the real-data gate.
- Every deployment Architecture Review checks exit conditions.

## Related material

- [Deployment topology](../wiki/architecture/deployment.md)
- [Data ownership](../wiki/architecture/data-ownership.md)
- [Repository and runtime](../wiki/architecture/repository-and-runtime.md)
- [Deployable service autonomy](20260728-deployable-service-autonomy.md)
- [PostgreSQL with Drizzle](20260728-use-postgresql-with-drizzle-orm-and-kit.md)
