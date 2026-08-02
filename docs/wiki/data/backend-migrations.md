---
id: "data-backend-migrations"
kind: data
title: "Backend migration notes"
status: draft
tags:
  - "drizzle"
  - "migration"
  - "postgresql"
---

# Backend migration notes

## Summary

PostgreSQL schema is defined in `apps/api/src/database/schema.ts`; versioned
SQL migrations live in `apps/api/drizzle/`.

## Content

```powershell
pnpm db:generate
pnpm db:migrate
```

The API image contains the migration runner, but the normal API process never
runs migrations. Local Compose and staging use a one-shot migration service
from the same image digest. Drizzle journal applies only pending SQL files.

Migration sequence:

1. initial `weight_measurements` and `weight_measurement_source`;
2. Person/User/access grants, SourceReference, Person dedupe, supersession, and
   migration of legacy public provenance to private source snapshot;
3. rename enum to `source_channel`; add BodyMeasurementSession values and
   versioned PhysicalGoal;
4. enforce Goal/Person ownership with composite foreign keys;
5. layered Nutrition catalog, immutable versions/composition, overlays, staged
   sources, Meal snapshots/corrections;
6. versioned Exercise catalog, overlays/staging, programs, sessions,
   performed exercises/sets, one-active-program and correction constraints;
7. Recovery providers/connections/consent/devices, typed observations,
   versioned assessment policies, assessments/evidence;
8. Coaching policies, typed recommendations, decisions, training adjustments,
   Recovery/Training evidence;
9. Intake requests/items, typed Weight detail, lease queue, timeline,
   relational idempotency, and typed fact link without JSON/JSONB payload.

The central PostgreSQL test applies the full journal to a clean database,
re-runs idempotently, and upgrades every committed non-empty journal prefix.
It verifies order, `created_at`, and SQL SHA-256 in
`drizzle.__drizzle_migrations`. A separate test preserves synthetic legacy
Weight migration. The chain does not import Google Sheets, backfill operational
data, or transfer authority.

Never modify an accepted applied migration; generate a new file.

## Evidence

- All SQL files in `apps/api/drizzle/`, migration runner, Drizzle schema, and
  migration/domain integration tests.

## Decisions

- Use codebase-first `drizzle-kit generate` plus `drizzle-orm` migrator.
- `drizzle-kit push` is not a delivery path.

## Open questions

- Shared-cluster retention policy. Staging through Coaching was applied and
  smoke-tested on 2026-08-01; later migration deployment needs its own release
  evidence.

## Related material

- [PostgreSQL ADR](../../adr/20260728-use-postgresql-with-drizzle-orm-and-kit.md)
- [Local development](../architecture/local-development.md)
- [Intake](../domain/intake.md)
- [Deployment runbook](../operations/temporary-vm-deployment.md)
