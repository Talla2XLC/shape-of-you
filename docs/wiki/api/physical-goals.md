---
id: "architecture-api-physical-goals"
kind: architecture
title: "API PhysicalGoal"
status: draft
tags:
  - "api"
  - "contract"
  - "goals"
  - "physical-state"
---

# API PhysicalGoal

## Кратко

API хранит стабильный `PhysicalGoal` root и неизменяемые версии intent и
criteria. Lifecycle root использует optimistic concurrency, а выбранная
current version обязана принадлежать тому же goal и `Person`.

## Содержание

Endpoints:

- `POST /v1/physical-goals` — создаёт draft root и version `1`;
- `POST /v1/physical-goals/:id/versions` — добавляет immutable draft version;
- `POST /v1/physical-goals/:id/versions/:version/activate` — атомарно выбирает
  current version;
- `POST /v1/physical-goals/:id/complete` — завершает active goal;
- `POST /v1/physical-goals/:id/cancel` — отменяет draft или active goal;
- `GET /v1/physical-goals/:id` — current и latest version;
- `GET /v1/physical-goals/:id/history` — root и версии в порядке version ASC;
- `GET /v1/physical-goals?status=active` — person-scoped список со stable order
  `(createdAt DESC, id DESC)`.

Create/version command содержит обязательный narrative `intent`, nullable
`effectiveFrom` и `targetDate`, typed `sourceReference`, `dedupeKey` и массив
criteria. Criteria допускают `directional`, `exact`, `range` и `dynamic`.
Narrative или dynamic goal не требует выдуманного numeric target.

Lifecycle commands требуют `expectedLockVersion`. Устаревшая версия lock
возвращает `409`. `completed` и `cancelled` являются terminal states.

## Основания

- `packages/contracts/src/physical-goal.ts`.
- `apps/api/src/physical-goals/`.
- PostgreSQL integration tests Physical State.

## Решения

- Версии не обновляются и не удаляются через публичный API.
- Current version переключается только на версию того же goal и `Person`;
  invariant защищают application transaction и composite foreign key.
- Progress не хранится mutable-копией внутри goal и будет вычисляться по
  authoritative physical facts.

## Открытые вопросы

- Primary-goal cardinality после появления нескольких параллельных целей.
- Политика автоматического предложения новой goal version.

## Связанные материалы

- [PhysicalGoal](../domain/physical-goal.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Backend migration notes](../data/backend-migrations.md)

