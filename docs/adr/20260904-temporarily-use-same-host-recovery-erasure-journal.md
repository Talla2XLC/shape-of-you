---
id: temporarily-use-same-host-recovery-erasure-journal
kind: adr
title: "Временно хранить Recovery erasure journal на PostgreSQL VM"
status: accepted
date: 2026-09-04
supersedes: "use-independent-typed-recovery-erasure-journal"
superseded_by: null
tags:
  - architecture
  - privacy
  - recovery
  - restore
  - sqlite
  - operations
---

# Временно хранить Recovery erasure journal на PostgreSQL VM

## Context

ADR `20260904-use-independent-typed-recovery-erasure-journal` выбрал typed
append-only SQLite journal и требовал durable independent copy вне failure
boundary PostgreSQL host. TASK-0098 подтвердил реальным owner-created backup,
что custom-format dump восстанавливается в изолированный PostgreSQL 17 и journal
replay подавляет возвращённые device-derived данные, сохраняя unrelated manual
data.

Проверка фактической инфраструктуры показала, что WAL/PITR archive выключен, а
автоматическая PostgreSQL backup policy не обнаружена. Существует одна вручную
созданная и проверенная same-host backup-копия без установленного срока
удаления. Владелец явно выбрал временное упрощение: journal остаётся на той же
ВМ, а риск одновременной потери database host и журнала принимается.

## Decision

Сохранить принятую typed модель Recovery erasure journal:

1. `accepted` intent записывается и durable-acknowledged до physical deletion;
2. `completed` event записывается после удаления dependency graph;
3. SQLite tables остаются append-only, типизированными, idempotent и защищёнными
   integrity chain и completeness checkpoint;
4. restore replay использует все применимые `accepted` events и остаётся
   fail-closed при missing, unreadable, modified или incomplete checkpoint.

Как временное эксплуатационное исключение live journal и sealed checkpoints
размещаются в отдельном owner-controlled каталоге на PostgreSQL VM. Этот каталог
обязан находиться вне PostgreSQL data/database boundary, release directories и
каталога manual backups. Directory permissions должны быть `0700`, journal и
checkpoint permissions — `0600`. Файлы не включаются в logical PostgreSQL dump,
release artifact или rollback package.

Пока для manual backups не установлен максимальный срок жизни, accepted и
completed markers, integrity history и sealed checkpoints хранятся бессрочно.
Удаление или сокращение retention требует отдельного решения владельца, которое
сначала ограничивает срок жизни всех restorable backups и добавляет safety
margin для journal retention.

Это решение гарантирует suppression после восстановления старого logical
PostgreSQL dump на сохранившейся ВМ. Оно не гарантирует восстановление после
полной потери, compromise или filesystem rollback этой ВМ. До отдельного
off-host/immutable решения это ограничение должно оставаться явным в runbook и
Architecture Review.

Provisioning каталога, создание первого live journal/checkpoint, service
integration, migration, deployment и direct Garmin ingestion не разрешаются
этим ADR автоматически и требуют своих operational gates.

## Considered alternatives

- **Сохранить обязательную off-host/immutable copy до Garmin.** Даёт правильную
  fault-domain isolation и остаётся рекомендуемым целевым состоянием, но
  владелец выбрал не вводить дополнительное хранилище сейчас.
- **Хранить journal внутри PostgreSQL.** Проще эксплуатировать, но старый dump
  откатывает и данные, и suppression markers; исходная цель не достигается.
- **Хранить journal рядом с manual backup.** Формально вне PostgreSQL, но
  повышает риск совместного удаления или ошибочного восстановления. Отклонено:
  journal получает отдельный каталог и lifecycle.
- **Не ограничивать срок жизни backups, но удалять старые markers.** Создаёт
  прямой resurrection risk. Отклонено; временная retention бессрочная.
- **Не выполнять owner-backed drill.** Оставляет решение только synthetic test
  evidence. Отклонено; TASK-0098 выполнил реальный изолированный restore.

## Consequences

- Старый logical dump не возвращает удалённые Recovery device facts, пока ВМ и
  complete journal checkpoint доступны.
- Не требуется новый deployable, network database, container или изменение
  общего PostgreSQL cluster/port `5431`.
- Journal и manual backup имеют разные каталоги и разные lifecycle boundaries.
- Storage остаётся single-host и не является disaster recovery; потеря ВМ
  остаётся принятым риском.
- При неизвестной максимальной жизни backup журнал нельзя очищать.
- Off-host/immutable copy может быть добавлена позже без изменения typed event
  model или restore replay contract.

## Verification

- Owner-created custom-format backup восстановлен с `--exit-on-error`,
  `--no-owner` и `--no-privileges` в отдельный loopback-only PostgreSQL 17 на
  port `55432`, не `5431`.
- Metadata-only verification подтвердила ожидаемую schema и оба journal marker
  columns без вывода application rows.
- `npm run test:recovery-restore` прошёл `2/2`, включая every-prefix migration
  gate и suppression deleted device/derived facts после real restore.
- Временный PostgreSQL был остановлен, local artifacts удалены с отдельным
  одобрением, remote manual backup сохранил mode `0600`, size и SHA-256.
- Перед direct Garmin ingestion отдельно проверяются наличие, private
  permissions и complete-through checkpoint в утверждённом same-host journal
  каталоге.

## Related material

- [Superseded independent journal decision](20260904-use-independent-typed-recovery-erasure-journal.md)
- [Recovery retention and authenticated erasure](20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)
- [Staging PostgreSQL backup and restore](../wiki/operations/postgresql-backup-and-restore.md)
- [Recovery and Readiness](../wiki/domain/recovery-and-readiness.md)

