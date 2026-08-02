---
id: "operations-postgresql-ssh-tunnel"
kind: architecture
title: "SSH tunnel to staging PostgreSQL"
status: draft
tags:
  - "postgresql"
  - "ssh"
  - "staging"
---

# SSH tunnel to staging PostgreSQL

## Summary

PostgreSQL is externally reachable on port `5431` without SSL. IDE access
should use an SSH tunnel so database traffic is not plaintext on the public
network.

## Content

After separate SSH approval:

```sh
ssh -N -L 15431:127.0.0.1:5431 <ssh-user>@2.58.15.24
```

IDE connection:

```text
host: 127.0.0.1
port: 15431
database: shape_of_you_api
user: shape_of_you_api
SSL: disabled
```

Verify host key through a trusted channel. Never copy private keys into the
repository, documentation, or task timeline. Direct port exposure belongs to
the existing PostgreSQL deployment and is not Shape of You security topology.

## Evidence

- Confirmed PostgreSQL 17.4 access without SSL and throwaway-staging gate.

## Decisions

- Tunnel is recommended for IDE only; API uses
  `host.docker.internal:5431`.

## Open questions

- External-port firewall policy belongs to the VM owner.

## Related material

- [Deployment topology](../architecture/deployment.md)
- [Deployment runbook](temporary-vm-deployment.md)
