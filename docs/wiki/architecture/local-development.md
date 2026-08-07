---
id: "architecture-local-development"
kind: architecture
title: "Local backend development"
status: accepted
tags:
  - "development"
  - "docker"
  - "runtime"
---

# Local development

## Summary

Full local development uses Node.js 24, pnpm 11, and Docker Compose. API and
Identity retain separate PostgreSQL databases, credentials, migration jobs,
and runtime services. The Nuxt client runs on the host in watch mode.

## Content

Containerized startup:

```sh
pnpm local:up
```

After readiness, API is available at `http://localhost:3000` and Identity at
`http://localhost:3001`:

```sh
curl --fail http://localhost:3000/health
curl --fail http://localhost:3000/ready
curl --fail http://localhost:3001/live
curl --fail http://localhost:3001/ready
```

The Compose databases use project-scoped persistent volumes. Stop services
without deleting data with `pnpm local:down`. `pnpm local:reset` explicitly
deletes both local database volumes.

For host-based watch mode, create service-owned local environment files and
start only the database dependencies first:

```sh
pnpm install
cp apps/api/.env.example apps/api/.env.local
cp apps/identity/.env.example apps/identity/.env.local
pnpm local:dependencies
pnpm local:migrate
pnpm dev
```

The ignored `.env.local` files belong to their service and must contain only
local credentials. Database commands always name their owner:

```sh
pnpm db:generate:api
pnpm db:migrate:api
pnpm db:generate:identity
pnpm db:migrate:identity
```

Host watch mode serves the Nuxt client at `http://localhost:3002`. Its Vite
development proxy keeps Identity browser requests same-origin while forwarding
Identity-owned paths to `http://localhost:3001`. Identity uses the exact client
origin `http://localhost:3002` for WebAuthn and session-cookie validation. This
proxy is development-only; staging applies the same route ownership at the
existing edge.

OAuth and MCP are optional in host watch mode. Enable them only with local-only
keys by setting all of the following service-owned values:

```text
apps/api/.env.local:
IDENTITY_OAUTH_ISSUER
IDENTITY_OAUTH_JWKS_URI
IDENTITY_OAUTH_RESOURCE

apps/identity/.env.local:
IDENTITY_OAUTH_ACTIVE_SIGNING_KEY_ID
IDENTITY_OAUTH_SIGNING_KEYS
IDENTITY_OAUTH_COOKIE_KEYS
IDENTITY_OAUTH_RESOURCE
```

The three API values are an all-or-none group. With the example local ports,
the MCP resource is `http://127.0.0.1:3000/mcp`, Identity is
`http://127.0.0.1:3001`, and JWKS is available under `/oauth/jwks`. The checked-
in environment examples contain names and safe placeholders only; ignored
local files hold the generated local secrets.

After API migrations and explicit creation of the API User/Person grant, bind
the Identity subject without manual SQL:

```sh
cd apps/api
node --env-file=.env.local --import tsx \
  src/commands/bind-identity-subject.ts \
  --issuer http://127.0.0.1:3001 \
  --subject <identity-subject> \
  --user-id <api-user-uuid>
```

The binding is idempotent and rejects a conflicting mapping. Default
`pnpm local:up` remains a secret-free API/Identity development stack and does
not invent OAuth signing keys or operator bindings.

Package integration tests continue to use isolated PostgreSQL Testcontainers.
They do not apply SQL to developer, staging, or operator databases.

Cross-service smoke uses a separate disposable Compose project:

```sh
pnpm test:e2e
```

The runner assigns ephemeral host ports, waits for both migration chains and
runtime readiness, verifies API and Identity liveness/readiness through their
internal network, and always removes its containers, volumes, networks, and
project-built images. CI executes the same command.

Frontend browser contracts run against the generated static output with
Playwright Chromium and a virtual WebAuthn authenticator:

```sh
pnpm --filter @shape-of-you/web exec playwright install chromium
pnpm test:e2e:web
```

The suite verifies same-origin navigation, fragment-only enrollment authority,
passkey enrollment and sign-in, absence of bearer persistence, and CSRF on
security mutations. Identity responses are bounded route fixtures, so the
suite exercises the browser client deterministically without creating local
accounts. Local edge, TLS, OAuth flow automation, and MCP OAuth smoke remain
outside this E2E increment.

Validation:

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm test:e2e:web
node scripts/validate-docs.mjs
```

`pnpm test` includes PostgreSQL integration tests and needs a working container
runtime. `pnpm test:e2e` additionally builds and verifies the disposable local
stack. `pnpm test:e2e:web` builds the static client and runs headless browser
contracts. `pnpm test:unit` runs fast Docker-free checks.

## Evidence

- Workspace manifests, service-owned `.env.example` files, Compose, service
  Dockerfiles, E2E runner, and verified build/typecheck/lint/unit/integration
  checks.

## Decisions

- [Docker Compose for local development](../../adr/20260728-use-docker-compose-for-local-development.md).

## Open questions

- Add an edge-routed OAuth/MCP E2E scenario with disposable local signing keys
  and explicit fixture bindings.

## Related material

- [Backend runtime](backend-runtime.md)
- [Migration notes](../data/backend-migrations.md)
