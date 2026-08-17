# TASK-0040 — Аутентифицированный дневной экран и lifecycle закрытия

## Статус и граница разрешения

- Статус: approved for implementation 2026-08-12.
- Архитектура: [`docs/adr/20260812-use-api-owned-browser-session-cookies.md`](../../../docs/adr/20260812-use-api-owned-browser-session-cookies.md).
- Разрешены изменения API, Identity и Web, нужные для browser OAuth-code
  exchange, API-owned cookie/CSRF и минимального DayClosure UI. Commit, push,
  migration execution и deployment требуют отдельных разрешений.

## Цель

Дать вошедшему пользователю безопасный browser UI для просмотра дневной
projection, явного закрытия дня, видимого `stale` и reopen с причиной.

## Архитектура

1. API начинает top-level OAuth Authorization Code + S256 PKCE flow.
2. Identity остаётся единственным владельцем passkey/OAuth session.
3. API callback обменивает code, валидирует OIDC token и локально разрешает
   ровно одного Person.
4. API выдаёт свои short-lived `__Host-` session и CSRF cookies; Web не хранит
   bearer/refresh token.
5. Web ходит только relative `/api/...`; browser writes передают CSRF header и
   требуют явного подтверждения close/reopen.

## Scope

### Входит

- Predefined Identity public OAuth client с точным callback API/Web origin.
- API browser auth endpoints, signed session/CSRF cookies и fail-closed Origin
  checks.
- Минимальный Web adapter и дневной экран: дата, timezone, projection,
  status, close confirmation, stale notice, reopen reason, history.
- Контрактные, unit, integration и browser E2E тесты.
- Только затронутые ADR/Wiki/current-state documentation.

### Не входит

- Общая parent-domain cookie, хранение bearer/refresh tokens в browser,
  localStorage/sessionStorage credentials.
- Новый SSR/BFF сервис, database, migration, event bus или cross-service SQL.
- Автоматический refresh API session, мгновенный cross-service revocation,
  расширенная account/session management UI.
- Любые новые domain facts, day auto-close, notifications или LLM flows.

## Критерии приёмки

1. API принимает browser access только через свою host-only session cookie;
   Identity cookie не шарится и MCP bearer contract не меняется.
2. OAuth callback fail-closed при неверном/просроченном state, PKCE, issuer,
   audience, subject или Person mapping.
3. Все browser writes требуют same-origin `Origin` и session-bound CSRF.
4. Web не хранит и не отображает credentials; API requests same-origin.
5. Вошедший пользователь видит daily projection и все states API (`open`,
   `closed`, `stale`).
6. Close требует явного confirmation, idempotency key и безопасно отображает
   result/conflict.
7. Reopen требует непустую причину; history показывает версии.
8. Нет нового deployable/database/migration и нет ослабления cookie isolation.

## Проверки

1. Typecheck/lint/unit/integration для API, Identity и Web.
2. Identity OAuth reconciliation и API auth/CSRF tests.
3. Disposable browser E2E full flow.
4. `node scripts/validate-docs.mjs`, PostgreSQL identifier check (если schema
   не меняется — миграции отсутствуют), generated static artifact check.

## Корректирующий проход после staging-проверки

- 2026-08-17: реальный Web OAuth consent выявил, что строгий Identity adapter
  ошибочно требовал непустые resource scopes даже для OIDC-only клиента.
- Исправление сохраняет минимальные права Web-клиента: только `openid`, без
  `person:read`, refresh token или другого API-разрешения.
- Точный integration flow проверяет consent, authorization code, ID token и
  отсутствие resource scopes; неожиданные ошибки Identity логируются только
  обезличенным маршрутом, типом/SQLSTATE и fingerprint без credentials.
