# TASK-0094 — Retention и authenticated erasure для Recovery connection

## Проблема

`retainUntil` пока не исполняется, а отзыв Recovery consent только прекращает
новый сбор. Пользователь не может удалить health data и производные выводы,
полученные через конкретное wearable connection. Из-за этого real provider
ingestion остаётся запрещённым.

## Цель

Реализовать accepted ADR
`20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md`:
после свежего passkey подтверждения немедленно закрывать connection для reads и
writes, надёжно удалять весь зависимый Recovery/Coaching граф и не допускать
возврата удалённых данных после восстановления backup.

## Принятое решение

1. Добавить в API DB typed `RecoveryErasureRequest` с idempotency key,
   connection scope, lifecycle/lease/attempt timestamps, безопасным outcome и
   минимальным receipt/marker без health payload.
2. Добавить quarantine transition, которая в одной transaction создаёт request,
   отзывает consent, отключает connection и немедленно исключает связанные raw
   и derived данные из collection и Person reads.
3. Реализовать API-owned idempotent worker и retention sweep внутри
   существующего deployable. `retainUntil` и явное удаление используют один
   request path.
4. Удалять dependency graph: Coaching decisions/recommendations/evidence,
   Recovery assessment evidence/assessments, observation detail/import rows,
   observations, orphaned Person source references, devices/consents/connection.
5. Сохранять unrelated manual observations и shared provider/model/capability/
   policy definitions.
6. Добавить versioned Identity/API fresh-auth contract: новая passkey ceremony,
   короткоживущая single-use authority, привязанная к subject, browser session,
   purpose и connection id. Не использовать cross-service SQL.
7. Добавить минимальный Web privacy/security flow с явным предупреждением,
   fresh passkey, повторяемым status и защищёнными Origin/CSRF mutations.
8. Добавить append-only erasure manifest export/apply contract для backup
   boundary. Restore остаётся fail-closed до применения независимо сохранённого
   manifest; pre-erasure restore проверяется отдельным drill.
9. Не добавлять MCP delete tool, новый deployable, service-shared database,
   account-wide deletion, Garmin/provider integration или generic privacy
   platform.

## Этапы реализации

1. **API schema и migration.** Спроектировать enum/table/index/constraints для
   request, quarantine и worker lease; проверить every-prefix migrations и
   63-byte identifiers.
2. **Recovery lifecycle.** Добавить repository/service contracts для request,
   immediate quarantine, status, retention sweep и dependency-aware deletion.
3. **Read/write isolation.** Централизованно исключить quarantined connection и
   зависящие от него assessments/recommendations из всех Recovery, Coaching,
   daily projection и progress reads; запретить новые device writes.
4. **Worker и scheduler.** Реализовать bounded claim, retry и idempotent cleanup
   в API process без нового deployable; обеспечить продолжение после crash.
5. **Fresh authentication.** Добавить Identity ceremony и API verification/
   consumption с replay, expiry, subject/session/purpose/scope checks.
6. **Web control.** Добавить connection list/status/delete flow в privacy или
   security UI, сохранив server-side sessions и CSRF/Origin contract.
7. **Backup/restore contract.** Реализовать безопасный manifest export/apply и
   readiness gate для isolated restore. Согласовать с cluster owner фактический
   maximum backup retention и независимое защищённое storage до разрешения real
   provider data.
8. **Проверки.** Добавить unit/contract/integration/E2E и restore-drill coverage,
   затем провести независимые Quality и Architecture Reviews.
9. **Документация после acceptance.** Синхронизировать current-state Wiki с
   фактически реализованным поведением и оставить Garmin ingestion отдельной
   задачей.

## Acceptance criteria

1. Явный erase требует fresh passkey authority; обычная session, повтор authority
   или authority от другого connection отклоняются.
2. Первый принятый request атомарно закрывает collection и все пользовательские
   reads; повтор с тем же intent возвращает тот же lifecycle без дублей.
3. Worker безопасно продолжает после сбоя и удаляет весь raw/derived граф,
   способный раскрыть connection health facts.
4. Manual observations без connection и shared definitions сохраняются.
5. Истёкший exact `retainUntil` автоматически создаёт тот же request ровно один
   раз; `indefinite` не истекает сам.
6. Receipt/manifest не содержит health values, credentials, raw provider ids,
   labels или authentication proof.
7. Pre-erasure backup нельзя открыть для трафика до применения полного
   независимо сохранённого manifest; после replay удалённые raw/derived данные
   отсутствуют.
8. Web flow показывает scope и необратимость, требует passkey и позволяет
   безопасно повторно получить status; MCP surface не содержит delete tool.
9. Нет нового deployable, cross-service SQL, общей database/credential или
   Garmin/provider implementation.
10. API, Identity, Web, migration, restore, docs, Quality и Architecture checks
    проходят.

## Проверка

- Targeted API Recovery/Coaching repository and service tests.
- Identity/API fresh-auth contract tests и browser security tests.
- PostgreSQL integration tests, clean install, every migration prefix и
  generated-identifier length check.
- Worker crash/retry/concurrency и retention clock tests.
- Web Playwright E2E для confirm/cancel/retry/status.
- Isolated pre-erasure backup restore + manifest replay drill.
- Полные package scripts для API, Identity и Web.
- `node scripts/validate-docs.mjs` и `git diff --check`.
- Независимые Quality и Architecture Reviews через 4DreamTeam.

## Блокеры реальных wearable данных

- Владелец PostgreSQL cluster должен утвердить maximum backup retention,
  защищённое независимое storage erasure manifest и restore runbook.
- Restore drill должен пройти на фактической staging backup topology.
- Garmin/provider credentials и ingestion остаются TASK-0095 и не входят в
  этот план.

## Запрещено без отдельного подтверждения

- implementation patch до одобрения developer plan;
- staging writes, migration и deployment;
- commit и push;
- production и secrets;
- Google Sheets writes, ACL, archive или delete.
