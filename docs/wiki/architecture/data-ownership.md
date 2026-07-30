---
id: "architecture-data-ownership"
kind: architecture
title: "Владение данными"
status: draft
tags:
  - "architecture"
  - "data"
---

# Владение данными

## Кратко

Google Sheets сейчас является authoritative source рабочих fitness-данных. Будущее владение persistence следует доменным границам и запрещает межсервисный доступ к базам данных.

## Содержание

### Текущий authority

До завершения dual-run с PostgreSQL, reconciliation и cutover Google Sheets остаётся единственным authoritative source рабочих fitness-данных. Представления в backend или PostgreSQL нельзя объявлять авторитетными до прохождения этого gate.

### Ограничения будущего владения

Каждый deployable service владеет собственной database, схемами Drizzle,
миграциями, seed-данными, credentials и lifecycle. Общий PostgreSQL cluster
допустим на локальном и раннем production-этапах, но не отменяет отдельные
database и credentials каждого владельца.

В утверждённой временной staging topology единственный API использует
существующий физический PostgreSQL cluster, но получает database
`shape_of_you_api` и отдельную login role. Это разделяет ownership и доступ,
но не изолирует API от отказов и upgrades общего cluster.

Revocable authentication sessions принадлежат тому же backend и хранятся в его
PostgreSQL database. Raw credentials не сохраняются.

Binary media принадлежат соответствующим domain records, но физически
размещаются в private S3-compatible object storage. PostgreSQL хранит media
identity, ownership, lifecycle и object metadata. Знание object key не даёт
права доступа.

### Запрещённая связанность

- Прямое чтение или запись базы данных другого сервиса.
- Межсервисный SQL и foreign keys между базами разных владельцев.
- Общие миграции или общая схема Drizzle, охватывающая несколько сервисов.
- Общие database credentials.

### Опубликованные данные

Межграничные данные предоставляются через HTTP API, события или явно опубликованные read model. Для read model определяются publisher, контракт, ожидаемая актуальность и владение; она не даёт разрешения обращаться к базе другого владельца.

## Основания

- Правила source of truth и границ данных, предоставленные оператором.
- ADR по автономности сервисов и межсервисному взаимодействию.

## Решения

- Логическое владение важнее физического разделения PostgreSQL.

## Открытые вопросы

- Конкретное соответствие контекстов и владельцев данных.
- Transport и lifecycle read model.
- Policies retention, deletion, encryption, backup и access control.
- Согласованный restore relational metadata и object storage.

## Связанные материалы

- `migration-strategy.md`
- `../domain/bounded-contexts.md`
- `../../adr/20260728-deployable-service-autonomy.md`
- `../../adr/20260728-api-or-event-only-cross-service-communication.md`
- `../../adr/20260728-use-temporary-vm-deployment-with-shared-postgresql.md`
- `../../adr/20260729-store-revocable-auth-sessions-in-postgresql.md`
- `../../adr/20260729-use-s3-compatible-object-storage-for-media.md`
