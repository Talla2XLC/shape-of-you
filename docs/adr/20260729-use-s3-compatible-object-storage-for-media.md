---
id: "decisions-20260729-use-s3-compatible-object-storage-for-media"
kind: adr
title: "S3-compatible object storage для пользовательских media"
status: accepted
date: 2026-07-29
supersedes: []
superseded_by: null
tags:
  - "media"
  - "object-storage"
  - "privacy"
  - "s3"
---

# S3-compatible object storage для пользовательских media

## Контекст

Исходный workbook содержит ссылки на фотографии meals и body measurements.
Будущие web- и mobile-клиенты могут добавлять те же media. Хранение binary
objects непосредственно в PostgreSQL увеличит database backups, connection
traffic и стоимость lifecycle операций. Локальный volume временной VM создаст
неуправляемую зависимость от одного host и отдельную проблему backup/restore.

## Решение

Хранить пользовательские media в private S3-compatible object storage.
PostgreSQL хранит только domain association и metadata: stable media identity,
owner, object key, content type, size, checksum, lifecycle status, timestamps и
provenance.

Bucket не является публичным. Upload и download выполняются через
authenticated backend flow или короткоживущие signed URLs. Object keys не
содержат персональные данные и не используются как domain identity.

Vendor, region, encryption option, retention, deletion grace period, image
processing и malware scanning выбираются отдельным implementation review перед
первой media vertical. Для production предпочтителен managed object storage с
versioning и lifecycle. Развёртывание MinIO на временной VM не утверждено.

Media storage не добавляется в Compose до реализации первого use case. Import
legacy photo references относится к DEV-024 и требует mapping, availability и
privacy checks.

## Рассмотренные альтернативы

- PostgreSQL binary columns: единая transaction и backup boundary, но тяжёлые
  backups и неэффективная доставка больших objects.
- Filesystem volume API container или VM: просто для прототипа, но плохо
  переносится между hosts и усложняет backup, rollback и horizontal scale.
- Managed S3-compatible storage: отделяет binary lifecycle от relational
  metadata и поддерживает signed access, versioning и lifecycle. Выбрано.
- Собственный MinIO: сохраняет S3 API, но добавляет stateful operations,
  storage redundancy и backup responsibility; возможен только по отдельному
  operational решению.

## Последствия

- PostgreSQL transaction не может атомарно зафиксировать object upload; нужен
  explicit lifecycle pending, available, failed и deleted, а также cleanup
  orphan objects.
- Checksums и content metadata проверяются backend.
- Media access требует authorization независимо от знания object key.
- Backup/restore PostgreSQL и object storage согласуются через documented
  retention и recovery process.
- Deletion данных `Person` должна охватывать metadata, object versions и derived
  thumbnails.
- CDN может быть добавлен позднее без изменения domain ownership.

## Проверка

- Integration tests используют S3-compatible test adapter и проверяют upload
  lifecycle, checksum, authorization и orphan cleanup.
- Object нельзя получить без действующей authorization или signed URL.
- Удаление и retention проверяются для original и derived objects.
- Restore drill подтверждает согласование relational metadata и object
  availability.
- Реальные media не попадают в logs, fixtures, chat или repository.

## Связанные материалы

- [Stateful infrastructure](../wiki/architecture/stateful-infrastructure.md)
- [Владение данными](../wiki/architecture/data-ownership.md)
- [Каталог поведения Google Sheets](../wiki/data/google-sheets-behavior-catalog.md)
- [Стратегия миграции](../wiki/architecture/migration-strategy.md)
