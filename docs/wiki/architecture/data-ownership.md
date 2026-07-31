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

Authentication identity `User` и domain identity `Person` разделены. `Person`
является владельцем fitness-данных, а `User` получает явный
`PersonAccessGrant` с ролью `owner`, `editor`, `viewer` или `coach`. Отношение
many-to-many позволяет одному аккаунту работать с несколькими людьми и
нескольким аккаунтам получать контролируемый доступ к одному человеку.

Domain facts, plans, observations, recommendations и media metadata являются
person-scoped. Переданный клиентом `person_id` сам по себе не предоставляет
доступ: application layer проверяет authenticated `User` и действующий grant.
До реализации authentication разрешён только явно настроенный synthetic
staging/test context без real data.

Переиспользуемые reference definitions не являются fitness facts только из-за
того, что на них ссылается персональный факт. Общие brands, ingredients,
foods, exercises, provider/device models и product policy definitions
версионируются без копирования на каждого `Person`. Person-owned overlays
содержат только персональные aliases, preferences, availability, visibility и
ссылки на доступные shared versions. Private custom items имеют явного
владельца и не публикуются автоматически.

Facts, observations, plans, targets, connections, consents, recommendations и
decisions остаются person-scoped и при необходимости закрепляются за точной
shared version и собственным immutable snapshot. В Nutrition `Meal` сохраняет
nutrient snapshot; в Training program и performed work не становятся частью
`ExerciseCatalog`; в Recovery provider model не владеет наблюдениями человека.

Provenance общей catalog record отделён от person-scoped `SourceReference`
fitness-факта. Внешние catalog records имеют source-specific identity,
checksum, parser version и review lifecycle; импорт не предоставляет доступ к
персональным данным.

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
- `User` отвечает за authentication, `Person` — за domain ownership.
- Multi-access выражается явными grants, а не копированием fitness-данных.
- Shared reference data, personal overlays и person-owned facts имеют разные
  ownership и lifecycle; универсальная person-scoped модель для них запрещена.

## Открытые вопросы

- Конкретное соответствие контекстов и владельцев данных.
- Transport и lifecycle read model.
- Policies retention, deletion, encryption, backup и access control.
- Согласованный restore relational metadata и object storage.
- Точная permission matrix, invitation lifecycle и actor audit.

## Связанные материалы

- `migration-strategy.md`
- `../domain/bounded-contexts.md`
- `../../adr/20260728-deployable-service-autonomy.md`
- `../../adr/20260728-api-or-event-only-cross-service-communication.md`
- `../../adr/20260728-use-temporary-vm-deployment-with-shared-postgresql.md`
- `../../adr/20260729-store-revocable-auth-sessions-in-postgresql.md`
- `../../adr/20260729-use-s3-compatible-object-storage-for-media.md`
- `../../adr/20260730-separate-user-access-from-person-data-ownership.md`
- `../../adr/20260730-use-typed-provenance-and-append-only-supersession.md`
- `../../adr/20260731-use-layered-versioned-nutrition-catalog.md`
- `../../adr/20260731-separate-shared-reference-definitions-from-person-owned-state.md`
- `../../adr/20260731-model-versioned-training-programs-and-immutable-workout-sessions.md`
