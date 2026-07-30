---
title: Завершение backend-контракта и доменной логики DEV-023
status: proposed
created: 2026-07-29
updated: 2026-07-29
related_roadmap_items:
  - DEV-023
related_board_items:
  - TASK-0010
---

# Завершение backend-контракта и доменной логики DEV-023

## Цель

Довести один modular backend Shape of You до устойчивого API-контракта,
который реализует подтверждённую бизнес-логику текущей системы Google Sheets
до начала DEV-024, backfill, dual-run и переноса реальных данных.

План продолжает завершённый технический срез
`Backend bootstrap и вертикаль WeightMeasurement`. Тот срез подтвердил
runtime, PostgreSQL, migrations, contracts, tests и delivery, но сознательно
исключал питание, тренировки, восстановление, coaching, corrections и перенос
данных. Его завершение не означает завершение всего DEV-023.

## Проверенное текущее состояние

Реализованы:

- один deployable NestJS API с `FastifyAdapter` в `apps/api`;
- runtime JSON Schema, TypeScript contracts и OpenAPI;
- PostgreSQL и Drizzle migrations;
- health, readiness, logging и единый error handler;
- вертикаль `WeightMeasurement`: идемпотентное создание неизменяемого факта,
  чтение по UUID и cursor pagination;
- synthetic staging acceptance и автоматическая доставка в staging.

Не реализованы:

- остальные предметные контексты и механизмы Google Sheets;
- correction и supersession фактов;
- подтверждение неоднозначного ввода;
- дневной lifecycle и межконтекстные projections;
- versioned business policies;
- API-контракты питания, тренировок, восстановления и coaching;
- backfill, dual-run, reconciliation и cutover.

## Результат read-only behavior audit

Проверены metadata и ограниченные диапазоны всех 26 листов, заголовки
предметных таблиц, значимые formulas `Daily_Log` и `Dashboard`, validations,
workflow contracts `NL_Engine`, `AI_Inbox`, `Self_Healing`, `AI_Timeline`,
`AI_Insights`, `Load_Risk`, `Weight_Autopilot` и `Coach_Planner`, а также
классификация `Settings`, `Rules` и `Decisions`.

Связанный Apps Script с business logic отсутствовал. Переход из workbook
создал пустой default-проект; код, triggers и deployments не обнаружены.
Наблюдаемое поведение зафиксировано в
`docs/wiki/data/google-sheets-behavior-catalog.md` без персональных значений.

Audit выявил дефекты legacy source: duplicate rule identifier, строку со
сдвинутыми полями, несоответствие action ожидаемому смыслу и устаревшие
governance rules Managed Wiki. Поэтому `Rules` нельзя переносить механически.
Ограничением остаётся неизвестное качество всех исторических строк, а не
отсутствие карты текущего поведения.

## Gap-анализ

| Область | Наблюдаемый источник | Реализовано | Основной gap до завершения DEV-023 |
| --- | --- | --- | --- |
| Physical State and Goals | `Weight`, `Body`, goals, часть `Daily_Log` | Только `WeightMeasurement` create/read/list, provenance и dedupe | Body measurements, goals, correction/supersession, разрешение двойного пути `Weight`/`Daily_Log`, история и projections |
| Nutrition | `Foods`, `Ingredients`, `Brands`, `Food_Ingredients`, `Meals` | Нет | Catalog identity, состав продуктов, meal/intake facts, nutrition snapshots, дневные итоги и правила изменения catalog |
| Training and Performance | `Training`, `Program`, `Personal Records` | Нет | Authoritative exercise identity, versioned program prescriptions, sessions, sets, completed work, derived PR и progression policies |
| Recovery and Readiness | wearable/recovery evidence, `Load_Risk` inputs | Нет | Observation contract, provenance устройств, timezone, readiness policy, многодневное окно и safety gates |
| Coaching and Decision Support | `AI_Insights`, `Load_Risk`, `Weight_Autopilot`, `Coach_Planner` | Нет | Versioned policies, evidence references, recommendation lifecycle, acceptance/rejection и запрет превращать recommendations в выполненные facts |
| Intake and audit | `NL_Engine`, `AI_Inbox`, `AI_Timeline` | Только локальная идемпотентность веса | Parsing boundary, clarification/confirmation, routing в owning modules, общий idempotency contract и append-only chronology |
| Integrity and correction | `Self_Healing`, validation и read-back contracts | Нет | Revision/supersession model, allowlisted deterministic repairs, before/after evidence, read-back и запрет скрытого overwrite |
| Daily projections | `Daily_Log`, `Dashboard` | Нет | Узкий day lifecycle, open/closed/correction policy, projection без широкого агрегата `DayRecord`, единая история и тренды |
| Configuration and policy | `Settings`, `Rules` и численные thresholds | Только runtime config API-процесса | Отделение business policy от spreadsheet governance, versioning, effective dates и audit изменений |
| Governance | `Changelog`, `Roadmap`, `Ideas`, `Decisions` | Не требуется в runtime | Отделить project governance от business rules; не переносить листы механически в API или PostgreSQL |

## Обязательные архитектурные решения

До реализации соответствующих schema и публичных API необходимо согласовать:

1. `User`/`Person` identity, ownership данных и границу будущей authentication
   — утверждено ADR от 2026-07-30.
2. Общую модель provenance, source reference, correction и supersession —
   утверждено ADR от 2026-07-30.
3. Семантику локального дня, `DayClosure`/`JournalDay` и correction closed day.
4. Identity упражнений и versioning тренировочной программы.
5. Identity catalog питания и обязательность nutrition snapshot.
6. Observation contract, timezone и privacy/retention для device evidence.
7. Lifecycle recommendation: proposed, accepted, rejected и executed.
8. Versioning business policies, thresholds и effective dates.
9. Conflict policy для конкурирующих source channels.

Решения с высокой стоимостью изменения фиксируются отдельными ADR. Один лист
не становится агрегатом, таблицей или модулем только из-за структуры workbook.

## Предлагаемая целевая модель

Этот раздел является архитектурным предложением, а не утверждённым решением.

### Runtime и database boundary

- Перевести application framework одного modular backend на NestJS, сохранив
  FastifyAdapter и принадлежащую backend PostgreSQL database.
- Не создавать microservices, broker или event store: текущий scale и ownership
  не дают для них driver.
- Начать с одной PostgreSQL schema и явных module-owned migrations/tables.
  Разные database schemas сейчас добавят migration и permission complexity, но
  не дадут реальной изоляции внутри одного deployable.
- Разделять модули в TypeScript, repositories и migrations; cross-module
  composition выполнять application/query layer, а не generic repositories.
- Использовать PostgreSQL transactional outbox только с первым реальным
  asynchronous workflow; не вводить Kafka без независимо deployable consumers,
  измеримого throughput или требования stream replay.
- Хранить revocable authentication sessions в PostgreSQL; точный identity
  provider и access-token protocol проектировать отдельной security task.
- Хранить binary media в private S3-compatible object storage, а в PostgreSQL —
  ownership, metadata и lifecycle; не разворачивать storage до первого media
  use case.
- Не вводить Redis без driver распределённого rate limit, realtime
  coordination, измеренного cache workload или job throughput.

### Facts, plans, decisions и projections

- Хранить исходные facts append-only с explicit correction/supersession,
  provenance и stable domain identity.
- Хранить training prescriptions и goals как versioned plans.
- Хранить assessments, insights и coaching outputs как immutable decisions с
  `policy_version` и evidence references.
- Строить `Daily_Log`, Dashboard, Personal Records и current-state views как
  queries или projections. Они не являются authority и не дублируют facts.
- Использовать `JSONB` только для raw source snapshot, объяснимого component
  breakdown и immutable calculation snapshot. Поля, участвующие в constraints,
  joins и частых filters, остаются typed columns.

### Policies без универсального rules engine

- Не строить универсальный DSL или таблицу «условие → действие».
- Реализовывать safety и business rules явными типизированными TypeScript
  policies с unit/behavior tests.
- Сохранять stable policy identifier, version, effective period и snapshot
  параметров, использованных конкретным assessment или recommendation.
- Отделять пользовательские targets от product safety rules и operational
  configuration.

### Предлагаемые module-owned модели

| Модуль | Authority tables | Derived или decision models |
| --- | --- | --- |
| Shared identity and provenance | `users`, `persons`, person access grants, revocable auth sessions, source references, media metadata | append-only audit timeline |
| Physical State and Goals | weight/body measurements, goal versions | trends и current goal projection |
| Nutrition | brands, ingredients, foods, compositions, meals, meal items, nutrition snapshots | daily nutrition totals |
| Training and Performance | exercises, program versions, prescriptions, workout sessions, performed sets | personal records и progression candidates |
| Recovery and Readiness | typed recovery/sleep observations с raw device snapshot | readiness и load-risk assessments |
| Coaching and Decision Support | recommendation lifecycle, acceptance/rejection | insights, progression recommendations, daily plan versions |
| Intake | ingestion requests, atomic commands, dedupe и clarification state | processing status и failure diagnostics |

Точный набор tables и columns проектируется по вертикалям после утверждения
общих semantics. Названия выше служат проверкой boundary, а не ERD.

### Transaction и integrity strategy

- Обычная domain mutation и изменение inbox status выполняются одной database
  transaction, когда принадлежат одной command boundary.
- Unique constraints защищают dedupe; foreign keys и checks защищают structural
  integrity; optimistic version проверяет принятие изменяемого plan.
- Spreadsheet-style snapshot/read-back/rollback не переносится на каждую
  database mutation. Transactions и constraints уже дают atomicity.
- Отдельные repair attempts нужны только для import, reconciliation и
  контролируемого исправления сохранённых данных.
- Append-only timeline является audit projection, а не authority и не полный
  event-sourcing log.

### Time и numeric representation

- Сохранять event timestamp как `timestamptz`, а локальную дату и timezone —
  явно там, где бизнес-правило зависит от календарного дня.
- Использовать точные numeric types для веса, размеров и nutrition values, а не
  floating point.
- Не закреплять правило «одна запись в день» unique constraint до утверждения
  cardinality; dedupe должен отражать source event, а не удобство spreadsheet.

## Предлагаемая последовательность

### 0. Миграция runtime на NestJS — завершена

- Выполнен отдельный утверждённый план
  `completed/2026-07-29-migrate-api-runtime-to-nestjs.md`.
- Сохранить FastifyAdapter, Drizzle, contracts и публичное поведение
  `WeightMeasurement`.
- Не начинать новые domain verticals до regression и Architecture Review
  миграции framework.

### 1. Behavior catalog и критерии parity

- Использовать завершённый read-only audit всех 26 листов и проверку Apps
  Script как evidence baseline.
- Для каждой реализуемой вертикали дополнить catalog конкретными owner, inputs,
  outputs, error behavior, authority и synthetic test vectors.
- Разделить business rule, projection, integration workflow и governance.
- Пометить неизвестное как blocker или явно утверждённое deferred behavior.

### 2. Общие доменные контракты — решения утверждены, implementation не начат

- Реализовать разделение authentication `User` и domain `Person`.
- Реализовать person-scoped provenance/source reference и idempotency contract.
- Реализовать correction/supersession и append-only audit chronology на
  `WeightMeasurement`.
- Спроектировать versioned policy и evidence reference.
- Выполнить отдельный план
  `completed/2026-07-30-person-identity-provenance-and-corrections.md`.

### 3. Physical State and Goals

- Завершить модель веса correction path и двойного источника.
- Добавить body measurements и goals.
- Добавить историю и доменные projections без переноса real data.

### 4. Nutrition

- Реализовать catalog entities и их identity.
- Реализовать meal/intake facts и immutable nutrition snapshots.
- Реализовать дневные nutrition projections.

### 5. Training and Performance

- Утвердить exercise catalog и identifiers.
- Реализовать versioned program prescriptions.
- Реализовать sessions, sets, completed work, personal records и progression
  candidates.

### 6. Recovery and Readiness

- Реализовать observations с provenance и нормализацией времени.
- Реализовать versioned readiness и load-risk policies с safety tests.

### 7. Coaching and Decision Support

- Реализовать insights, load-risk decisions, weight guidance и daily plan как
  recommendations со ссылками на evidence.
- Отделить создание рекомендации от её принятия и фактического выполнения.

### 8. Intake, lifecycle и projections

- Реализовать natural-language intake boundary с clarification и confirmation.
- Реализовать routing в owning modules и append-only timeline.
- Реализовать day lifecycle и межконтекстные read models для единой истории и
  трендов.
- Реализовать только явно безопасные deterministic correction workflows.

### 9. Стабилизация backend-контракта

- Проверить OpenAPI и runtime schemas всех вертикалей.
- Добавить unit, integration и behavior-parity tests.
- Проверить migrations на чистой и предыдущей schema.
- Выполнить synthetic staging acceptance.
- Провести независимый Quality Review и Architecture Review.
- Только после этого объявить DEV-023 завершённым и начать DEV-024.

## Критерии готовности DEV-023

- Для каждого переносимого механизма Google Sheets есть классификация:
  реализованный business rule, реализованная projection, adapter responsibility,
  governance/non-runtime или явно утверждённый deferred scope.
- Нет критичных формул, validations или workflow transitions со статусом
  `Unknown`.
- Пять draft bounded contexts представлены модулями внутри одного backend, а не
  отдельными deployable services.
- Facts, recommendations, policies и projections имеют разные контракты и
  lifecycle.
- Все mutations идемпотентны там, где возможен retry; corrections не стирают
  provenance.
- Публичные contracts проходят runtime validation и представлены в OpenAPI.
- Business rules покрыты test vectors, извлечёнными из workbook без копирования
  персональных значений.
- PostgreSQL migrations и integration tests принадлежат API.
- Synthetic staging acceptance подтверждает основные cross-module flows.
- Real-data gate отдельно требует authentication/authorization, защищённый
  transport, privacy/retention и утверждённый DEV-024 plan.
- Canonical Wiki, ADR и план согласованы; Architecture Review не выявляет
  скрытого переноса spreadsheet coupling.

## Вне объёма

- Backfill, dual-write/dual-run, reconciliation и cutover данных.
- Изменение исходной Google Sheets.
- Web- и mobile-клиенты.
- Перенос project-governance листов в runtime.
- Microservices, event bus и новые deployable boundaries без отдельного ADR.
- Реальные персональные данные в текущем synthetic staging.

## Риски

- Ограниченная инвентаризация может пропустить критичную formula или Apps Script.
- Пустой Apps Script project, автоматически созданный при проверке отсутствия
  связанного кода, удалён после явного разрешения и не входит в baseline.
- Механический перенос spreadsheet structure закрепит существующую связанность.
- Неутверждённые thresholds могут превратиться в неявные и небезопасные
  постоянные правила.
- Coaching может ошибочно смешать recommendation и executed fact.
- Общий `DayRecord` может создать чрезмерную transaction boundary.
- Реализация всех областей одним большим изменением усложнит review и rollback;
  каждая вертикаль должна иметь отдельный утверждённый task и migration.

## Architecture Review до реализации

1. **Избыточная сложность:** пять контекстов остаются Nest modules одного
   deployable API; отдельные сервисы и собственная abstraction над Nest не
   нужны.
2. **Преждевременные microservices:** отсутствуют. Integration и integrity
   workflows остаются capabilities внутри modular backend.
3. **DDD:** факты, policies, recommendations и projections разделены; листы не
   используются как автоматические aggregate boundaries.
4. **Дублирование:** roadmap хранит последовательность, Wiki — текущее состояние
   и модель, ADR — решения, этот план — gaps, порядок реализации и acceptance.
5. **Упрощение:** вертикальная поставка по контекстам проще единовременного
   переписывания workbook и позволяет проверять parity до переноса данных.

Дополнительное упрощение: typed policies с versioned parameters предпочтительнее
универсального rules engine; PostgreSQL transactions предпочтительнее
механического переноса spreadsheet self-healing; audit timeline
предпочтительнее полного event sourcing при текущих требованиях.

План не утверждает конкретные schema и endpoint names будущих вертикалей.
Они проектируются и согласуются отдельными задачами после behavior catalog.
