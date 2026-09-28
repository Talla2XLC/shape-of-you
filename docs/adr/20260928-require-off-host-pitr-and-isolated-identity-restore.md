---
id: require-off-host-pitr-and-isolated-identity-restore
kind: adr
title: "Восстанавливать Identity и API из независимых копий с проверенным RPO"
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

# Восстанавливать Identity и API из независимых копий с проверенным RPO

## Context

Identity и API владеют разными базами в общем PostgreSQL cluster. Успешные
staging logical backup и изолированный restore от 2026-09-28 подтверждают
читаемость архивов, но копии находятся на той же VM. Потеря VM может удалить
живые базы и оба backup. Автоматический WAL/PITR на staging не подтверждён.
Роли/ACL в последнем restore drill не проверялись.

Восстановление API также должно применить независимый Recovery erasure journal
до открытия трафика. Текущий same-host journal защищает от восстановления
старого logical dump, но не от потери VM. Его retention зависит от максимального
срока жизни всех restorable backups и PITR window. Нельзя обещать production
RPO для Identity, оставив эти связанные ограничения неразрешёнными.

## Decision

Предлагается production recovery contract:

1. Целевой RPO для обеих service-owned баз при полной потере production VM —
   **не более 1 часа**. Предлагаемый RTO от объявления инцидента до
   smoke-verified работоспособности — **не более 4 часов**; оба значения
   подлежат явному утверждению владельцем продукта и инфраструктуры.
2. Владелец PostgreSQL организует регулярный full/base backup и off-host
   encrypted WAL archiving/PITR для общего cluster. Recovery target выбирается
   единым моментом для Identity и API. Состояние других баз общего cluster
   остаётся в компетенции его владельца: Shape of You не получает доступ к ним
   и не проводит их restore. Выбранная storage площадка, ключ шифрования,
   права, географическая независимость и срок хранения утверждаются отдельно
   до включения задания.
3. Успех backup означает наличие независимой проверенной копии full/base
   backup и WAL, покрывающего целевой момент. Мониторинг сообщает об отставании
   archiving, возрасте последней восстанавливаемой точки и ошибке проверки
   раньше нарушения RPO; один успешный job без restore evidence не считается
   выполненным recovery contract.
4. Restore запускается только в изолированной среде без внешнего ingress.
   Проверяются Identity и API migration journals, ожидаемые таблицы,
   роли/ACL, синтетические read/write, OAuth issuer/subject binding, JWKS trust
   и отсутствие доступа к Person без API-owned grant. Ключи OAuth, TOTP и
   cookie signing восстанавливаются из отдельного approved secret provider;
   PostgreSQL backup не содержит их приватный материал.
5. Независимый Recovery erasure journal и sealed checkpoints копируются в
   off-host/immutable boundary отдельно от PostgreSQL. Перед открытием API
   применяется complete-through checkpoint до утверждённого cutoff.
   Отсутствие или неполнота journal блокирует readiness и трафик. Срок
   хранения journal превышает максимальную жизнь любого restorable backup и
   PITR window с утверждённым запасом.
6. Плановый изолированный restore drill измеряет фактический RPO/RTO и
   проверяет отказ при missing backup/WAL/journal. Итог фиксирует только
   временные метки, контрольные суммы, версии и технические результаты без
   персональных данных, credentials или dump content.

Это проект решения. Он не включает запуск backup, доступ к общему cluster,
изменение конфигурации PostgreSQL или перенос production данных.

## Considered alternatives

- **Частые зашифрованные logical backups обеих баз с off-host копией.** Проще
  для небольшого объёма и не требует cluster-level WAL archiving. Однако
  отдельные dumps не имеют одного cluster-consistent recovery point, а
  расписание и длительность копирования усложняют доказательство RPO ≤ 1 час.
  Допустимы как временный вариант только после измеренного drill и явного
  согласования риска рассинхронизации. Не выбраны основным контрактом.
- **Same-host ручные dumps.** Уже полезны для проверки миграций и логического
  rollback, но не переживают потерю VM. Отклонены для production disaster
  recovery.
- **Независимый managed PostgreSQL для каждого deployable.** Упрощает
  ownership backup и изоляцию, но меняет topology и стоимость раньше, чем
  измерена потребность. Не требуется этим решением.
- **PITR общего cluster с независимым журналом удалений.** Даёт единый
  recovery point и позволяет измерять RPO; требует согласия владельца
  cluster и обслуживания off-host archive. Предложено.

## Consequences

- Production delivery зависит от владельца общего PostgreSQL cluster и
  доступности независимого backup storage.
- Restore не переносит автоматически OAuth private keys; их recovery и
  emergency rotation проверяются вместе с Identity.
- Полная потеря VM не должна уничтожать единственный Recovery erasure journal.
- Изолированный drill может выявить несовместимость ролей, миграций или
  secret provider раньше инцидента. До успешного drill заявлять RPO/RTO как
  достигнутые нельзя.
- Архив общего cluster может содержать другие базы. Их доступ, шифрование и
  восстановление управляются владельцем cluster; Shape of You получает только
  право проверить свои две базы в изолированном restore.

## Verification

- Перед принятием ADR подтверждены owner approval, named off-host storage,
  шифрование, срок хранения, максимальный PITR window и независимая копия
  Recovery erasure journal.
- Restore drill из полной потери VM восстанавливает обе базы к одному моменту,
  применяет journal и проходит перечисленные проверки без внешнего трафика.
- Измеренные RPO ≤ 1 час и RTO ≤ 4 часа зафиксированы по start/end evidence;
  alert срабатывает до нарушения RPO.
- Negative drill с отсутствующим WAL или journal оставляет среду закрытой.
- Security Review проверяет контроль доступа к backup и journal, шифрование,
  отсутствие секретов в дампах и безопасное удаление по retention policy.

## Related material

- [Staging PostgreSQL backup and restore](../wiki/operations/postgresql-backup-and-restore.md)
- [Independent Recovery erasure journal](20260904-use-independent-typed-recovery-erasure-journal.md)
- [Temporary same-host Recovery erasure journal](20260904-temporarily-use-same-host-recovery-erasure-journal.md)
- [Identity service ADR](20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
- [Production hardening plan](../../plans/2026/09/2026-09-28-identity-production-hardening.md)
