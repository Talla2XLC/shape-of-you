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
bootstrap. Shape of You nginx, Certbot, and a root-owned systemd timer own the
project certificate lifecycle.

Approved operator access to the current staging VM uses the operator-managed
OpenSSH host alias `talking-to-ai`. CI continues to resolve its deployment
target exclusively from the protected `STAGING_VM_HOST` Environment variable;
the local alias is not deployment authority and carries no repository-managed
credentials.

The accepted first browser release adds a static Nuxt artifact to the existing
Shape of You edge image. It does not add a frontend container or release
coordinate.

## Content

### Delivery

Pushes to `main` run quality, publish SHA-linked GHCR images, and automatically
deploy exact digests to Environment `staging`. API, Identity, edge, and Certbot
are independently built and attested, and all four coordinates belong to one
atomic release. Input is a bounded `key=value` request to
`/usr/local/sbin/shape-of-you-staging-deploy`. The VM receives no build context,
toolchain, writable scripts, or Compose file from CI.

`shape-deploy` is outside Docker group and has passwordless sudo only for the
bootstrap without arguments. The stable bootstrap extracts only
`CONTROL_SHA`, fetches a root-owned control tree from verified `origin/main`,
requires an exact head match, and invokes the fixed versioned controller path
from that commit. The controller owns the evolving release-field allowlist,
validation, runtime environments, registry login, and deployment. Adding an
ordinary deployment parameter therefore requires no bootstrap reinstall.

### Runtime and data

The root-owned `/opt/shared-vm-ingress` Compose project is the only owner of
host ports `80` and `443`. It routes HTTP by Host and opaque TLS by SNI over the
external `shared-vm-ingress` Docker network. It stores no certificates. Shape
of You nginx is reachable only as `shape-of-you-edge:8080/8443`, terminates its
own TLS, serves HTTP-01 and redirects, routes `/api/` to the internal API, and
routes `https://identity.staging.shape-of-you.ru` to the internal Identity
service. That exact HTTPS origin is also the staging WebAuthn RP origin.
Unknown hosts fail closed at both boundaries. PROXY protocol preserves client
addresses for logging, forwarding, and rate limiting.

On `staging.shape-of-you.ru`, edge serves the static Nuxt client by default
while `/api`, `/api/`, `/.well-known/oauth-protected-resource`, and edge probes
retain their current owners. On `identity.staging.shape-of-you.ru`, edge serves
the same client by default while `/.well-known/`, `/oauth/`, `/v1/`, and the
existing Identity probes continue to reach Identity. Reserved locations always
take precedence over the static fallback and must not return client HTML for an
upstream error or unknown backend route.

The static artifact is the initial delivery mode rather than a permanent SSR
restriction. A future stateless Nuxt/Nitro service can replace static fallback
behind the same edge and origins when a measured server-rendering or independent
release requirement justifies the extra runtime.

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

API owns `shape_of_you_api`; Identity independently owns
`shape_of_you_identity`. Each has a separate login, credentials, root-owned
runtime env file, one-shot migration service, and database-access Docker
network. Both containers reach host port `5431` through
`host.docker.internal`, not the unrelated Compose network. Existing external
database exposure is a throwaway-staging limitation; developer access should
use SSH tunneling.

### Security and portability

Staging uses HTTPS and browser/API authentication. Its normal API runtime runs
in authenticated Person-context mode; the synthetic context remains limited to
one-shot operational migrations and explicitly selected test flows.

API remains stateless with environment configuration, probes, graceful
shutdown, and stdout/stderr logs. Migrations run as a one-shot service from the
same image digest. `STAGING_DATABASE_URL` is delivered through protected
Environment input into root-owned `/etc/shape-of-you/staging/api.env` mode
`0600`. No Kubernetes assets exist yet.

VM resources are limited and swap is in use. Current limits (`384m` API,
`64m` edge) require observation before adding load.

Identity runs from its independently published digest through the staging
overlay. The versioned deployment controller writes its database URL only to
root-owned `/etc/shape-of-you/staging/identity.env`, applies Identity-owned migrations,
reconciles the versioned predefined OAuth client policy through an
operations-only process, waits for database-aware readiness, and then starts
edge. The exact ChatGPT callback comes from the protected staging Environment
as non-secret external configuration and is never stored in the manifest or
deployment logs. API schema, Identity schema, and predefined-client
compatibility are declared independently; automatic rollback of an Identity
release requires all applicable declarations to be true. Edge/ACME owns TLS
certificates; Identity owns OAuth signing keys and OAuth client policy.

The root-owned runtime handoff also requires the Identity TOTP key ring, OAuth
active signing-key identifier, OAuth signing-key ring, and provider cookie key
ring whenever Identity deployment is enabled. API trust settings are fixed
public values in the staging Compose contract: the Identity issuer and JWKS
URI plus the external MCP resource
`https://staging.shape-of-you.ru/api/mcp`. Identity uses that same resource
identifier when issuing audience-bound access tokens.

The same root-owned API runtime handoff carries its browser-session signing key
ring. The key ring is a protected staging secret, is never exposed to the
static Web artifact, and lets the API verify a retained key during a bounded
rotation overlap.

The edge exposes the API-owned MCP endpoint at `/api/mcp` while its internal
route remains `/mcp`. Deploying the endpoint does not itself authorize a user:
the API migration, explicit Identity subject-to-User binding, registered
ChatGPT client, consent, and active Person grant remain separate gates.

## Evidence

- Read-only VM/container inventory, PostgreSQL 17.4 access evidence, and
  repository workflows/manifests.

## Decisions

- [Temporary shared-VM deployment](../../adr/20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
- [Verified main deployment control](../../adr/20260729-use-verified-main-for-staging-deployment-control.md)
- [Shared Host/SNI ingress](../../adr/20260805-route-shared-vm-ingress-by-host-and-sni.md)
- [Static Nuxt edge delivery](../../adr/20260807-serve-static-nuxt-client-through-existing-edge.md)
- [Predefined OAuth client reconciliation](../../adr/20260811-reconcile-predefined-oauth-clients-during-deployment.md)
- [API-owned browser sessions](../../adr/20260812-use-api-owned-browser-session-cookies.md)

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
