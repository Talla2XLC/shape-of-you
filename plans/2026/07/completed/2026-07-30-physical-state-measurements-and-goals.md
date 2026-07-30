---
title: "Physical State: замеры тела, reconciliation веса и версионируемые цели"
status: completed
date: 2026-07-30
updated: 2026-07-30
owners:
  - product
  - analytic
  - developer
  - quality
task_refs:
  - TASK-0011
---

# Physical State: замеры тела, reconciliation веса и версионируемые цели

## Цель

Завершить backend-вертикаль `Physical State and Goals`: добавить
`BodyMeasurementSession`, versioned `PhysicalGoal`, current/history queries и
явную migration policy для зеркала `Daily_Log.Weight`, не перенося реальные
данные из Google Sheets.

## Основания и утверждённые решения

- [ADR о сеансах замеров и целях](../../../docs/adr/20260730-model-body-measurement-sessions-and-versioned-physical-goals.md).
- [ADR о typed provenance и supersession](../../../docs/adr/20260730-use-typed-provenance-and-append-only-supersession.md).
- [ADR о User и Person](../../../docs/adr/20260730-separate-user-access-from-person-data-ownership.md).
- Read-only source audit workbook `Fitness Tracker`:
  - `Body` содержит одну строку сеанса с пятью metric values, общей фотографией,
    заметкой, `Measurement_ID` и source;
  - `Settings` хранит narrative primary goal и динамический target weight;
  - все заполненные пары `Weight`/`Daily_Log.Weight` в доступной истории
    совпадают.

## Scope

Входит:

- PostgreSQL schema и Drizzle migration для body measurement sessions, values,
  goals, versions и criteria;
- domain contracts, repositories, Nest modules/controllers и OpenAPI contracts;
- append-only correction/history для body sessions;
- draft/activation/completion/cancellation lifecycle goal;
- current body trends и current goal queries без materialized projection;
- synthetic weight reconciliation policy и tests для будущего importer;
- integration, domain и contract tests;
- актуализация canonical Wiki, migration docs и changelog;
- независимый Quality Review и итоговый Architecture Review.

Не входит:

- import персональных данных, dual-write, dual-run или cutover Google Sheets;
- реализация общего Intake pipeline;
- загрузка body photos и развёртывание object storage;
- authentication provider и выдача production access grants;
- Coaching policies, автоматическая смена goals или медицинские рекомендации;
- Nutrition, Training, Recovery и frontend.

## Целевая data model

### `body_measurement_sessions`

- `id uuid primary key`;
- `person_id uuid not null`;
- `measured_at timestamptz not null`;
- `local_date date not null`;
- `timezone text not null`;
- `source source_channel not null`;
- `source_reference_id uuid not null`;
- `dedupe_key text not null`;
- `confidence numeric(4,3) null`;
- `photo_media_id uuid null`;
- `note text null`;
- `supersedes_id uuid null`;
- `correction_reason text null`;
- `created_at timestamptz not null`;
- unique `(person_id, source, dedupe_key)`;
- один confirmed successor на исходный session;
- database guard против cross-person supersession;
- `source_reference_id` обязан принадлежать тому же `Person`.

### `body_measurement_values`

- `session_id uuid not null`;
- `metric body_measurement_metric not null`;
- `value numeric(6,2) not null`;
- `unit body_measurement_unit not null`;
- primary key `(session_id, metric)`;
- metric/unit compatibility checks;
- для первой vocabulary value находится в диапазоне `1.00..500.00 cm`; это
  data-quality guard, не медицинская норма.

Первая vocabulary:

- `waist`, `chest`, `hips`, `thigh`, `biceps`;
- canonical unit `cm`.

### `physical_goals`

- `id uuid primary key`;
- `person_id uuid not null`;
- lifecycle `draft | active | completed | cancelled`;
- `current_version_id uuid null`;
- optimistic `lock_version integer not null`;
- lifecycle timestamps;
- composite foreign key гарантирует, что current version принадлежит тому же
  goal.

### `physical_goal_versions`

- `id uuid primary key`;
- `goal_id uuid not null`;
- `version integer not null`;
- `intent text not null`;
- `effective_from date null`;
- `target_date date null`;
- `source source_channel not null`;
- `source_reference_id uuid not null`;
- `dedupe_key text not null`;
- `created_at timestamptz not null`;
- unique `(goal_id, version)`;
- unique `(goal_id, source, dedupe_key)`;
- immutable после создания.

### `physical_goal_criteria`

- `id uuid primary key`;
- `goal_version_id uuid not null`;
- `position smallint not null`;
- `metric physical_goal_metric not null`;
- mode `directional | exact | range | dynamic`;
- direction `decrease | maintain | increase` nullable;
- `target_value`, `minimum_value`, `maximum_value numeric(9,3)` nullable;
- `unit physical_goal_unit not null`;
- unique `(goal_version_id, position)`;
- checks согласуют mode, direction и численные поля.

Первая goal vocabulary:

- metrics: `weight`, `body_fat_percentage`, `lean_mass`, `waist`, `chest`,
  `hips`, `thigh`, `biceps`;
- units: `kg`, `percent`, `cm`;
- `directional` требует direction и запрещает numeric targets;
- `exact` требует только `target_value`;
- `range` требует `minimum_value <= maximum_value`;
- `dynamic` запрещает numeric targets и допускает optional direction;
- metric/unit compatibility защищается database checks.

Goal version может не иметь criteria: narrative intent остаётся обязательным и
достаточным. Это не позволяет придумывать численные targets, отсутствующие в
source.

### Shared provenance cleanup

Существующий PostgreSQL enum `weight_measurement_source` переименовывается в
`source_channel`, потому что он уже используется общей таблицей
`source_references` и теперь обслуживает несколько Physical State entities.
Значения `manual`, `google_sheets` и `import` сохраняются без изменения.

## HTTP contract

### Body measurements

- `POST /v1/body-measurement-sessions`;
- `POST /v1/body-measurement-sessions/:id/corrections`;
- `GET /v1/body-measurement-sessions/:id`;
- `GET /v1/body-measurement-sessions/:id/history`;
- `GET /v1/body-measurement-sessions?limit=&cursor=&metric=`.

Create/correction принимают полный session snapshot. `personId`, derived
`localDate`, identifiers и server timestamps не принимаются как доверенные
client fields.

### Physical goals

- `POST /v1/physical-goals` создаёт root и первую draft version;
- `POST /v1/physical-goals/:id/versions` добавляет immutable draft version;
- `POST /v1/physical-goals/:id/versions/:version/activate`;
- `POST /v1/physical-goals/:id/complete`;
- `POST /v1/physical-goals/:id/cancel`;
- `GET /v1/physical-goals/:id`;
- `GET /v1/physical-goals/:id/history`;
- `GET /v1/physical-goals?status=active`.

Commands проверяют selected `Person` через application access context.
Activation использует optimistic concurrency и одну database transaction.

## Последовательность реализации

1. Добавить controlled vocabularies, schema, constraints и migration.
2. Реализовать `BodyMeasurementSession` domain aggregate и repository.
3. Добавить body HTTP contracts, correction/current/history queries.
4. Реализовать `PhysicalGoal` lifecycle, immutable versions и criteria.
5. Добавить goal HTTP contracts и current/history queries.
6. Добавить pure reconciliation policy `Weight`/`Daily_Log` и synthetic tests
   без importer и real data.
7. Обновить canonical Wiki, migration docs и changelog.
8. Выполнить developer checks, independent Quality Review и Architecture Review.

## Acceptance criteria

1. Body session с несколькими values создаётся атомарно и идемпотентно.
2. Duplicate metric, invalid metric/unit pair и invalid numeric bounds
   отклоняются domain и database guards.
3. Correction не изменяет исходный session и возвращается полной history chain.
4. Несколько sessions и weight measurements одного дня разрешены.
5. Goal допускает narrative/dynamic intent без фиктивного численного target.
6. Новая goal version не меняет старую; activation переключает current version
   атомарно и защищена optimistic concurrency.
7. Current/history queries имеют стабильный cursor/order contract.
8. Weight mirror reconciliation не создаёт второй domain fact и явно сообщает
   mismatch.
9. Public API не раскрывает private raw source snapshots.
10. Real Google Sheets data не читаются тестами и не записываются в database.

## Required checks

- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm build`;
- unit/domain tests Physical State and Goals;
- PostgreSQL integration tests на чистой database;
- migration up на чистой database и поверх текущей schema;
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-docs.ps1`;
- `4dt-board validate`.

## Rollback и recovery

- До real-data import rollback application выполняется возвратом к предыдущему
  image/commit.
- Новые пустые tables могут быть удалены отдельной reviewed migration только
  до появления реальных данных.
- После появления facts destructive down migration запрещена; rollback schema
  выполняется forward-compatible исправлением.
- Goal activation и body correction не требуют database rollback: история
  сохраняется в versions/supersession.

## Риски

- Слишком общий goal criterion может превратиться в rules engine. Vocabulary и
  modes ограничиваются Physical State.
- Correction полного body session копирует неизменившиеся values, но сохраняет
  правильную aggregate history и source provenance.
- `note` может содержать чувствительные health data; privacy/retention policy
  остаётся отдельным blocker до real-data migration.
- Numeric bounds требуют data-quality review и не должны позиционироваться как
  медицинские нормы.

## Architecture Review

1. **Лишняя сложность:** session/value normalization оправдана общей provenance
   строки `Body` и расширяемым metric catalog; отдельный generic fact framework
   не создаётся.
2. **Microservices:** новые модели остаются модулем одного Nest modular backend
   и одной принадлежащей ему PostgreSQL database.
3. **DDD:** measurements остаются immutable facts владельца `Person`, goals —
   versioned plans; projections не получают authority.
4. **Дублирование:** `Daily_Log.Weight` не переносится как второй fact; current
   goal и trends вычисляются.
5. **Упрощение:** media upload, importer, automation и materialized projections
   отложены до реального driver.

## Gate перед implementation

До изменения code/schema оператор утверждает этот точный data model, HTTP
contract и scope. После утверждения `TASK-0011` может перейти из analytic в
developer.
