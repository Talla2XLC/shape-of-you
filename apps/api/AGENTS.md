# Deployable API Rules

## Boundary

`apps/api` is the only deployable backend at the current stage. Internal
domain modules are not separate services and do not receive separate runtime
credentials or databases.

## Data Ownership

- The API owns its PostgreSQL schema and migrations in `apps/api/drizzle/`.
- Cross-service SQL is forbidden.
- PostgreSQL is the operational authority after TASK-0067. The Google Sheets
  Fitness Tracker is a non-authoritative read-only legacy reference and is
  never an interactive writer or fallback.
- Global credentials and encryption keys enter only through the runtime
  environment. Person-owned OAuth tokens and Garmin Personal API keys enter
  through their approved integration flows and are stored only as authenticated
  ciphertext bound to provider, Person and connection. Never store secrets in
  the repository, logs, test snapshots, browser storage or documentation.

## Changes

- Change the public API only together with its runtime schemas in
  `packages/contracts`.
- Do not move domain implementation into contracts.
- A new deployable boundary, separate database, or integration requires an
  Architecture Review and an ADR.
- Do not implement corrections as a hidden overwrite.

## Code Documentation

- Document every exported runtime function, class, interface, and type with
  concise English TSDoc.
- Describe error behavior, lifecycle ownership, idempotency, ordering, and
  other non-obvious contracts where applicable.
- Keep comments contract-focused; do not narrate self-explanatory code.

## Validation

- `pnpm --filter @shape-of-you/api typecheck`
- `pnpm --filter @shape-of-you/api build`
- `pnpm --filter @shape-of-you/api test:unit`
- `pnpm --filter @shape-of-you/api test:integration` when Docker is available.
- Verify migrations against a clean PostgreSQL database.
