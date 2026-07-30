---
id: "architecture-stateful-infrastructure"
kind: architecture
title: "Stateful infrastructure"
status: draft
tags:
  - "architecture"
  - "infrastructure"
  - "storage"
---

# Stateful infrastructure

## Кратко

Текущий backend использует PostgreSQL как единственный stateful runtime
component. Утверждён эволюционный baseline: PostgreSQL также хранит revocable
authentication sessions и будущий transactional outbox, пользовательские media
хранятся в private S3-compatible object storage, а Redis и Kafka не вводятся
без измеримого driver.

## Содержание

### PostgreSQL

PostgreSQL владеет relational domain data, policy versions, provenance,
revocable refresh sessions, audit metadata и outbox records. Outbox tables
создаются только вместе с первым durable asynchronous workflow.

Session persistence в PostgreSQL не утверждает конкретный login или identity
provider. Access-token protocol, account recovery и OIDC остаются отдельным
security decision.

### Object storage

Фотографии meals, body measurements и другие binary media размещаются в
private S3-compatible storage. PostgreSQL хранит media identity, ownership,
object key, checksum, lifecycle и domain association.

Object storage не разворачивается до первого media use case. Production vendor
не выбран. MinIO на временной VM не входит в утверждённую topology.

### Redis

Redis отсутствует. Кандидаты для повторного review:

- общий rate limit нескольких API instances;
- ephemeral coordination realtime connections;
- измеренный cache workload;
- job throughput, превышающий проверенные возможности PostgreSQL worker.

Cache и ephemeral state не являются authority. Redis не используется для
долговременных domain facts или единственной копии sessions.

### Kafka

Kafka отсутствует. Domain events проектируются transport-neutral, а атомарная
публикация начинается с PostgreSQL outbox. Kafka рассматривается при нескольких
independent consumers, stream replay, измеренном throughput или external
streaming integration.

### Не требуются сейчас

- Elasticsearch/OpenSearch: начальный search покрывается возможностями
  PostgreSQL; отдельный engine требует измеримого gap.
- TimescaleDB: текущий объём health и fitness observations не обосновывает
  отдельную time-series extension.
- Full event sourcing: domain tables остаются authority.

## Основания

Behavior audit Google Sheets подтвердил media references, независимо
принадлежащие facts, audit и asynchronous workflow candidates. Текущая
deployment topology содержит один API и PostgreSQL. Оператор утвердил
PostgreSQL sessions, S3-compatible media storage и driver-based появление
Redis.

## Решения

- [Authentication sessions в PostgreSQL](../../adr/20260729-store-revocable-auth-sessions-in-postgresql.md).
- [S3-compatible storage для media](../../adr/20260729-use-s3-compatible-object-storage-for-media.md).
- [PostgreSQL outbox до Kafka](../../adr/20260729-use-postgresql-outbox-before-kafka.md).

## Открытые вопросы

- Identity provider, login methods, access-token format и account recovery.
- Object-storage vendor, region, encryption, retention и deletion workflow.
- Измеримые thresholds для Redis, Kafka и search infrastructure.
- RPO/RTO и согласованный restore PostgreSQL с object storage.

## Связанные материалы

- [Обзор архитектуры](overview.md)
- [Владение данными](data-ownership.md)
- [Атрибуты качества](quality-attributes.md)
- [Deployment topology](deployment.md)
