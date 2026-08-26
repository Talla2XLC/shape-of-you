# TASK-0058 — Стабильный OAuth callback платформы коннекторов ChatGPT

## Статус и разрешение

- Статус: completed.
- Оператор подтвердил рекомендуемое решение и staging deployment командой
  `го` 2026-08-27 после явного предложения выполнить изменение и deployment.
- Разрешены ADR, план, реализация, tests, independent Quality, affected Wiki и
  staging deployment.
- Git staging, commit и push выполняются только после отдельного release plan
  gate согласно workspace policy.
- Google Sheets, product data, migrations, production и write tools не
  затрагиваются.

## Цель

Восстановить OAuth-подключение нового ChatGPT MCP connector к staging через
стабильный callback `https://chatgpt.com/connector_platform_oauth_redirect`,
сохранив строгий predefined-client и scope contract.

## Входит

1. Новый accepted ADR для callback contract.
2. Exact callback validation в Identity.
3. Deployment controller, workflow и example contract.
4. Unit/deployment tests и документационная валидация.
5. Independent Quality и Architecture Review.
6. Staging deployment и read-only OAuth/MCP verification после release gates.

## Не входит

- Dynamic Client Registration, CIMD или client secret.
- Одновременная поддержка legacy opaque callback.
- Новые OAuth scopes или изменение Person authorization.
- Database migration, Google Sheets read/write, MCP write canary или cutover.
- Production deployment, tag или GitHub Release.

## Реализация

1. [x] Подтвердить failure по точному authorization request и discovery.
2. [x] Сравнить варианты и получить operator approval.
3. [x] Зафиксировать ADR и implementation plan.
4. [x] Обновить Identity callback parser и unit tests.
5. [x] Обновить staging controller/workflow/example и contract tests.
6. [x] Пройти focused и repository validation.
7. [x] Пройти independent Quality и Architecture Review.
8. [x] Обновить affected current-state Wiki.
9. [x] Подготовить release plan, commit/push и staging deployment по gates.
10. [x] Проверить OAuth и deployed 23-tool catalog без write calls в отдельной
    post-release задаче, не смешивая live evidence с pre-release Quality gate.

## Критерии приёмки

1. Identity принимает только точный stable ChatGPT callback без query,
   fragment или credentials.
2. Legacy opaque callback и off-origin/malformed значения отклоняются.
3. Deployment controller и GitHub Actions используют тот же exact contract.
4. Predefined client сохраняет `token_endpoint_auth_method=none`, PKCE,
   approved scopes и rotating refresh tokens.
5. Relevant unit, deployment contract и docs checks проходят.
6. После staging deployment новый connection завершает OAuth без redirect
   mismatch и обнаруживает 23 MCP tools.
7. Ни один MCP write tool, Google Sheets write, migration или production action
   не выполняется.

## План проверки

- Identity predefined-client unit tests.
- Deployment bootstrap/controller contract tests.
- Identity lint, typecheck, build и relevant integration tests.
- `node scripts/validate-docs.mjs` и `git diff --check`.
- Public staging discovery и MCP `tools/list` без access token.
- OAuth authorization через новый ChatGPT connection; после consent — только
  catalog/read-only smoke.

## Architecture Review checklist

- Новых deployable boundaries, databases или services нет.
- Один exact callback заменяет legacy exact callback; redirect authority не
  расширяется.
- DCR и dual-callback compatibility не добавляются преждевременно.
- OAuth scope, refresh и Person authorization contracts не дублируются и не
  ослабляются.
- Wiki описывает current state и ссылается на ADR без копирования истории.
