# TASK-0080 — Транзакционное retirement сокращённых OAuth scopes

## Статус и разрешение

- Статус: architecture accepted, implementation approval pending.
- Оператор выбрал транзакционный OAuth scope retirement внутри существующей
  Identity boundary командой `го` 2026-08-30.
- Текущее разрешение покрывает task intake, анализ, accepted ADR и этот план.
- Implementation code начнётся только после отдельного одобрения плана.
- Staging writes, deployment, OAuth reconnect, production, secrets, Git
  staging, commit и push требуют отдельных gates.

## Цель

Разблокировать deployment TASK-0079 и сделать удаление predefined OAuth scopes
безопасной повторяемой Identity lifecycle operation: отозвать зависимую
authorization state до удаления allowlist row, не затрагивая browser login и
product data.

## Границы

- Изменения только в существующем Identity deployable, его tests и staging
  deployment contract.
- Использовать существующую PostgreSQL schema, transaction и client
  reconciliation lock; migration не добавлять.
- Не создавать сервисы, базы, OAuth clients, scopes или operator SQL scripts.
- Не восстанавливать `day-closure:write` и не выполнять Google Sheets writes.

## План реализации

1. [x] Зафиксировать staging evidence и точную FK-причину failed deployment.
2. [x] Сравнить три варианта и получить architecture approval варианта с
   transactional retirement.
3. [x] Создать TASK-0080, accepted ADR и implementation plan.
4. [x] После отдельного одобрения расширить `OAuthClientStore` вычислением
   retired scopes и атомарным retirement зависимых artifacts до allowlist
   deletion.
5. [x] Переиспользовать единый family-before-token lock order и вынести общий
   transaction-scoped revocation helper, не создавая второй OAuth lifecycle.
6. [x] Обновить TSDoc и сохранить credential-free command result без вывода
   URI, scopes пользователя, tokens или account identifiers.
7. [x] Добавить integration evidence для affected/unaffected state,
   idempotency, concurrency и full rollback after injected failure.
8. [x] Поменять release declaration на
   `identity_oauth_clients_backward_compatible: false` и обновить deployment
   contract tests.
9. [x] Выполнить Identity unit/integration, typecheck/build, deployment tests,
   root relevant gates, PostgreSQL identifier check, docs validation и
   `git diff --check`.
10. [x] Провести Quality и Architecture Reviews отдельным review-pass;
    исправления
    вернуть через developer rework при необходимости.
11. [x] После ACCEPT обновить только affected current-state Wiki и повторно
    проверить соответствие ADR.
12. [ ] Подготовить Conventional Commit и отдельно запросить Git staging,
    commit и push.
13. [ ] Отдельно запросить staging deployment; после cutover провести
    credential-free read-only verification и отдельно согласованный OAuth
    reconnect/E2E.

## Критерии приёмки

1. `current - desired` scopes вычисляются под существующим client lock.
2. Grants с retired scope, их session authorizations и refresh credentials
   отозваны до удаления allowlist row.
3. Interactions и authorization codes старого contract больше нельзя
   продолжить или обменять.
4. Account, Identity browser session, security events, product data,
   unaffected clients/grants/scopes сохранены.
5. Ошибка в любой точке откатывает всю reconciliation transaction.
6. Повторный и concurrent запуск корректны и не создают metadata churn.
7. Release запрещает automatic rollback на предыдущий Identity image через
   `identity_oauth_clients_backward_compatible: false`.
8. Никакие credentials, tokens, redirect URI или персональные данные не
   попадают в command output, logs, docs или tests.
9. После отдельно утверждённого deployment публичный MCP catalog соответствует
   TASK-0079, а новый OAuth connection выдаётся только по актуальному contract.

## Проверка

- Focused `OAuthClientStore` unit/integration tests.
- Identity full unit/integration, typecheck и build.
- Deployment workflow/contract tests и rollback compatibility assertions.
- Static PostgreSQL identifier length validation.
- `node scripts/validate-docs.mjs` и `git diff --check`.
- Independent Quality и Architecture Reviews.
- Отдельно утверждённые staging release и read-only public probes.
