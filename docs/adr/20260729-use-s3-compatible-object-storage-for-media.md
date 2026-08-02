---
id: "decisions-20260729-use-s3-compatible-object-storage-for-media"
kind: adr
title: "Use S3-compatible object storage for user media"
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

# Use S3-compatible object storage for user media

## Context

The source workbook links to meal and body-measurement photos. Future clients
may add the same media. PostgreSQL binary objects inflate backups, connection
traffic, and lifecycle cost. A temporary-VM filesystem creates unmanaged host
coupling and separate backup/restore risk.

## Decision

Store user media in private S3-compatible object storage. PostgreSQL stores
only domain association and metadata: stable media identity, owner, object key,
content type, size, checksum, lifecycle state, timestamps, and provenance.

The bucket is private. Upload and download use authenticated backend flows or
short-lived signed URLs. Object keys contain no personal data and are not
domain identity.

Select vendor, region, encryption, retention, deletion grace, processing, and
malware scanning in an implementation review before the first media vertical.
Prefer managed versioned storage with lifecycle for production. MinIO on the
temporary VM is not approved.

Do not add media storage to Compose before a real use case. Legacy photo import
belongs to DEV-024 and requires mapping, availability, and privacy checks.

## Considered alternatives

- PostgreSQL binaries: one transaction/backup boundary but heavy backups and
  inefficient object delivery.
- API/VM filesystem: simple prototype but poor portability, backup, rollback,
  and horizontal scaling.
- Managed S3-compatible storage: separates binary lifecycle from relational
  metadata and supports signed access, versioning, and lifecycle. Selected.
- Self-hosted MinIO: keeps the S3 API but adds stateful operations, redundancy,
  and backup ownership; requires a separate operational decision.

## Consequences

- Upload and PostgreSQL metadata are not one atomic transaction; explicit
  `pending`, `available`, `failed`, and `deleted` states and orphan cleanup are
  required.
- Backend verifies checksum and content metadata.
- Authorization is required even when the object key is known.
- PostgreSQL and object-store recovery need coordinated retention procedures.
- Person deletion covers metadata, versions, and derived thumbnails.
- A CDN can be added later without changing domain ownership.

## Verification

- Integration tests use an S3-compatible adapter and cover upload lifecycle,
  checksum, authorization, and orphan cleanup.
- Objects are inaccessible without authorization or a valid signed URL.
- Deletion/retention covers originals and derived objects.
- Restore drills reconcile metadata and object availability.
- Real media never enters logs, fixtures, chat, or the repository.

## Related material

- [Stateful infrastructure](../wiki/architecture/stateful-infrastructure.md)
- [Data ownership](../wiki/architecture/data-ownership.md)
- [Google Sheets behavior catalog](../wiki/data/google-sheets-behavior-catalog.md)
- [Migration strategy](../wiki/architecture/migration-strategy.md)
