# TASK-0181 — Переход Intervals → Garmin с сохранением истории

Статус: локальный этап завершён 2026-11-20; Independent Quality и Architecture
Review приняты (`task0181-independent-quality-20261120`,
`task0181-independent-architecture-20261120`). Оператор утвердил ADR и этап
ответом «Да, утвердить и реализовать».
Реальный переход, shared-environment migration и delivery не разрешены.

## Основание

[Принятый ADR](../../../../docs/adr/20261120-switch-intervals-to-garmin-with-date-boundary.md)
является единственной authority решения. Timeline
TASK-0181 содержит analysis/review, без второго standalone отчёта.

Уточнение формата журнала отдельно утверждено оператором 2026-11-20 ответом
«Да, реализуй v2 локально»:
[journal v2 ADR](../../../../docs/adr/20261120-preserve-cutover-bounds-in-erasure-journal-v2.md).
Локальный этап включает prefix-preserving codec/sync/replay, durability proof
для activation и offline upgrade tooling/tests. Реальная замена staging
journal требует отдельного operational разрешения.

## Объём этапа проектирования

1. Проверить текущие provider guards, connection-scoped identities, consent
   fencing, Training links, FIT-derived Recovery и history windows.
2. Сравнить future-only boundary с немедленным precedence, hybrid wellness
   и полным переносом истории. Спроектировать новую конфигурацию до создания.
3. Описать preview/consent/schedule, один ввод ключа в сайте, retry/erasure,
   сохранение старых IDs и честное coverage HRV/sleep score, Training load,
   attribution и фактического FIT decode.
4. Провести независимую Architecture Review draft и устранить противоречия.
5. Представить оператору конкретный ADR/план. Не менять current-state Wiki
   до принятия/реализации, не отключать Intervals и не запрашивать key в окне.

## Предлагаемый локальный этап после утверждения

1. Финализировать точные runtime schemas, DDL `integration_cutovers`,
   CAS/idempotency и erasure manifest; добавить scope snapshot истории и
   корректный completed cursor вместо фиксированного 2000 для cutover jobs.
   Показать их в diff до implementation.
   Никакой migration apply в shared environment этим не разрешается.
2. Реализовать read-only preview, scoped pending credential/schedule/status/
   cancel/retry, worker activation и 14-дневную ограниченную дозагрузку старого
   периода в текущем API. Сохранить empty-account
   linking нового пользователя и обычную key rotation.
3. Добавить atomic consent + date/instant import-policy guards для всех
   write paths; обрезать rolling/history запросы и admission facts.
4. Переключать current delivery по effective policy/date, без изменения
   исторических facts/IDs и без Garmin history до границы.
5. Добавить UI preview с датой начала, gaps и ограничением старой истории;
   ключ вводится один раз и хранится encrypted в pending connection.
6. Проверить API contracts, PostgreSQL boundary/race/rollback/erasure tests,
   static identifier limit, history progress, Web E2E и отсутствие secrets.
7. Независимая Quality и Architecture Review, affected Wiki, docs validator
   и diff check. Локальный этап завершать независимо от будущей delivery.

## Gate перед реальным переходом

- Отдельно утверждённый и доставленный implementation, миграция и staging smoke.
- Отдельно разрешённый offline upgrade реального journal v1 → v2 с остановкой
  всех writers; затем успешный sealed sync и проверка policy proof.
- Явное разрешение владельца на named Person cutover/date и обычный import consent.
- Реальные coverage gaps закрыты mappings либо отдельно приняты по именам
  пользователем; принять waiver только для показанной mapping version.
  Сейчас target HRV/общий sleep score и Intervals normalized load не реализованы.
- Ключ проверяется в штатном сайте. Авторизованный candidate read/FIT decode
  не сохраняет domain facts и не раскрывает данные в отчётах.
- Перед границей Intervals остаётся рабочим; после успешной активации
  новые факты поступают только в разрешённом диапазоне Garmin. Intervals
  ещё 14 локальных дней дозагружает только старый диапазон, затем отключается.

## Критерии приёмки

- Ни одно старое ID/history/link не меняется; manual facts не затронуты.
- Нет пересечения диапазонов при in-flight worker, retry и concurrent callbacks.
- Новые permissions не обходят existing consent/erasure и history guards.
- Нет скрытого acceptance потери HRV/score/normalized load, автоматического erase/merge
  или promise немедленного сегодняшнего Body Battery при завтрашней границе.
- Отмена до активации освобождает provisional fences при отсутствии target facts;
  после activation commit нет автоматического возврата даже при нуле target facts
  к Intervals при сбое Garmin. Ограничение late old-history refresh явно показано.
- Состояние отчёта различает scheduled, draining (переход уже состоялся),
  active (drain закончен) и успешный импорт. Disjoint ranges не объявляются
  доказательством semantic dedup при расхождении provider timestamps/date labels.

## Затронутые области

- API Integrations service/repository/worker, existing database/migrations.
- Recovery/Training import admission и erasure contracts; Coaching delivery routing.
- Shared public contracts/OpenAPI и Web Connections.
- Canonical ADR, affected Wiki после приёмки, integration/E2E checks.

Commit/push, deployment, shared-environment migration, credential access и
сам реальный переход требуют соответствующих отдельных approvals.

## Локальная проверка

- API: 519 unit tests, typecheck, build и lint прошли. Новые проверки включают
  fixed tail, local-day boundary, parent UTC ownership, отказ до decrypt,
  saved-key retry и отдельный `journal_not_ready`.
- PostgreSQL: 18 cutover/proof/replay/legacy-manifest tests и 3 HTTP tests прошли
  на отдельном native PostgreSQL с синтетическими данными.
- Все 82 migration-chain tests прошли на чистом isolated PostgreSQL с UTC,
  включая upgrade каждого prefix и статическую проверку identifiers ≤63 bytes.
  Native restore drill прошёл 2/2. Миграции применял только локальный test harness.
- Web: unit/typecheck/lint/build, полный набор 37 Playwright cases до двух
  новых failure reasons и три дополнительных E2E после них прошли.
- Independent reviewer повторил 18 PostgreSQL tests, 48 scoped unit и 2 manifest
  unit tests, проверил v2 codec/sync/replay/upgrade и architecture gates.
  Замечания закрыты; локальное acceptance принято. Affected canonical Wiki обновлена.
- Реальный журнал, shared environment, ключ пользователя, connection и Git index
  не менялись. Локальная проверка не означает staging delivery или реальный cutover.
