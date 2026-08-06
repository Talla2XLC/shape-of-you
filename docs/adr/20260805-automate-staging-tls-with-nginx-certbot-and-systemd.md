---
id: "decisions-20260805-automate-staging-tls-with-nginx-certbot-and-systemd"
kind: adr
title: "Automate staging TLS with nginx, Certbot, and a root-owned systemd timer"
status: superseded
date: 2026-08-05
supersedes: []
superseded_by: "decisions-20260805-route-shared-vm-ingress-by-host-and-sni"
tags:
  - "acme"
  - "certbot"
  - "deployment"
  - "nginx"
  - "security"
  - "staging"
  - "tls"
---

# Automate staging TLS with nginx, Certbot, and a root-owned systemd timer

## Context

The shared-VM staging edge currently exposes containerized nginx over plain
HTTP on host port `3001`. WebAuthn requires a stable secure origin, and OAuth,
MCP, and future real-data access must not operate over this temporary public
HTTP endpoint. The project now owns `shape-of-you.ru`; exact staging DNS records
map `staging.shape-of-you.ru` and `identity.staging.shape-of-you.ru` to the
current VM.

TLS certificate issuance and renewal belong to the edge/ACME boundary, not to
the Identity service. Automation must preserve the existing constrained,
root-owned deployment control, must not grant an unprivileged container access
to the Docker socket, and must not expose ACME account state or certificate
private keys to application services.

## Decision

Retain nginx as the only public staging reverse proxy and use Certbot for ACME
certificate issuance and renewal.

Use the exact staging topology:

- public application/API origin: `https://staging.shape-of-you.ru`;
- Identity origin: `https://identity.staging.shape-of-you.ru`;
- staging WebAuthn RP ID: `identity.staging.shape-of-you.ru`;
- one certificate containing both exact DNS names; no wildcard certificate.

The nginx container publishes host ports `80` and `443`. Port `80` serves only
HTTP-01 challenges and redirects accepted hosts to HTTPS. Port `443` terminates
TLS. Unknown hosts fail closed. The Identity hostname returns a controlled
`503` response until the separately approved Identity deployment exists.

Run Certbot as a pinned, project-published operational image. Persist its ACME
account and renewal state separately from the HTTP-01 webroot and from the
narrow certificate copy mounted read-only into nginx. A project-owned helper
copies the current certificate chain and private key atomically into the nginx
serving volume with restrictive ownership and permissions. nginx never mounts
Certbot account state, and API/Identity containers never mount any TLS material.

For first issuance, run a temporary HTTP-only nginx bootstrap service, execute
Certbot with the webroot authenticator, install the issued material into the
serving volume, stop the bootstrap service, validate nginx configuration, and
start the TLS edge. Subsequent deployments reuse persistent state.

Install a root-owned oneshot renewal wrapper and systemd timer through the
existing operator-run root asset installer. The timer periodically executes
`certbot renew`, deterministically refreshes the nginx-serving copy, validates
nginx configuration, and reloads nginx. It does not pull images, modify DNS, or
receive Docker-socket access inside a container. Deployment and renewal share
a host lock so they cannot mutate certificate/runtime state concurrently.

Initial certificate issuance, systemd enablement, firewall changes, and other
host-bootstrap mutations remain explicit operator actions. After that bootstrap
is verified, repository automation performs ordinary staging deployments and
certificate renewal without repeating privileged host setup.

Gate the first cutover so the publish workflow can produce reviewed images
without deploying before the root-owned assets and firewall are ready. After
the operator explicitly dispatches and verifies the first HTTPS deployment,
retire the transitional gate and restore normal automatic staging deployment
for every successful `main` publication.

The first cutover completed on 2026-08-05. The transitional gate has therefore
been removed: a successful `main` pipeline now proceeds from quality through
image publication to staging deployment without another repository switch.

## Considered alternatives

- **Caddy with integrated Automatic HTTPS:** provides the smallest certificate
  lifecycle and avoids bootstrap/reload glue, but replaces the accepted nginx
  edge and its existing operational controls. Rejected after the operator chose
  to retain nginx.
- **Host-installed nginx and Certbot:** conventional and well supported, but
  discards the containerized edge boundary and couples nginx packages/config to
  the shared host. Rejected.
- **Containerized nginx with host-installed Certbot:** avoids a Certbot image but
  creates host package drift and awkward private-key permissions across the
  host/container boundary. Rejected in favor of a pinned operational image and
  isolated volumes.
- **Certbot container with Docker socket access:** simplifies reload hooks but
  grants a certificate utility effective root control of the host. Rejected.
- **Manual certificate issuance or renewal:** fewer initial components but
  creates an avoidable expiry outage and an unsafe operational dependency.
  Rejected.
- **DNS-01 and wildcard certificates:** useful for dynamic or private hosts, but
  requires DNS-provider credentials and broadens certificate scope. Rejected
  because both exact staging names are publicly reachable for HTTP-01.

## Consequences

- The staging VM must allow inbound TCP `80` and `443`; public port `3001` is
  removed after verified HTTPS cutover.
- Initial issuance is gated by public DNS convergence and exclusive ownership
  of ports `80` and `443`.
- The release contract gains an immutable Certbot image digest and non-secret
  ACME contact/public-IP inputs.
- The first rollout is two-phase so a push cannot race the required root-owned
  asset installation.
- The systemd timer and wrapper become root-owned operational assets and require
  explicit operator installation after review.
- Persistent ACME state prevents unnecessary account recreation and CA rate-
  limit pressure. The serving volume contains only the currently deployed
  certificate material required by nginx.
- Staging and production use different Identity RP IDs, so staging passkeys do
  not become production credentials.

## Verification

- Validate nginx bootstrap and TLS configurations in containers.
- Render Compose with complete release inputs and reject missing digests.
- Test the certificate installation helper with isolated fixture directories.
- Verify systemd unit syntax and timer scheduling.
- Statically verify that Certbot has no Docker socket and application
  services have no certificate volumes.
- Exercise first-issuance, renewal dry-run, HTTPS smoke, HTTP redirect, unknown-
  host denial, certificate SAN, expiry, and nginx reload on the VM only after
  separate operator approval.
- Run canonical documentation validation and the full repository quality gate.

## Related material

- [Identity service and protocol libraries](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Temporary shared-VM deployment](20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
- [Dedicated staging deployment identity](20260729-use-dedicated-staging-deployment-identity.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [Temporary VM deployment](../wiki/operations/temporary-vm-deployment.md)
