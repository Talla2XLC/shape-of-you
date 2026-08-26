# TASK-0060 — Инвалидация OAuth-артефактов при ротации callback

## Статус и разрешение

- Статус: completed.
- Оператор утвердил рекомендуемую архитектуру командой `го` 2026-08-27.
- Разрешены ADR, implementation, tests, independent Quality, affected Wiki и
  повторный staging deployment в ранее утверждённом scope.
- Git staging, commit и push требуют отдельных release gates.
- Product data, Google Sheets, production и MCP write tools не затрагиваются.

## Цель

Разрешить безопасную exact-ротацию OAuth callback, удаляя только одноразовые
protocol artifacts старого URI и сохраняя durable authorization state.

## Реализация

1. [x] Диагностировать staging failure и подтвердить FK boundary.
2. [x] Сравнить варианты и получить architecture approval.
3. [x] Зафиксировать accepted ADR и implementation plan.
4. [x] Добавить атомарное scoped retirement в `OAuthClientStore`.
5. [x] Добавить integration evidence для удаления transient и сохранения
   durable state, idempotency и rollback.
6. [x] Пройти Identity, docs и deployment validation.
7. [x] Пройти independent Quality и Architecture Review.
8. [x] Обновить affected current-state Wiki.
9. [x] Подготовить release plan и пройти отдельные commit/push gates.
10. [x] Повторить staging deployment и no-write OAuth/catalog verification.

## Критерии приёмки

1. Новый callback добавляется до retirement старого внутри одной transaction.
2. Удаляются только codes/interactions и их child rows старого callback.
3. Grants, sessions, refresh families/tokens, security events, scopes и Person
   authorization сохраняются.
4. Любая последующая reconciliation error откатывает retirement.
5. Exact repeat остаётся без записей и `updated_at` churn.
6. Staging reconciliation и deployment завершаются успешно.
7. Новый ChatGPT connection проходит OAuth и видит 23 tools без write calls.

## Проверка

- Focused OAuth client integration tests.
- Full Identity unit/integration, typecheck и build.
- Deployment contracts.
- `node scripts/validate-docs.mjs`, `git diff --check`, board validation.
- Staging GitHub Actions release and public health checks.
- Interactive OAuth consent и read-only tool catalog verification.
