---
id: "architecture-deployment"
kind: architecture
title: "Deployment topology"
status: draft
tags:
  - "deployment"
  - "infrastructure"
  - "runtime"
---

# Deployment topology

## Summary

Temporary staging runs on a shared VM. GitHub Actions builds immutable images;
an operator-owned transport ingress selects independently owned application
edges; a dedicated `shape-deploy` identity invokes a constrained root-owned
wrapper. Shape of You nginx, Certbot, and a root-owned systemd timer own the
project certificate lifecycle.

## Content

### Delivery

Pushes to `main` run quality, publish SHA-linked GHCR images, and automatically
deploy exact digests to Environment `staging`. Input is an allowlisted stdin
protocol to `/usr/local/sbin/shape-of-you-staging-deploy`. The VM receives no
build context, toolchain, writable scripts, or Compose file from CI.

`shape-deploy` is outside Docker group and has passwordless sudo only for the
wrapper without arguments. The wrapper fetches a root-owned control tree from
verified `origin/main` at exact `CONTROL_SHA`.

### Runtime and data

The root-owned `/opt/shared-vm-ingress` Compose project is the only owner of
host ports `80` and `443`. It routes HTTP by Host and opaque TLS by SNI over the
external `shared-vm-ingress` Docker network. It stores no certificates. Shape
of You nginx is reachable only as `shape-of-you-edge:8080/8443`, terminates its
own TLS, serves HTTP-01 and redirects, and routes `/api/` to the internal API.
`https://identity.staging.shape-of-you.ru` is the accepted Identity and
WebAuthn origin and returns a controlled `503` until Identity is deployed.
Unknown hosts fail closed at both boundaries. PROXY protocol preserves client
addresses for logging, forwarding, and rate limiting.

The base staging Compose file has two deployment overlays. Current staging uses
`shared-ingress`; a dedicated VM uses `standalone`, where Shape of You nginx
publishes `80/443` directly and does not expect PROXY protocol. Both modes use
one generated nginx configuration template and preserve the same Certbot,
volumes, services, probes, and release process. `DEPLOYMENT_TOPOLOGY` is stored
with the release so renewal and rollback cannot silently select another mode.

One exact-name certificate covers both staging hosts. Certbot persists ACME
account and renewal state in dedicated volumes. nginx mounts only a restrictive
serving copy of the current chain and private key. A root-owned systemd timer
runs the renewal check twice daily, validates nginx, and reloads it. Certbot has
no Docker socket, and application services receive no TLS material.

API owns `shape_of_you_api`, login, credentials, and migrations in the existing
PostgreSQL cluster. The container reaches host port `5431` through
`host.docker.internal`, not the unrelated Compose network. Existing external
database exposure is a throwaway-staging limitation; developer access should
use SSH tunneling.

### Security and portability

Without authentication, authorization, HTTPS, and a real-data gate, staging
uses only synthetic data/test credentials with request limits and rate limits.

API remains stateless with environment configuration, probes, graceful
shutdown, and stdout/stderr logs. Migrations run as a one-shot service from the
same image digest. `STAGING_DATABASE_URL` is delivered through protected
Environment input into root-owned `/etc/shape-of-you/staging/api.env` mode
`0600`. No Kubernetes assets exist yet.

VM resources are limited and swap is in use. Current limits (`384m` API,
`64m` edge) require observation before adding load.

The accepted Identity service is not deployed. Its runtime requires a separate
`DATABASE_URL`, uses database-aware readiness, and keeps migration execution in
a separate one-shot entrypoint. Before deployment it still needs provisioned
database credentials, resource sizing, backup/restore, signing-key rotation,
and an approved deployment plan. Edge/ACME owns TLS certificates; Identity
owns OAuth signing keys.

## Evidence

- Read-only VM/container inventory, PostgreSQL 17.4 access evidence, and
  repository workflows/manifests.

## Decisions

- [Temporary shared-VM deployment](../../adr/20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
- [Verified main deployment control](../../adr/20260729-use-verified-main-for-staging-deployment-control.md)
- [Shared Host/SNI ingress](../../adr/20260805-route-shared-vm-ingress-by-host-and-sni.md)

## Open questions

- Shared-cluster backup/restore; authentication before real data; target cloud,
  SLO, and long-term secrets policy.

## Related material

- [Repository/runtime](repository-and-runtime.md)
- [Backend runtime](backend-runtime.md)
- [Data ownership](data-ownership.md)
- [Identity and external tool access](identity-and-external-tool-access.md)
- [Deployment runbook](../operations/temporary-vm-deployment.md)
- [Shared VM ingress](../operations/shared-vm-ingress.md)
- [Rollback](../operations/temporary-vm-rollback.md)
- [PostgreSQL provisioning](../operations/postgresql-provisioning.md)
