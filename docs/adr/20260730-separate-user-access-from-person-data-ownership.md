---
id: "decisions-20260730-separate-user-access-from-person-data-ownership"
kind: adr
title: "Разделение User, Person и прав доступа к fitness-данным"
status: accepted
date: 2026-07-30
supersedes: []
superseded_by: null
tags:
  - "access-control"
  - "authentication"
  - "data-ownership"
  - "identity"
---

# Разделение User, Person и прав доступа к fitness-данным

## Контекст

Fitness-данные принадлежат человеку, о котором зафиксированы измерения,
питание, тренировки, восстановление и coaching decisions. Authentication
account отвечает за вход и выполнение действий, но не всегда совпадает с этим
человеком: один аккаунт может вести несколько людей, а к данным одного человека
может быть предоставлен доступ владельцу, тренеру или наблюдателю.

Использование `user_id` как единственного владельца упростило бы первый
single-user сценарий, но связало бы domain identity с выбранным authentication
protocol и потребовало бы миграции всех фактов при появлении multi-access.
Термин `Subject` точен для privacy и integration-контекстов, но слишком общий
для ubiquitous language продукта.

## Решение

Использовать три раздельных понятия:

- `User` — authentication identity аккаунта;
- `Person` — domain identity человека, о котором хранятся fitness-данные;
- `PersonAccessGrant` — явное право `User` работать с конкретным `Person`.

Domain facts, plans, observations, recommendations и media metadata получают
`person_id`. Authentication sessions принадлежат `User`, а не `Person`.
Отношение `User` и `Person` является many-to-many; минимальный controlled
vocabulary ролей содержит `owner`, `editor`, `viewer` и `coach`. Точная матрица
permissions и lifecycle приглашений проектируются в отдельной security-задаче.

Клиент не получает доступ к данным только потому, что передал `person_id` в
body, query или path. Application layer разрешает выбранный `Person` через
аутентифицированный `User` и действующий `PersonAccessGrant`. Trusted import и
background processing используют отдельный проверяемый actor context и не
маскируются под произвольного `User`.

До реализации authentication staging остаётся synthetic-only и не получает
real fitness data. Временный synthetic person context допускается только как
явно настроенный test/staging adapter; он не является production authorization
механизмом и должен быть удалён до real-data gate DEV-024.

`Profile` не используется как identity владельца: профиль может быть
представлением или набором изменяемых настроек конкретного `Person`.

## Рассмотренные альтернативы

- `user_id` во всех domain facts: минимальная начальная schema, но смешивает
  аккаунт и человека и затрудняет multi-access. Отклонено.
- `subject_id`: сохраняет правильную границу, но недостаточно выразителен для
  product и domain language. Отклонено в пользу `person_id`.
- `profile_id`: удобно для UI, но профиль является изменяемым представлением и
  не должен становиться устойчивой identity человека. Отклонено.
- `athlete_id`: понятно для тренировок, но слишком узко для питания,
  восстановления и общего состояния. Отклонено.
- `person_id` плюс access grants: сохраняет domain ownership и допускает
  multi-access без преждевременного выделения identity service. Выбрано.

## Последствия

- Все facts, plans, observations, recommendations, targets, connections и
  media metadata новых domain verticals проектируются как person-scoped.
  Переиспользуемые reference definitions следуют отдельному ADR и не
  копируются на каждого `Person`.
- Existing `WeightMeasurement` должен получить `person_id` до real-data
  migration; migration synthetic данных не передаёт authority от Google Sheets.
- Authorization становится отдельной application concern и не размазывается
  по repositories.
- Account deletion, отзыв доступа и удаление fitness-данных получают разные
  lifecycle и требуют отдельной privacy/retention policy.
- Один modular backend и одна API-owned PostgreSQL database сохраняются;
  отдельный identity microservice не создаётся.
- Security Review должен утвердить permission matrix, invite flow и actor audit
  до работы с реальными данными.

## Проверка

- Integration tests доказывают many-to-many доступ и запрет доступа без
  действующего grant.
- Domain mutations получают `person_id` из проверенного application context, а
  не доверяют произвольному request body.
- Отзыв одного grant не удаляет `Person` и его facts.
- Отзыв authentication session не изменяет domain ownership.
- Synthetic staging adapter невозможно включить неявно и он запрещён
  real-data gate.

## Связанные материалы

- [Владение данными](../wiki/architecture/data-ownership.md)
- [Provenance и identifiers](../wiki/data/provenance-and-identifiers.md)
- [Отзываемые authentication sessions](20260729-store-revocable-auth-sessions-in-postgresql.md)
- [План общих fact-контрактов](../../plans/2026/07/completed/2026-07-30-person-identity-provenance-and-corrections.md)
- [Shared reference definitions и person-owned state](20260731-separate-shared-reference-definitions-from-person-owned-state.md)
