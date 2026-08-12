# TASK-0039 — Person-local day lifecycle и составная дневная projection

## Статус и граница разрешения

- Статус: implementation completed 2026-08-12; independent Quality Review
  остаётся следующим обязательным этапом.
- Канонический proposed ADR:
  [`docs/adr/20260811-model-versioned-person-local-day-closures.md`](../../../docs/adr/20260811-model-versioned-person-local-day-closures.md).
- ADR и scope утверждены оператором 2026-08-11. Документ разрешает реализацию
  только перечисленной границы; commit, push, migration execution и deployment
  требуют отдельных разрешений.

## Цель

Закрыть незавершённое архитектурное решение DEV-023 о Person-local day
lifecycle: дать пользователю явное закрытие дня, воспроизводимый снимок дневной
projection, append-only reopen/reclose и видимый статус поздних или
исправленных фактов, не создавая широкий `DayRecord` и не перенося authority из
предметных модулей.

## Product intent

- Дневной экран должен объединять текущие данные физического состояния,
  питания, тренировок, восстановления и coaching в одном read contract.
- Открытый день показывает живую projection.
- Закрытый день сохраняет то, что было подтверждено на момент закрытия.
- Поздние события и corrections не переписывают историю молча.
- Пользователь может явно переоткрыть день с причиной и затем создать новую
  версию закрытия.

## Утверждаемая архитектура

Рекомендуемый вариант — узкий versioned `DayClosure`:

1. Отсутствие активного closure означает open day; отдельный mutable
   `JournalDay` не создаётся.
2. Один активный closure на `(Person, localDate)`, IANA timezone фиксируется в
   каждой версии.
3. Closure хранит immutable projection snapshot, policy version и typed
   references, но не владеет предметными facts.
4. Reopen supersedes текущую версию с причиной; reclose создаёт новую версию.
5. Open projection собирается live через module-owned read ports; closed
   projection читает snapshot и вычисляет freshness/status поздних corrections.
6. Closure transaction принадлежит текущей API database. Нового сервиса,
   database, broker, scheduler или cross-service SQL нет.
7. Close использует idempotency key и optimistic freshness guard; конфликт
   требует безопасного rebuild/retry, а не частичного closure.

### Сравнение вариантов

| Вариант | Плюсы | Минусы | Решение |
|---|---|---|---|
| Широкий mutable `DayRecord` | Один объект для UI | Копирует `Daily_Log`, пересекает ownership и требует широких transactions | Отклонить |
| Mutable `JournalDay` со статусом | Явные open/closed rows | Добавляет вторую lifecycle authority и mutable history | Отклонить для первого среза |
| Только live projection | Минимум persistence | Нет explicit close, reproducibility и late-evidence semantics | Отклонить |
| Versioned `DayClosure` | Узкая coordination boundary, audit и reproducibility | Нужны versioned snapshot/policy и freshness checks | Рекомендовать |
| Автозакрытие в полночь | Меньше ручных действий | Не решены travel, delayed sources и retry policy | Отложить |

## Scope

### Входит

1. Утверждение ADR и точных invariants `DayClosure`.
2. API-owned schema/migration для closure versions, active uniqueness,
   idempotency и typed reference manifest.
3. Application-level daily projection composer через явные read ports
   существующих модулей.
4. Runtime schemas, TypeScript contracts и OpenAPI для:
   - чтения projection по `localDate` и IANA timezone;
   - close с idempotency key;
   - reopen с обязательной причиной;
   - чтения closure history и freshness.
5. Append-only audit/provenance для close, reopen и reclose.
6. Optimistic freshness guard между composition и сохранением closure.
7. Unit, integration, migration, concurrency и contract tests.
8. Синхронизация только затронутых current-state Wiki страниц после accepted
   quality.

### Не входит

- Изменение или удаление facts в Physical State, Nutrition, Training, Recovery
  и Coaching.
- Автоматическое закрытие дня, cron/job runner и notifications.
- Web/mobile UI и ChatGPT tool surface для day lifecycle.
- Production LLM parser, remaining Intake routes и provider selection.
- Подписки, billing, hosted LLM и BYO-LLM credentials.
- Google Sheets backfill, dual-run, reconciliation или authority cutover.
- Новый deployable, database, event bus, Redis или cross-service SQL.
- Выбор default timezone профиля Person.

## Предлагаемые invariants

1. `localDate` — календарная дата, а не UTC truncation; timezone — валидный
   IANA identifier.
2. На Person/localDate существует не более одного active closure независимо от
   timezone, чтобы travel не создавал два конкурирующих «одинаковых дня».
3. Closure version положительна и монотонна внутри Person/localDate.
4. Snapshot, policy version и manifest immutable после создания.
5. Reopen только supersedes active closure; физическое удаление и in-place
   update запрещены.
6. Reclose после reopen создаёт новый id и version.
7. Одинаковый idempotency key для той же операции возвращает прежний результат;
   конфликтующий payload fail-closed.
8. Closure references не предоставляют write authority в owning module.
9. Любое изменение referenced state во время composition отклоняет close без
   частичной записи.
10. Late/corrected fact меняет freshness, но не snapshot закрытой версии.

## Этапы после утверждения

1. [x] Перевести ADR из `proposed` в `accepted` и уточнить только затронутые
   current-state Wiki формулировки.
2. [x] Спроектировать entity/constraints/index names и статически проверить
   PostgreSQL identifier limit 63 UTF-8 bytes.
3. [x] Добавить чистую и upgrade migration с API ownership.
4. [x] Добавить module read ports и projection composer без generic
   cross-module repository.
5. [x] Реализовать close/reopen/history/freshness application services.
6. [x] Добавить runtime schemas, public contracts, OpenAPI и controllers.
7. [x] Добавить migration/integration/concurrency/contract tests.
8. [x] Прогнать затронутые TypeScript, lint, unit/integration, clean/upgrade
   migration и docs validation. Deployment contracts не требуют изменений:
   topology и image coordinates не менялись.
9. [ ] Провести независимый Quality Review и Architecture Review.
10. [ ] После accepted quality обновить Wiki/changelog и отдельно запросить
   commit/push/deployment approvals.

## Критерии приёмки

1. Open-day read возвращает live composed projection и не создаёт persistence.
2. Close создаёт immutable versioned snapshot с policy и typed references.
3. Два concurrent close с одним idempotency key дают один closure; разные
   конфликтующие операции не создают два active closures.
4. Reopen supersedes active closure с причиной; повторный reopen идемпотентен.
5. Reclose создаёт новую версию, сохраняя предыдущую историю.
6. Late или corrected evidence помечает closed projection stale и не меняет
   snapshot.
7. Optimistic freshness conflict оставляет database без partial closure.
8. Closure не изменяет domain facts и не становится authority для их totals.
9. Runtime validation/OpenAPI точно отражают date/timezone/idempotency/reason
   contracts и безопасные errors.
10. Нет нового deployable, database, credentials, migration owner, scheduler,
    broker или cross-service SQL.
11. Clean/upgrade migration, rollback readiness, full tests, Docker E2E,
    deployment contracts и docs validation проходят.
12. Architecture Review подтверждает отсутствие широкого daily aggregate и
   дублирования authority.

## Результат реализации

- Added one API-owned `DayClosure` module with append-only closure versions,
  an operation idempotency ledger, and a typed fact/decision reference manifest.
- Added live open projections plus immutable closed summaries. A recomposed
  current summary marks a closure `stale`; it does not mutate the stored
  snapshot.
- Added explicit `close`, `reopen`, history, contracts and OpenAPI routes.
- Passed API typecheck/build/lint, 42 unit tests, focused DayClosure PostgreSQL
  lifecycle tests, and the complete clean/upgrade migration suite. Canonical
  docs validation passed.
- No migration has been executed outside disposable test databases. Commit,
  push, staging migration, deployment, and independent Quality Review remain
  separate gates.

## План проверки

- Static schema checks и identifier-byte validation.
- API migration integration на clean schema и предыдущем snapshot.
- Concurrent close/reopen/reclose tests, включая pool-size boundary.
- Idempotency replay и conflicting-payload tests.
- Projection tests для open, closed, stale и superseded states.
- Correction/late-fact fixtures из каждого подключённого owning module.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`.
- `pnpm test:e2e` и disposable API/Identity stack.
- Staging deployment contracts без фактического deploy.
- `node scripts/validate-docs.mjs` и `git diff --check`.

## Architecture Review checklist

1. Complexity: snapshot/manifest оправданы explicit close и reproducibility;
   scheduler/event bus отсутствуют.
2. Deployables: остаётся текущий modular API, новый service не создаётся.
3. DDD: facts принадлежат текущим bounded contexts; closure — только узкая
   coordination boundary.
4. Duplication: ADR хранит решение, Wiki — current state, план — execution;
   snapshot не становится второй fact authority.
5. Simplification: отсутствие отдельного mutable `JournalDay` сокращает state
   machine без потери open/closed semantics.

## Решение об утверждении

Recommended versioned `DayClosure` и этот scope утверждены оператором
2026-08-11. Реализация может начинаться в перечисленной границе.
