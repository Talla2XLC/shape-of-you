# TASK-0101 — Garmin через Intervals.icu

## Статус

Завершён 2026-09-07 после реализации, независимой Quality acceptance,
Architecture Review и обновления затронутой canonical Wiki. Реальный provider
остаётся выключенным до отдельных внешних и operational approvals.

## Проблема

Shape of You не может рассчитывать на прямой Garmin Connect Developer Program
как частный проект и не должен собирать Garmin passwords или использовать
private APIs. Intervals.icu уже получает workouts и часть wellness через
официальный Garmin channel и предоставляет Shape of You публичный OAuth 2.0 и
REST API.

Нужно реализовать честный `Garmin через Intervals.icu` flow внутри существующего
API: encrypted Person token, автоматический typed import, sync status,
idempotency, disconnect и существующий fail-closed erasure lifecycle.

## Цель

Пользователь связывает Shape of You с Intervals.icu через OAuth, получает ясную
инструкцию подключения Garmin в Intervals.icu, после чего Shape автоматически
импортирует поддерживаемые wellness и activity facts, показывает состояние и
время синхронизации, не создаёт дублей и независимо выполняет disconnect и
удаление импортированных данных.

## Принятое решение

Следовать ADR
`docs/adr/20260907-connect-garmin-through-intervals-icu.md`:

1. adapter живёт внутри `apps/api`;
2. внешний connection называется `Garmin через Intervals.icu`;
3. Shape OAuth scopes ограничены `ACTIVITY:READ` и `WELLNESS:READ`, а
   `SETTINGS:READ` добавляется только при доказанной контрактной необходимости;
4. Intervals access token хранится encrypted per Person connection;
5. wellness без provider attribution не маркируется как достоверно Garmin;
6. incoming data проходит validation, inbox, normalization и двухуровневую
   idempotency;
7. disconnect прекращает импорт, erasure отдельно удаляет connection-derived
   facts через существующий journal gate;
8. реальные registration, credentials, migration apply, deploy и VM operations
   не входят в автоматически разрешённый scope.

## Затрагиваемые области

- `packages/contracts` — public connection/start/status/disconnect contracts и
  provider-neutral typed status.
- `apps/api/src/integrations/intervals-icu/` — OAuth/REST adapter, schemas и
  normalization; transport types не выходят в domain.
- `apps/api/src/integrations/` — узкий provider-neutral port, coordinator и
  contract fake.
- `apps/api/src/database/schema.ts` и `apps/api/drizzle/` — OAuth transaction,
  encrypted credential, inbox/reconciliation state, sync projection и
  cross-domain connection provenance.
- `apps/api/src/recovery/` и repository — connection lifecycle, consent,
  corrections, disconnect и erasure dependency expansion.
- `apps/api/src/training/` и repository — typed external activity summary и
  Garmin device attribution без raw provider payload.
- Physical State storage — только для тех Intervals wellness facts, которым
  уже соответствует typed entity и connection provenance.
- `apps/api/src/openapi.ts` и API tests — published authenticated contracts.
- `apps/web/app/` — Connections page, disclosure, callback completion, status,
  last sync, disconnect и отдельный erasure flow.
- `deploy/staging/` и workflow contracts — только versioned configuration names;
  фактические values и deployment требуют отдельных approvals.
- После accepted Quality — только затронутые canonical Wiki pages.

## Этапы реализации

1. **Зафиксировать contract matrix.** Сохранить в tests минимальные официальные
   Intervals OAuth/wellness/activity shapes, rate-limit assumptions и unknown
   handling. Не выполнять network call и не использовать настоящий account.
2. **Расширить provider-neutral connection model.** Добавить lifecycle и sync
   health, external athlete identifier, encrypted credential envelope, одноразовую
   authorization transaction и connection-linked source provenance.
3. **Создать migration.** Добавить только API-owned tables/columns/indexes/FKs,
   проверить все PostgreSQL identifiers на 63 UTF-8 bytes и clean-database
   migration. Не применять migration к staging без отдельного approval.
4. **Реализовать OAuth flow.** Authenticated+CSRF start, exact callback,
   state hash/expiry/one-use, server-side code exchange, encrypted token store,
   minimal scopes и safe same-origin completion redirect.
5. **Реализовать Intervals adapter и fake.** Bounded HTTP client, response size
   limits, runtime schema validation, timeouts, retry classification, redacted
   errors и deterministic fake без новой dependency, если текущих средств
   достаточно.
6. **Реализовать reconciliation/inbox.** Poll recent wellness sliding window,
   consume verified activity webhook только если documented contract достаточен,
   иначе poll activities по cursor; использовать leases, bounded backoff и
   reconciliation watermark без long-running отдельного service.
7. **Нормализовать Recovery facts.** Поддержать sleep, sleep score, resting HR,
   HRV rMSSD и Body Battery. Дополнительные fields импортировать только при
   наличии существующей typed domain model; unknown fields safely ignore и
   учитывать в non-sensitive diagnostics.
8. **Нормализовать Training activity.** Сохранить typed workout/activity
   summary, available HR/duration/distance/load fields и source reference.
   Garmin attribution выставлять только при подтверждённом `device_name`.
   Детальные raw FIT/route payloads и continuous all-day HR исключить из MVP.
9. **Добавить idempotency и corrections.** Same identity+checksum — no-op;
   changed daily wellness или activity — immutable supersession. Проверить late
   sleep updates и повторные provider deliveries.
10. **Добавить disconnect и erasure.** Сначала revoke local consent и stop
    claims, затем remote `disconnect-app`; расширить journal-backed dependency
    graph на все connection-linked domains. Remote failure не удаляет прежние
    facts и остаётся retryable.
11. **Реализовать Web UX.** Connections page показывает prerequisite
    Intervals account/Garmin setup, provider disclosure, connecting/active/
    degraded/disconnected, last successful sync, Connect, Disconnect и отдельно
    passkey-gated Delete imported data. Не хранить token/code/state в browser
    storage.
12. **Добавить versioned deployment contracts.** Feature flag, client id,
    client secret, exact redirect URI, encryption key ring/active key id и
    optional verified webhook secret передаются обычным CI/CD. Не добавлять
    реальные values и не редактировать VM.
13. **Провести Developer checks.** Targeted unit/integration/web tests, full
    lint/typecheck/build, OpenAPI, migration clean DB, identifier scan,
    `git diff --check` и docs validator.
14. **Провести независимую Quality.** Проверить каждый acceptance criterion,
    отсутствие unrelated changes/secrets/raw JSON authority и negative/race
    paths; Developer не создаёт собственную acceptance.
15. **Провести Architecture Review.** Проверить отсутствие преждевременного
    microservice, сохранение DDD boundaries, узость abstraction, отсутствие
    дублирования authority и возможность упрощения.
16. **После Quality обновить документацию.** Изменить только текущие страницы
    Recovery, Training, connection/API, provenance и deployment, затем
    валидировать docs и перенести план в `completed/`.

## Acceptance criteria

1. Пользователь запускает `Garmin через Intervals.icu`, видит честный
   two-provider disclosure и завершает approved Intervals.icu OAuth без передачи
   Garmin password или personal API key Shape of You.
2. OAuth state одноразовый, expiring, Person-bound и replay-safe; callback URI и
   scopes allowlisted, code/token/provider errors не попадают в logs или UI.
3. Person token хранится только authenticated-encrypted; client credentials и
   encryption keys существуют только как runtime configuration.
4. Connection API/Web показывают lifecycle, safe degraded reason,
   `lastAttemptAt`, `lastSuccessfulSyncAt` и `lastDataAt`.
5. Contract fake без настоящего аккаунта покрывает success, denial, expiry,
   rate limit, timeout, malformed/oversized response, retry и token revocation.
6. Поддерживаемые Intervals wellness facts становятся typed immutable Recovery
   observations; raw JSON не является authority.
7. Поддерживаемые activities становятся typed Training facts; Garmin
   attribution появляется только при подтверждённой Garmin device metadata.
8. Wellness без origin metadata имеет provenance Intervals.icu и не выдаётся за
   достоверно Garmin-originated.
9. Повтор той же delivery/record не создаёт дубль; изменённый sleep, wellness
   или activity создаёт целую correction/supersession.
10. Ошибка, timeout или rate limit Intervals.icu переводит sync в degraded,
    сохраняет ранее импортированные данные и не ломает обычные API reads.
11. Disconnect немедленно прекращает новые claims/import, отзывает local
    consent и best-effort/retryably вызывает provider disconnect, не удаляя
    imported facts.
12. Отдельное fresh-passkey erasure удаляет все connection-derived Recovery,
    Training, Physical State и derived facts только через существующий
    fail-closed journal lifecycle.
13. API adapter остаётся in-process; не появляются microservice, отдельная
    database, credential boundary, message broker или long-running deployable.
14. Config/deployment assets versioned и проверяемы в CI/CD; repository, static
    Web artifact и logs не содержат реальные credentials.
15. API/Web checks, migration clean-DB tests, PostgreSQL identifier scan,
    independent Quality, Architecture Review и docs validation проходят.

## Проверки

- `pnpm --filter @shape-of-you/contracts lint`
- `pnpm --filter @shape-of-you/contracts typecheck`
- `pnpm --filter @shape-of-you/contracts test`
- `pnpm --filter @shape-of-you/api lint`
- `pnpm --filter @shape-of-you/api typecheck`
- `pnpm --filter @shape-of-you/api build`
- `pnpm --filter @shape-of-you/api test:unit`
- `pnpm --filter @shape-of-you/api test:integration`
- clean PostgreSQL migration run in disposable environment
- static PostgreSQL identifier scan (`<= 63` UTF-8 bytes)
- `pnpm --filter @shape-of-you/web lint`
- `pnpm --filter @shape-of-you/web typecheck`
- `pnpm --filter @shape-of-you/web build`
- `pnpm --filter @shape-of-you/web test`
- targeted browser flow with fake provider
- `node scripts/validate-docs.mjs`
- `git diff --check`

## Отдельные approvals

Перед соответствующим действием отдельно требуются:

1. создание migration files и source implementation по этому плану;
2. регистрация OAuth application в Intervals.icu;
3. получение, чтение или provision реальных client credentials;
4. использование personal API key или реального Garmin/Intervals account для
   smoke test;
5. применение migration локально к постоянной DB или в staging;
6. staging, commit, push, deployment и любые VM operations.

## Запрещено без отдельного подтверждения

- просить или хранить Garmin password, session или private API token;
- добавлять unofficial Garmin library или browser scraping;
- регистрировать OAuth application от имени оператора;
- добавлять реальные secrets/configuration values;
- применять migration или выполнять database writes вне disposable tests;
- выполнять staging, commit, push, deploy, restart или VM commands;
- документировать неподтверждённые provider metrics как работающие.

## Итог

Реализация принята независимой Quality и Architecture Review. Обновлены только
затронутые canonical Wiki pages. Регистрация Intervals.icu OAuth application,
credentials, live smoke, применение migration, commit, push, deployment и VM
operations остаются отдельными approvals.
