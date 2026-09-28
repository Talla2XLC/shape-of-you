---
id: accept-single-vm-identity-recovery-risk
kind: adr
title: "Временно восстанавливать Identity и API из копий на одной VM"
status: proposed
date: 2026-09-28
supersedes: []
superseded_by: null
tags:
  - architecture
  - backup
  - identity
  - postgresql
  - restore
---

# Временно восстанавливать Identity и API из копий на одной VM

## Context

Identity и API владеют разными базами в общем PostgreSQL cluster. Staging
logical backups от 2026-09-28 восстановлены в изолированных PostgreSQL 17
instances. Копии, рабочие базы и Recovery erasure journal находятся на одной
VM. WAL/PITR и автоматические backup jobs не подтверждены. При потере VM эти
копии и journal могут быть потеряны вместе с базами; последний drill также не
проверял роли/ACL.

Сейчас доступна только эта VM. Оператор временно принимает риск её полной
потери. Прежнее предложение об off-host PITR с RPO ≤ 1 час и RTO ≤ 4 часа
невыполнимо в этой границе и не должно фигурировать как достигнутый или
обещанный production recovery contract.

## Decision

Предлагается временный single-VM recovery contract:

1. Владелец PostgreSQL хранит отдельные owner-controlled custom-format logical
   backups Identity и API вне PostgreSQL data, release и Recovery journal
   directories. Автоматическое расписание, проверка завершения, ограниченный
   срок хранения и alert на отсутствие свежей проверенной пары backup должны
   быть утверждены и включены до production. Ручной backup без этих свойств
   остаётся только проверенным checkpoint, а не production policy.
2. У двух `pg_dump` нет общего атомарного recovery point. Restore выбирает
   документированную пару архивов и проверяет согласованность Identity
   subject-to-API User binding; повреждённая или несовместимая пара не
   открывается для трафика. Нельзя обещать cluster-consistent PITR или RPO для
   полной потери VM.
3. Recovery erasure journal и sealed checkpoints сохраняют действующую
   отдельную same-host границу, установленную принятым ADR. Перед открытием
   API применяется complete-through checkpoint до утверждённого cutoff.
   Missing, unreadable или incomplete journal блокирует readiness и трафик.
   Его retention превышает максимальную жизнь любого restorable backup с
   утверждённым запасом; пока срок backup не ограничен, journal хранится
   бессрочно.
4. Restore drill запускается в изоляции без внешнего ingress и без изменения
   рабочего cluster. Для обеих баз проверяются migration journals, ожидаемые
   таблицы, роли/ACL и синтетические read/write; отдельно проверяются OAuth
   issuer/subject binding, JWKS trust и запрет доступа к Person без API-owned
   grant. Приватные signing и TOTP keys не считаются частью PostgreSQL backup.
5. Для локально восстановимых инцидентов измеряются возраст последней
   проверенной пары backup и время полного restore со smoke. Порог свежести,
   расписание, retention и владелец реакции на alert утверждаются до
   production. При полной потере или компрометации VM гарантированных RPO/RTO
   нет; продукт может потерять все данные и возможность восстановления.
6. Это временное исключение пересматривается при появлении независимого
   хранилища или смене VM topology. Off-host encrypted backup и независимая
   копия Recovery journal остаются следующим шагом для защиты от потери VM;
   переход требует отдельного решения и измеренного restore drill.

Это проект решения. Он не запускает backup jobs, не меняет PostgreSQL и не
разрешает доступ к production или секретам.

## Considered alternatives

- **Off-host full/base backup и WAL/PITR.** Даёт единый recovery point и
  измеримый RPO при потере VM. Пока нет независимого хранилища и согласованной
  эксплуатации общего cluster; откладывается, а не считается реализованным.
- **Off-host encrypted logical backups.** Требуют меньше изменений cluster,
  но две базы восстанавливаются из неатомарных snapshots. При появлении
  внешнего хранилища это допустимый первый шаг с явной проверкой согласованности.
- **Только нынешние ручные same-host dumps.** Уже позволили проверить restore,
  но без расписания, свежести, alert и retention не образуют production policy.
  Отклонены как конечное состояние временного решения.
- **Managed PostgreSQL или вторая VM.** Улучшают fault isolation, но меняют
  topology и стоимость. Не требуются для выбранного временного этапа.

## Consequences

- Изолированный restore защищает от части логических ошибок и неудачных
  миграций, пока VM, backups и complete Recovery journal доступны.
- Single-VM production не имеет disaster recovery при потере VM. Принятие
  этого риска не делает backup полноценным и не подтверждает RPO/RTO.
- Нужно ограничить срок хранения backup до любого сокращения journal
  retention; роль владельца общего PostgreSQL cluster сохраняется.
- Separate dumps могут расходиться по времени; несовместимая пара оставляет
  восстановленную среду закрытой.
- При добавлении off-host storage модель service-owned баз и fail-closed
  Recovery replay сохраняется.

## Verification

- Владелец PostgreSQL утверждает расписание, максимальный возраст проверенной
  пары, retention, права доступа и alert; отсутствие одного из этих пунктов
  оставляет production backup gate открытым.
- Изолированный drill из реальной пары архивов восстанавливает обе базы,
  проверяет роли/ACL, migration journals, synthetic read/write, Identity/API
  binding и complete Recovery journal replay до открытия трафика.
- Negative drill с отсутствующим или неполным journal, повреждённым backup и
  несовместимой парой архивов оставляет среду закрытой.
- Результат фиксирует только timestamps, checksums, версии и технические
  исходы без Person-данных, credentials или dump content. Измеренный возраст
  backup и время восстановления сравниваются с утверждёнными локальными
  порогами; VM-loss RPO/RTO не заявляются.

## Related material

- [Staging PostgreSQL backup and restore](../wiki/operations/postgresql-backup-and-restore.md)
- [Temporary same-host Recovery erasure journal](20260904-temporarily-use-same-host-recovery-erasure-journal.md)
- [Independent typed Recovery erasure journal](20260904-use-independent-typed-recovery-erasure-journal.md)
- [Identity service ADR](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Production hardening plan](../../plans/2026/09/2026-09-28-identity-production-hardening.md)
