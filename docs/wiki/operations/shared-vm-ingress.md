---
id: "operations-shared-vm-ingress"
kind: architecture
title: "Shared VM ingress"
status: draft
tags:
  - "docker"
  - "ingress"
  - "nginx"
  - "staging"
---

# Shared VM ingress

## Summary

The temporary VM has one operator-owned nginx Compose project that publishes
host ports `80` and `443`. It routes HTTP by Host and opaque TLS by SNI to
independently owned application edges over an external Docker network.

## Content

### Ownership and filesystem

The operational source is `/opt/shared-vm-ingress`; it is not part of either
application Compose project and currently has no remote Git repository.

```text
/opt/shared-vm-ingress/
├── compose.yaml
├── nginx.conf
├── manifest.sha256
└── backups/
```

All files and directories are `root:root`; configuration files are not
writable by application deployment identities. Before every change, copy the
current files to a timestamped directory under `backups/`. Record the pinned
nginx image digest and SHA-256 checksums in `manifest.sha256` after a successful
cutover. Do not store certificates, private keys, application environment, or
Docker credentials there.

### Shared network contract

The operator creates the network once:

```sh
docker network create \
  --driver bridge \
  --subnet 172.30.0.0/24 \
  --gateway 172.30.0.1 \
  shared-vm-ingress
```

Read-only VM inventory on 2026-08-05 confirmed that Docker and host routes use
`172.17.0.0/16` through `172.20.0.0/16` and do not overlap
`172.30.0.0/24`. The explicit subnet makes the PROXY-protocol trust boundary
stable after network recreation. Re-run route/network inventory before
recreating it on another host.

Every application references it as an external network. Shape of You owns only
the alias `shape-of-you-edge`. The other application owns
`talking-to-ai-edge`. Neither application references the other's project,
services, or private networks.

Only operator-controlled edge containers may join this network. TLS backends
accept PROXY protocol from this boundary, so arbitrary workload membership
would permit client-address spoofing.

### Shared nginx contract

Use an nginx image selected and pinned by full digest after confirming that it
contains the stream and `ssl_preread` modules. The container:

- publishes host `80` to its internal HTTP listener;
- publishes host `443` to its internal stream listener;
- joins only `shared-vm-ingress`;
- mounts only the read-only shared nginx configuration;
- has no Docker socket, certificate volume, application secret, or private
  application network;
- dynamically resolves Docker aliases through `127.0.0.11`, so replacing an
  application edge does not require a shared-ingress restart.

The image selected on 2026-08-05 is the official stable build:

```text
nginx:1.28.3-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
```

Its inspected build includes `--with-stream` and
`--with-stream_ssl_preread_module`. Review a future upgrade separately and
replace both tag and digest together.

The HTTP routing table sends these hosts to the corresponding HTTP edge:

```text
staging.shape-of-you.ru           -> shape-of-you-edge:8080
identity.staging.shape-of-you.ru  -> shape-of-you-edge:8080
talking-to-ai.ru                  -> talking-to-ai-edge:80
www.talking-to-ai.ru              -> talking-to-ai-edge:80
api.talking-to-ai.ru              -> talking-to-ai-edge:80
auth.talking-to-ai.ru             -> talking-to-ai-edge:80
dev.talking-to-ai.ru              -> talking-to-ai-edge:80
```

The TLS SNI table uses the same ownership but targets
`shape-of-you-edge:8443` and `talking-to-ai-edge:443`. The stream listener sets
`ssl_preread on` and `proxy_protocol on`. Unknown HTTP hosts return `444`;
unknown SNI values are sent to a closed local discard target and cannot reach
an application.

The common HTTP proxy preserves `Host`, adds `X-Real-IP` and
`X-Forwarded-For`, and does not serve ACME files itself. Each application edge
continues to own HTTP-01 content, redirects, certificates, renewal, and TLS
policy.

Before activation, validate the exact selected image and configuration:

```sh
docker compose --project-directory /opt/shared-vm-ingress config --quiet
docker compose --project-directory /opt/shared-vm-ingress \
  run --rm --no-deps ingress -c /etc/nginx/nginx.conf -t
```

The reconstructible root-owned `compose.yaml` is:

```yaml
services:
  ingress:
    image: nginx:1.28.3-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
    entrypoint: ["nginx"]
    command: ["-c", "/etc/nginx/nginx.conf", "-g", "daemon off;"]
    user: "101:101"
    ports:
      - "80:8080"
      - "443:8443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    networks:
      - shared_ingress
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    stop_grace_period: 10s
    healthcheck:
      test: ["CMD-SHELL", "kill -0 1"]
      interval: 10s
      timeout: 2s
      retries: 3
    mem_limit: 64m
    pids_limit: 64
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"

networks:
  shared_ingress:
    external: true
    name: shared-vm-ingress
```

The reconstructible `nginx.conf` is:

```nginx
worker_processes auto;
pid /tmp/nginx.pid;

events {
    worker_connections 1024;
}

http {
    access_log /dev/stdout;
    error_log /dev/stderr warn;
    server_tokens off;

    client_body_temp_path /tmp/client_temp;
    proxy_temp_path /tmp/proxy_temp;
    fastcgi_temp_path /tmp/fastcgi_temp;
    uwsgi_temp_path /tmp/uwsgi_temp;
    scgi_temp_path /tmp/scgi_temp;

    resolver 127.0.0.11 valid=10s ipv6=off;

    map $host $http_backend {
        default "";

        staging.shape-of-you.ru shape-of-you-edge:8080;
        identity.staging.shape-of-you.ru shape-of-you-edge:8080;

        talking-to-ai.ru talking-to-ai-edge:80;
        www.talking-to-ai.ru talking-to-ai-edge:80;
        api.talking-to-ai.ru talking-to-ai-edge:80;
        auth.talking-to-ai.ru talking-to-ai-edge:80;
        dev.talking-to-ai.ru talking-to-ai-edge:80;
    }

    server {
        listen 8080 default_server;

        if ($http_backend = "") {
            return 444;
        }

        location / {
            proxy_pass http://$http_backend;
            proxy_http_version 1.1;
            proxy_connect_timeout 5s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto http;
            proxy_set_header Connection "";
        }
    }
}

stream {
    resolver 127.0.0.11 valid=10s ipv6=off;

    log_format stream '$remote_addr [$time_local] '
                      '$ssl_preread_server_name $status '
                      '$bytes_sent $bytes_received $session_time '
                      '$upstream_addr';
    access_log /dev/stdout stream;
    error_log /dev/stderr warn;

    map $ssl_preread_server_name $tls_backend {
        default 127.0.0.1:9;

        staging.shape-of-you.ru shape-of-you-edge:8443;
        identity.staging.shape-of-you.ru shape-of-you-edge:8443;

        talking-to-ai.ru talking-to-ai-edge:443;
        www.talking-to-ai.ru talking-to-ai-edge:443;
        api.talking-to-ai.ru talking-to-ai-edge:443;
        auth.talking-to-ai.ru talking-to-ai-edge:443;
        dev.talking-to-ai.ru talking-to-ai-edge:443;
    }

    server {
        listen 8443;
        ssl_preread on;
        proxy_protocol on;
        proxy_connect_timeout 5s;
        proxy_timeout 1h;
        proxy_half_close on;
        proxy_pass $tls_backend;
    }
}
```

### Application edge requirements

Shape of You publishes no host ports. Its bootstrap and TLS edge use the same
`shape-of-you-edge` alias at different times. The TLS listener requires PROXY
protocol and uses `$proxy_protocol_addr` for request limiting and forwarded
client headers.

The talking-to-ai owner must:

1. remove host publication of ports `80` and `443` from its nginx service;
2. attach that service to external network `shared-vm-ingress` with alias
   `talking-to-ai-edge`;
3. retain its internal HTTP listener on `80` and TLS listener on `443`;
4. add `proxy_protocol` to every public TLS `listen` directive and use the
   PROXY-provided address for logging, forwarding, and per-client controls;
   the standard nginx form is `set_real_ip_from 172.30.0.0/24` with
   `real_ip_header proxy_protocol`;
5. retain ownership of its existing Certbot state and renewal process.

Changing only a host port mapping is insufficient because it neither creates
the shared network route nor preserves client addresses.

### Maintenance cutover

The operator-approved maintenance window is below one hour.

1. Back up the current talking-to-ai Compose and nginx configuration.
2. Create and inspect `shared-vm-ingress`.
3. Prepare the root-owned shared ingress files and validate them without
   publishing host ports.
4. Update both application edges with their network aliases and PROXY protocol
   contract.
5. Stop the old talking-to-ai host port publication.
6. Start the shared ingress as the sole owner of host ports `80` and `443`.
7. Start the talking-to-ai edge and verify all existing hosts.
8. Install the reviewed Shape of You root assets and explicitly dispatch its
   first TLS deployment while the automatic gate remains disabled. The
   deployment verifies HTTP routing before requesting a certificate.
9. Verify certificates, external client addresses, redirects, health, API,
   Identity placeholder, unknown-host rejection, and renewal timer.
10. Enable `STAGING_TLS_AUTOMATION_ENABLED` only after the complete cutover
    passes.

### Rollback

If shared routing or either edge fails, stop the shared ingress, restore the
backed-up talking-to-ai Compose/nginx files, restore its previous host port
publication, and restart that project. Keep Shape of You automatic deployment
disabled. Application databases, ACME state, and certificate volumes are not
deleted or rolled back.

## Evidence

- Accepted ingress ADR, Shape of You Compose/nginx contract, and the read-only
  inventory of the existing talking-to-ai nginx container.

## Decisions

- [Shared Host/SNI ingress](../../adr/20260805-route-shared-vm-ingress-by-host-and-sni.md)

## Open questions

- Select and record the compatible nginx image digest after module validation
  on the VM.
- Record the final shared-ingress configuration checksum and cutover evidence.

## Related material

- [Shape of You deployment](temporary-vm-deployment.md)
- [Shape of You rollback](temporary-vm-rollback.md)
- [Deployment topology](../architecture/deployment.md)
