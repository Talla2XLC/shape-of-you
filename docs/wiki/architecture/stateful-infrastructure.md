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

## Summary

PostgreSQL is the only current stateful runtime component. Private
S3-compatible media storage is accepted for future media. Redis and Kafka need
measured drivers.

## Content

- **PostgreSQL:** relational domain data, policy versions, provenance,
  revocable refresh sessions, audit metadata, and durable Intake/outbox jobs.
  Session persistence does not choose an identity provider or token protocol.
- **Object storage:** future meal/body media in private S3-compatible storage;
  PostgreSQL holds identity, owner, key, checksum, lifecycle, and association.
  No storage is deployed before a media use case; provider and MinIO are not
  approved.
- **Redis:** absent. Reconsider for distributed rate limiting, realtime
  coordination, measured caching, or job throughput beyond PostgreSQL. Cache
  and ephemeral state are never authority.
- **Kafka:** absent. Events remain transport-neutral and atomic publication
  begins in PostgreSQL. Reconsider for independent consumers, replay,
  throughput, or external streaming.
- **Not required:** Elasticsearch/OpenSearch, TimescaleDB, and full event
  sourcing without measured gaps.

The Identity deployable has a separate generated PostgreSQL migration chain
for accounts, passkeys, hashed challenges, recovery-code hashes, passkey
recovery sessions, and typed OAuth clients/grants/sessions/interactions,
authorization codes, refresh-token families, signing-key metadata, and typed
security events. Runtime database wiring remains pending. This Identity
protocol model uses no generic provider-artifact table or JSON persistence and
does not alter the API database.

## Evidence

- Current one-API/PostgreSQL topology and behavior audit.

## Decisions

- [PostgreSQL sessions](../../adr/20260729-store-revocable-auth-sessions-in-postgresql.md)
- [S3-compatible media](../../adr/20260729-use-s3-compatible-object-storage-for-media.md)
- [PostgreSQL outbox before Kafka](../../adr/20260729-use-postgresql-outbox-before-kafka.md)
- [Identity relational model](../../adr/20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)

## Open questions

- Identity provider/token protocol; object-storage provider/retention/erasure;
  thresholds for Redis/Kafka/search; coordinated RPO/RTO.

## Related material

- [Architecture overview](overview.md)
- [Data ownership](data-ownership.md)
- [Quality attributes](quality-attributes.md)
- [Deployment](deployment.md)
- [Identity and external tool access](identity-and-external-tool-access.md)
