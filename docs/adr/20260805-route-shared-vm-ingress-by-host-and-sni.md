---
id: "decisions-20260805-route-shared-vm-ingress-by-host-and-sni"
kind: adr
title: "Support shared and standalone staging ingress adapters"
status: accepted
date: 2026-08-05
supersedes: ["decisions-20260805-automate-staging-tls-with-nginx-certbot-and-systemd"]
superseded_by: null
tags:
  - "acme"
  - "deployment"
  - "docker"
  - "nginx"
  - "security"
  - "staging"
  - "tls"
---

# Support shared and standalone staging ingress adapters

## Context

The temporary staging VM already runs an independently owned nginx container
that exclusively publishes host ports `80` and `443`. Shape of You cannot
publish those ports without replacing or coupling itself to that application.
Both applications must retain independent Compose lifecycles and independent
TLS certificate state, while one host-level boundary must select the correct
application for each public connection.

The earlier TLS decision incorrectly assumed exclusive Shape of You ownership
of host ports `80` and `443`. The operator accepts a maintenance window below
one hour for the topology cutover and does not require a dedicated Git
repository for the temporary shared ingress.

## Decision

Keep one base staging Compose model and two explicit deployment overlays:

- `compose.shared-ingress.yaml` attaches the edge to the operator-managed
  external network, publishes no host ports, and enables PROXY protocol.
- `compose.standalone.yaml` publishes host ports `80` and `443` directly and
  uses the socket client address without PROXY protocol.

Both overlays use one validated nginx configuration template, the same edge
image, Certbot image, ACME and serving volumes, application services, health
contract, and deployment scripts. The selected `DEPLOYMENT_TOPOLOGY` is
allowlisted as `shared-ingress` or `standalone`, stored in each secret-free
release manifest, and reused by renewal and rollback. The base Compose file is
not a complete ingress deployment without one overlay.

Current shared staging uses the following adapter.

Run a third, operator-owned Compose project at `/opt/shared-vm-ingress`. It is
the only project that publishes host ports `80` and `443`.

The shared ingress performs only transport and hostname routing:

- HTTP port `80` is routed by the validated `Host` header to the owning
  application edge. Application edges continue to serve HTTP-01 challenges and
  redirects.
- TLS port `443` is routed by ClientHello SNI through nginx `stream` and
  `ssl_preread`. The shared ingress does not terminate TLS and stores no
  certificates or ACME account state.
- Unknown HTTP hosts and unknown SNI names fail closed.
- The shared ingress sends PROXY protocol to the selected TLS edge so the
  application receives the original client address without terminating TLS.

Create one operator-managed external Docker network named
`shared-vm-ingress`. Each application Compose references only that stable
network name and declares its own unique alias. Shape of You uses
`shape-of-you-edge`; the other application owns its separate alias. Only the
shared ingress knows the complete host-to-alias routing table. No application
Compose references the other application, its project name, or its internal
network.

Shape of You nginx remains the TLS and ACME owner for
`staging.shape-of-you.ru` and `identity.staging.shape-of-you.ru`. It listens on
internal ports `8080` and `8443`, expects PROXY protocol on `8443`, applies
rate limits to the PROXY-provided client address, and publishes no host ports.
Its Certbot container, persistent volumes, restricted certificate serving
copy, and root-owned renewal timer remain project-owned.

On a dedicated VM, the standalone adapter removes the shared transport layer.
Shape of You nginx becomes the exclusive host-port owner while retaining the
same certificate and application state. Moving between adapters requires DNS,
host preparation, and an explicit deployment-topology change, but no
application, domain, migration, or certificate-ownership change.

The shared ingress is temporary host infrastructure without a remote Git
repository. Its operational source is the root-owned directory
`/opt/shared-vm-ingress`. Changes require an nginx configuration test, a local
timestamped backup, recorded image digest and checksums, and a tested rollback.
It must not be embedded in either application's Compose project. The canonical
runbook records the contract and reconstruction procedure without making Shape
of You the runtime owner of shared ingress.

The first cutover is a coordinated maintenance operation. Automatic Shape of
You deployment remains disabled through `STAGING_TLS_AUTOMATION_ENABLED` while
an explicitly dispatched deployment performs first certificate issuance and
HTTPS smoke. The gate is enabled only after the external network, both
application edges, shared ingress, root-owned Shape of You assets, certificate
issuance, and HTTPS smoke checks are ready. A push or a called workflow cannot
bypass the disabled gate.

## Considered alternatives

- **Terminate every certificate at the shared ingress:** simpler transport
  configuration, but centralizes unrelated private keys and couples certificate
  renewal to a shared component. Rejected.
- **Publish separate host ports and use the existing application nginx as an
  HTTP reverse proxy:** workable, but makes an unrelated application the TLS
  and routing owner for Shape of You. Rejected.
- **Use host networking and loopback-published application ports:** avoids an
  external Docker network but broadens host reachability and weakens isolation.
  Rejected.
- **Give the shared ingress a dedicated repository:** strongest audit and
  recovery model, but unnecessary for the accepted temporary VM lifetime. The
  root-owned directory plus backups and canonical runbook are accepted debt.
- **Attempt a zero-downtime socket handover:** possible with additional
  temporary listeners and coordination, but the operator accepts a sub-hour
  maintenance window. Rejected as unnecessary complexity.
- **Always deploy the shared ingress on a dedicated VM:** gives one topology
  everywhere but retains an unnecessary transport hop and operational object.
  Rejected.
- **One Compose file controlled by optional environment fragments:** reduces
  file count but makes port and external-network ownership implicit and harder
  to validate. Rejected in favor of explicit overlays.

## Consequences

- The two application Compose projects remain independently deployable and
  share only an explicitly named network contract.
- Restarting or replacing an application edge requires the shared ingress to
  resolve Docker aliases dynamically rather than cache container addresses.
- Network membership is a privileged infrastructure operation because PROXY
  protocol is trusted only across the operator-controlled ingress network.
- Shared-ingress configuration loss is recovered from the canonical runbook,
  the recorded digest/checksums, and root-owned local backups.
- The maintenance rollback restores the previous talking-to-ai port
  publication if shared routing or either application edge fails.
- The original temporary-VM decision is narrowed: Shape of You still does not
  own or modify the other application, but both operators explicitly accept
  the minimal shared ingress/network contract.
- A dedicated-VM move selects the standalone overlay and does not require a
  source-code fork or hand-edited Compose file.
- Automatic application rollback cannot cross topology modes. A topology move
  establishes a new rollback baseline after successful smoke rather than
  attempting to recreate the previous host boundary implicitly.

## Verification

- Render both Shape of You overlays. Confirm shared mode publishes no host
  ports and standalone mode publishes exactly `80` and `443` from edge.
- Render and syntax-test the single nginx template in both client-address
  modes.
- Validate shared nginx HTTP and stream configuration before every reload.
- Verify unknown Host and SNI inputs fail closed.
- Verify Docker aliases are re-resolved after an application edge replacement.
- Confirm TLS certificates and private keys exist only in their owning
  application volumes.
- Confirm Shape of You receives the external client address through PROXY
  protocol and rate limiting does not collapse all users into one proxy IP.
- Exercise HTTP-01 issuance, renewal, reload, HTTPS smoke, and rollback during
  the separately approved maintenance operation.

## Related material

- [Superseded direct-port TLS decision](20260805-automate-staging-tls-with-nginx-certbot-and-systemd.md)
- [Temporary shared-VM deployment](20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [Shared VM ingress](../wiki/operations/shared-vm-ingress.md)
- [Temporary VM deployment](../wiki/operations/temporary-vm-deployment.md)
