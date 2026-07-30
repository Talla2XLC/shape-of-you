---
title: Person identity, provenance и corrections для domain facts
status: completed
created: 2026-07-30
updated: 2026-07-30
related_roadmap_items:
  - DEV-023
related_board_items:
  - TASK-0010
---

# Person identity, provenance и corrections для domain facts

## Цель

Подготовить общий person-scoped контракт фактов перед реализацией оставшихся
verticals DEV-023: разделить authentication `User` и domain `Person`, задать
typed provenance, исправить scope идемпотентности и реализовать append-only
correction/supersession на существующей вертикали `WeightMeasurement`.

## Утверждённые решения

- `Person` владеет fitness-данными; `User` является authentication identity.
- Доступ задаётся many-to-many `PersonAccessGrant`.
- Domain facts получают `person_id`.
- Публичный request не является доказательством доступа к переданному
  `person_id`.
- Provenance имеет типизированные поля и optional private raw snapshot.
- Correction создаёт новый immutable fact с `supersedes_id`.
- Универсальные `facts`, rules engine, event store и identity microservice не
  создаются.

Основания:

- `docs/adr/20260730-separate-user-access-from-person-data-ownership.md`;
- `docs/adr/20260730-use-typed-provenance-and-append-only-supersession.md`.

## Предлагаемый schema diff

Ниже proposal для developer review, а не выполненная migration.

### Новые таблицы

`persons`:

- `id uuid primary key`;
- `status person_status not null`;
- `created_at timestamptz not null`;
- `updated_at timestamptz not null`.

`users`:

- минимальная stable identity без login credentials;
- `id uuid primary key`;
- `status user_status not null`;
- timestamps.

`person_access_grants`:

- `id uuid primary key`;
- `person_id` и `user_id` с foreign keys;
- `role`: `owner`, `editor`, `viewer`, `coach`;
- `status`, `granted_at`, nullable `revoked_at`;
- unique active grant для пары user/person/role.

`source_references`:

- `id uuid primary key`;
- `person_id`;
- `channel`, nullable external system и external record id;
- nullable source timestamp и import batch id;
- nullable checksum и private raw snapshot JSONB;
- `ingested_at`.

### Изменение `weight_measurements`

- добавить `person_id not null`;
- заменить глобальный unique `dedupe_key` на composite
  `(person_id, source, dedupe_key)`;
- добавить nullable `source_reference_id`;
- добавить nullable self-reference `supersedes_id`;
- добавить nullable `correction_reason`;
- запретить self-supersession и branching подтверждённых corrections;
- сохранить точный `numeric(6,3)` и timestamp/local-date contract.

Переход существующих synthetic rows должен быть детерминированным и не может
маскироваться под миграцию реальных Google Sheets data. Конкретный backfill
fixture показывается в migration diff до выполнения.

## Предлагаемый API diff

Ниже proposal; endpoints ещё не реализованы.

- `POST /v1/weight-measurements` не принимает доверенный `personId` как
  authorization proof; application context определяет текущий `Person`.
- Response добавляет `personId`, typed source reference и nullable
  `supersedesId`.
- Произвольный публичный JSONB `provenance` заменяется типизированным contract;
  private raw snapshot не возвращается.
- `POST /v1/weight-measurements/:id/corrections` принимает полный corrected
  snapshot, обязательную `reason`, source reference и новый `dedupeKey`.
- `GET /v1/weight-measurements/:id` читает конкретный immutable fact.
- Default list возвращает только current facts.
- Явный history query или nested history endpoint возвращает supersession chain.

Точный выбор query `state=current|all` либо nested history endpoint должен быть
показан в OpenAPI diff developer plan до patch.

## Этапы

1. Добавить contracts `Person`, `PersonAccessGrant`, typed `SourceReference` и
   application `PersonContext`.
2. Добавить Drizzle schema и migration с детерминированным synthetic backfill.
3. Перевести `WeightMeasurement` на person-scoped dedupe и typed provenance.
4. Добавить correction command и current/history query semantics.
5. Добавить repositories и transaction boundaries без generic repository.
6. Обновить JSON Schema, OpenAPI и English TSDoc module contracts.
7. Добавить unit и PostgreSQL integration tests.
8. Проверить чистую migration и upgrade с текущей schema.
9. Провести Quality Review, Architecture Review и documentation alignment.

## Validation plan

- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm test`;
- `pnpm --filter @shape-of-you/api test:integration`;
- migration на чистой database;
- migration с текущей schema и synthetic `weight_measurements`;
- OpenAPI/runtime-schema parity;
- concurrent idempotency и correction tests;
- проверка запрета cross-person access;
- `scripts/validate-docs.ps1`.

## Acceptance criteria

- `User`, `Person` и access grant имеют разные contracts и ownership.
- Все новые и существующие weight facts принадлежат `Person`.
- Dedupe больше не глобален.
- Correction не изменяет и не удаляет исходный fact.
- Current/history semantics проверяются integration tests.
- Raw provenance snapshot не попадает в публичный API.
- Synthetic staging не получает real data и не становится authorization
  precedent.
- Никакие данные Google Sheets не переносятся.
- Architecture Review не обнаруживает generic fact model, event sourcing,
  преждевременный identity service или дублирование authority.

## Вне объёма

- Login, password/OIDC, access tokens и invitation UI.
- Полная permission matrix и account recovery.
- Physical State body measurements и goals.
- Nutrition, Training, Recovery, Coaching и Intake verticals.
- Backfill, dual-run, reconciliation и cutover Google Sheets.
- Production secrets, deployment и migrations на VM.

## Риски

- Временный synthetic person adapter может превратиться в authorization bypass,
  если не сделать его явным и не заблокировать real-data gate.
- Одновременные corrections могут создать branching chain без database guard.
- Слишком общий `SourceReference` может стать untyped integration dump.
- Публичное удаление `provenance` является contract change и требует явной
  compatibility strategy до implementation.

## Architecture Review до реализации

1. **Избыточная сложность:** отдельный identity service, event store и generic
   fact repository не нужны.
2. **Преждевременные microservices:** `User`, `Person`, grants и provenance
   остаются модулями одного backend.
3. **DDD:** domain ownership принадлежит `Person`; authentication `User` не
   становится владельцем fitness facts.
4. **Дублирование:** ADR фиксируют решения, Wiki описывает current/approved
   model, этот план содержит delivery scope и proposal diff.
5. **Упрощение:** self-reference внутри typed fact table проще общей revision
   table и сохраняет database constraints.

Перед первым code patch требуется отдельное утверждение developer plan и
compatibility strategy публичного `provenance`.
