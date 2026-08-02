---
title: Реализация Intake requests, PostgreSQL-очереди и типизированного routing
status: completed
created: 2026-08-02
updated: 2026-08-02
related_roadmap_items:
  - DEV-023
related_board_items:
  - TASK-0022
---

# Реализация Intake requests, PostgreSQL-очереди и типизированного routing

## Цель

Добавить в существующий NestJS API надёжную основу natural-language Intake:
принимать исходный текст без ожидания parser, сохранять его идемпотентно,
разбирать на независимо подтверждаемые typed items, выполнять задания через
PostgreSQL-очередь и направлять подтверждённые facts в owning modules без
дублирования domain authority.

## Утверждённая архитектура

- Решение зафиксировано в
  `docs/adr/20260802-use-durable-postgresql-intake-queue-and-typed-items.md`.
- Intake остаётся capability существующего API modular monolith.
- Queue хранится в API PostgreSQL; Kafka, RabbitMQ и новый service не нужны.
- Один request содержит независимые typed items с item-level clarification,
  confirmation, retry и terminal states.
- Domain fields и links хранятся реляционно; универсальный JSON/JSONB payload
  запрещён.
- Domain fact, item result и timeline entry фиксируются одной transaction.
- Parser подключается через provider-neutral port; конкретный AI adapter
  выбирается и реализуется отдельным решением.

## Объём

### Входит

- Person-owned `IntakeRequest` с исходным текстом, source reference, locale,
  timezone и person/source-scoped idempotency.
- Typed `IntakeItem`, parsing state, clarification/confirmation lifecycle и
  derived request status.
- PostgreSQL work queue с lease, `SKIP LOCKED`, retry/backoff и terminal state.
- Append-only typed Intake timeline без event-sourcing authority.
- Provider-neutral `IntakeParser` port и synthetic adapter для unit/integration
  verification.
- Первый end-to-end typed route для `WeightMeasurement`, включая typed detail,
  confirmation, owning-module command и ссылку на созданный fact.
- HTTP API создания request, чтения projection, clarification, confirmation и
  безопасного retry.
- Additive Drizzle migration, NestJS module, OpenAPI, unit и PostgreSQL tests.
- Metrics/logging contracts для queue lag, retries и terminal failures без
  исходного пользовательского текста в logs.

### Не входит

- Конкретный OpenAI или другой AI-provider adapter и provider credentials.
- Универсальный JSON/JSONB parser или command payload.
- Meal, BodyMeasurementSession, Training и Recovery routing; они добавляются
  следующими typed slices поверх проверенной основы.
- Kafka, RabbitMQ, Redis queue, отдельный worker service или новая database.
- Day closure, closed-day correction policy и межконтекстная дневная projection.
- Автоматическое подтверждение неоднозначных или low-confidence items.
- Google Sheets mutation, import, backfill и authority cutover.

## Этапы

1. Добавить domain contracts и явные state transitions для request, item, job
   и timeline.
2. Добавить schema и одну additive migration с typed Weight detail, indexes,
   checks, foreign keys, dedupe и lease constraints.
3. Реализовать repository transactions: create request/job, claim lease,
   complete/retry job, persist parse result и read projection.
4. Добавить `IntakeParser` port и synthetic parser adapter только для tests.
5. Выделить transaction-aware WeightMeasurement command port без изменения
   существующего публичного Weight contract.
6. Реализовать worker orchestration и atomic routing результата.
7. Подключить NestJS controller/module, lifecycle startup/shutdown и OpenAPI.
8. Добавить unit и PostgreSQL integration tests для concurrency, retries,
   partial progress, idempotency и Person isolation.
9. Проверить clean/upgrade migration chain и отсутствие regressions остальных
   verticals.
10. Провести независимые Quality Review и Architecture Review.
11. После принятия обновить current-state Wiki и перенести план в completed.

## Критерии приёмки

1. Создание request возвращает `202 Accepted` и не ожидает parser result.
2. Повтор с тем же Person/source/idempotency key возвращает тот же request.
3. Исходный текст не попадает в application logs или error diagnostics.
4. Parser port создаёт упорядоченные typed items без domain JSON/JSONB payload.
5. Каждый item проходит только разрешённые state transitions.
6. Ambiguous item можно уточнить независимо от sibling items.
7. Подтверждение одного item не подтверждает остальные.
8. Queue job создаётся atomically с request или подтверждением item.
9. Concurrent workers не получают один job одновременно.
10. Истёкший lease возвращает незавершённый job в обработку.
11. Retry использует backoff и после лимита переводит job в terminal state.
12. Повтор routing job не создаёт второй WeightMeasurement.
13. WeightMeasurement и successful item/timeline result фиксируются atomically.
14. Intake хранит typed foreign key на созданный WeightMeasurement, но не
    копирует его authority fields после выполнения.
15. Другой Person не может читать, уточнять, подтверждать или повторять request.
16. Request projection корректно показывает waiting, partial, completed и
    failed combinations без отдельной изменяемой aggregate authority.
17. Worker корректно останавливается при shutdown и не влияет на API readiness
    при временной недоступности parser.
18. Existing API contracts и поведение Physical State, Nutrition, Training,
    Recovery и Coaching не изменяются.
19. Runtime schemas, OpenAPI, migration, unit, integration и documentation
    checks проходят.

## Проверки

- ESLint для затронутых TypeScript-файлов.
- TypeScript typecheck и build contracts/API.
- Все API unit и PostgreSQL integration tests.
- Clean migration и каждый committed journal prefix до новой migration.
- Concurrency tests для request dedupe, queue claim и Weight routing.
- Retry, expired lease, terminal failure и graceful shutdown tests.
- Person-isolation и отсутствие raw text в captured logs.
- `node scripts/validate-docs.mjs` и docs tests.
- `git diff --check` и audit PostgreSQL identifiers до 63 bytes.

## Риски и ограничения

- Без конкретного AI adapter production parsing останется недоступным; эта
  задача проверяет orchestration contract на synthetic adapter.
- Первый typed slice доказывает routing только для WeightMeasurement; другие
  modules требуют собственных detail tables и command ports.
- Worker внутри API runtime связывает обработку с количеством API replicas;
  lease и idempotency сохраняют корректность, но отдельное масштабирование
  откладывается до подтверждённой нагрузки.
- Partial completion требует понятного UI: пользователь должен видеть, какие
  items записаны, а какие ждут действия или завершились ошибкой.

## Architecture Review до реализации

1. **Избыточная сложность:** используется одна database и существующий API;
   внешний broker и новый service отсутствуют.
2. **DDD:** Intake координирует commands, но domain facts остаются в owning
   modules.
3. **Дублирование:** request хранит source text и lifecycle, typed detail —
   только proposed command, а выполненный fact не копируется.
4. **Целостность:** typed foreign keys и transactions заменяют polymorphic
   references, JSON envelopes и distributed compensation.
5. **Упрощение:** первый slice ограничен WeightMeasurement; расширение идёт
   отдельными typed routes после проверки общей очереди.

## Результат

Реализованы person-owned Intake requests, независимые typed items,
PostgreSQL-очередь с lease/retry, clarification/decision lifecycle,
append-only timeline и первый atomic route в `WeightMeasurement`. Добавлены
HTTP/OpenAPI contracts, generated Drizzle migration и проверки concurrency,
идемпотентности, Person isolation, lease reclaim и terminal failure.

Независимая Quality Review приняла 19 из 19 критериев. Architecture Review
подтвердила отсутствие преждевременного service/broker boundary, сохранение
domain ownership и отсутствие универсального JSON/JSONB хранилища. Полный
Vitest прошёл: 15 файлов и 64 теста, включая каждый migration journal prefix;
также прошли typecheck, build, ESLint и canonical documentation validation.

Production AI adapter, остальные typed routes и общий day lifecycle остаются
вне завершённого объёма и требуют отдельных решений и планов.
