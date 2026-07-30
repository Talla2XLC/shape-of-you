---
id: "decisions-20260729-store-revocable-auth-sessions-in-postgresql"
kind: adr
title: "Отзываемые authentication sessions в PostgreSQL без обязательного Redis"
status: accepted
date: 2026-07-29
supersedes: []
superseded_by: null
tags:
  - "authentication"
  - "postgresql"
  - "redis"
  - "security"
---

# Отзываемые authentication sessions в PostgreSQL без обязательного Redis

## Контекст

Будущие web- и mobile-клиенты требуют общий authentication lifecycle:
несколько устройств, rotation, expiration, адресный и глобальный revoke,
защиту от повторного использования refresh credentials и audit. Текущая
topology содержит один backend и PostgreSQL, но не Redis.

Server-side sessions в Redis дали бы быстрый ephemeral store, однако добавили
бы второй stateful component, отдельные backup/availability concerns и
связанность authentication с Redis до появления горизонтального
масштабирования.

## Решение

Хранить отзываемые refresh sessions в принадлежащей backend PostgreSQL
database. Session record содержит stable identity `User`, hash refresh
credential, device/client metadata, created/last-used/expiry/revocation time и
ссылку rotation lineage. Raw refresh credentials не сохраняются.

`Person` не владеет authentication session. Доступ `User` к fitness-данным
конкретного `Person` проверяется отдельно через `PersonAccessGrant`.

Web-клиент передаёт refresh credential только через `HttpOnly`, `Secure` и
подходящую `SameSite` cookie. Mobile-клиент хранит credential в platform secure
storage. Короткоживущий access credential не используется как долговременная
session authority.

Точный access-token format, срок жизни, signing/key rotation, login method,
account recovery и выбор собственного identity provider либо внешнего OIDC
остаются отдельным архитектурным решением. Этот ADR определяет persistence и
revocation boundary, а не полный authentication protocol.

Redis не добавляется ради sessions. Он рассматривается повторно при
подтверждённом driver:

- несколько API instances требуют общего distributed rate limit;
- realtime connections требуют общего ephemeral coordination;
- измеренный cache workload оправдывает отдельный cache store;
- PostgreSQL job/outbox processing не достигает утверждённых SLO;
- потеря соответствующего ephemeral state допустима и operational ownership
  Redis определён.

## Рассмотренные альтернативы

- Полностью stateless долгоживущие JWT: просты для проверки, но затрудняют
  адресный revoke, device sessions и безопасную rotation.
- Redis session store: подходит распределённым web sessions, но сейчас не имеет
  scale driver и создаёт второй stateful dependency.
- Зашифрованная cookie без server-side record: не требует datastore, но
  ограничивает немедленный revoke и единый web/mobile lifecycle.
- PostgreSQL refresh sessions: использует существующую durable transaction
  boundary и поддерживает revoke и audit. Выбрано.
- Внешний identity provider: может взять часть lifecycle на себя, но конкретный
  provider ещё не выбран; его session/token integration должна сохранять
  принятые security properties.

## Последствия

- Authentication mutations участвуют в обычных PostgreSQL transactions и
  backup policy.
- Session lookup и rotation требуют индексов, cleanup policy и защищённого
  сравнения hashes.
- Raw tokens, cookies и credentials запрещено писать в logs, audit payloads и
  documentation.
- Compromise response может отозвать одну session, все sessions `User` или
  rotation family.
- Redis остаётся опциональным infrastructure adapter и не проникает в domain
  contracts.
- Authentication должен быть реализован и проверен до real-data gate.

## Проверка

- Integration tests покрывают login/session creation, rotation, reuse
  detection, expiration и revoke.
- Database хранит только credential hash.
- Web smoke подтверждает cookie flags за HTTPS и корректный trust proxy.
- Mobile contract не требует browser cookie semantics.
- Concurrent rotation не создаёт две действующие дочерние sessions.
- Security Review утверждает protocol до работы с реальными данными.

## Связанные материалы

- [Stateful infrastructure](../wiki/architecture/stateful-infrastructure.md)
- [Владение данными](../wiki/architecture/data-ownership.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [NestJS с FastifyAdapter и Nuxt](20260729-use-nestjs-with-fastify-and-nuxt.md)
- [User, Person и права доступа](20260730-separate-user-access-from-person-data-ownership.md)
