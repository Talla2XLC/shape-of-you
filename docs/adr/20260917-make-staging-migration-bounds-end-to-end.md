---
id: "decisions-20260917-make-staging-migration-bounds-end-to-end"
kind: adr
title: "Сделать пределы staging migrations сквозными и проверяемыми"
status: accepted
date: 2026-09-17
supersedes: []
superseded_by: null
tags:
  - "deployment"
  - "staging"
  - "migrations"
  - "reliability"
---

# Сделать пределы staging migrations сквозными и проверяемыми

## Context

Accepted ADR `decisions-20260903-bound-automatic-staging-delivery` ограничил
каждую migration внешним GNU `timeout` на 300 секунд и потребовал удалить
named one-shot container после failure. Два запуска одного staging release
показали, что этого недостаточно: Identity migration превысила внешний предел,
container продолжил работать, а последующий неограниченный `compose ps` завис
ещё примерно на 11 минут.

Read-only диагностика после инцидента подтвердила exact Identity journal `8/8`,
отсутствие постоянных PostgreSQL blockers и успешное изолированное выполнение
того же migration runner примерно за три секунды. Значит, корректность schema не
оправдывает повторный DDL для уже актуального журнала, а внешний timeout не
является сквозной границей для DB session, Docker diagnostics и cleanup.

## Decision

Atomic staging release с четырьмя immutable image coordinates сохраняется.
Identity migration остаётся обязательной; path-based skip, partial release и
ручной bypass не вводятся.

Перед вызовом Drizzle Identity runner читает committed local migration journal
и только metadata `drizzle.__drizzle_migrations`. Полное совпадение количества,
`created_at` и SHA-256 каждого элемента завершает runner как проверяемый no-op
без повторного DDL. Отсутствующий или точный отстающий prefix передаётся
существующему Drizzle migrator. Database journal, который опережает local
journal, содержит malformed metadata или отличается timestamp/hash внутри
prefix, останавливает deployment fail closed.

Migration database pool получает фиксированные process-owned session limits:
`lock_timeout` 30 секунд и `statement_timeout` 240 секунд. Они меньше внешнего
300-секундного предела и не меняют server-wide PostgreSQL settings или
deployment environment contract. Runner пишет только secret-safe фазовые
события readiness, journal check, apply, pool close и итог; SQL, connection URL,
параметры и пользовательские данные не логируются.

API и Identity one-shot migration services запускаются с `init: true`, чтобы
сигналы достигали дочернего процесса через корректный PID 1. Failure path
deployment script больше не вызывает неограниченный `compose ps`. Container
сначала получает bounded stop; optional diagnostics разрешены только после
подтверждения, что он больше не выполняет migration. Затем secret-safe bounded
Identity log tail, force-remove и проверка отсутствия выполняются через
отдельные короткие GNU `timeout`. Если остановка не подтверждена, log tail
пропускается и сразу выполняется force-remove. Для runner без secret-safe log
contract содержимое логов не печатается. Невозможность подтвердить отсутствие
named container остаётся failure независимо от исходного migration status.

Это решение дополняет и уточняет migration timeout и cleanup часть
`decisions-20260903-bound-automatic-staging-delivery`; остальные положения того
ADR остаются действующими.

## Considered alternatives

- Оставить только внешний 300-секундный timeout: отклонено, потому что реальный
  инцидент уже показал живущий после timeout container и зависшую диагностику.
- Пропускать Identity для API-only diff: отклонено, потому что diff одного push
  не доказывает отсутствие ожидающего Identity изменения после более раннего
  failed release и создаёт partial-release semantics.
- Сохранить atomic release, добавить exact no-op и сквозные внутренние пределы:
  принято как минимальное изменение, которое сохраняет ownership и fail-closed
  поведение.

## Consequences

Повторная доставка при exact Identity journal больше не выполняет Drizzle DDL.
Реально pending migrations продолжают применяться тем же владельцем и тем же
инструментом. Drift журнала становится явной ошибкой вместо молчаливого
принятия только последней записи.

Failure завершается в ограниченное время на каждом известном DB/Docker этапе,
а диагностика показывает фазу без секретов. Появляются дополнительные
контрактные тесты и небольшая зависимость runner от формата Drizzle journal.
Изменение этого формата потребует обновить сравнение вместе с версией Drizzle.

OAuth reconciliation, data ownership, database credentials, shared ingress,
root bootstrap, `shape-deploy` privilege boundary и production topology не
меняются.

## Verification

- Unit tests проверяют exact, behind, ahead, hash/timestamp drift и malformed
  journal.
- Identity integration tests проверяют первый apply, повторный no-op и реальные
  session-local statement limits.
- Staging shell contracts проверяют bounded inspect/log/remove/absence paths,
  cleanup failure и отсутствие неограниченного `compose ps`.
- Rendered Compose contract подтверждает `init: true` для обеих migration
  services.
- Identity lint, typecheck, build, tests, staging contracts, workspace tests,
  docs validation и `git diff --check` проходят до Quality review.

## Related material

- [Предыдущее решение о bounded automatic staging delivery](20260903-bound-automatic-staging-delivery.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [Backend migrations](../wiki/data/backend-migrations.md)
- [Temporary VM deployment](../wiki/operations/temporary-vm-deployment.md)
- [TASK-0116 implementation plan](../../plans/2026/09/completed/2026-09-17-task-0116-harden-staging-identity-migration.md)
