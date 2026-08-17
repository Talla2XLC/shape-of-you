# TASK-0041 — Возврат на защищённый Web route после OAuth

## Статус и граница разрешения

- Статус: completed 2026-08-17; commit, push и deployment остаются отдельными
  explicit gates.
- Архитектура:
  [`docs/adr/20260817-preserve-same-origin-browser-return-routes-through-oauth.md`](../../../../docs/adr/20260817-preserve-same-origin-browser-return-routes-through-oauth.md).
- ADR и этот план утверждены оператором 2026-08-17.
- TASK-0040 выпущен отдельным commit `fd31076`; его OAuth/Person-mapping
  baseline не входит в diff этой задачи.

## Исходный запрос

1. После успешного OAuth переходить на `/day`, а не `/`.
2. Безопасно сохранять исходный защищённый маршрут и возвращать пользователя.
3. На главной при активной API-сессии показывать **Open my day**, а не повторный
   sign-in.
4. При прямом открытии защищённой страницы без сессии начинать вход и возвращать
   на исходный route.
5. Исправить responsive layout `/day`: heading, отступы и пустые области cards.
6. Добавить E2E успешного входа, повторного посещения главной и protected-route
   return.

## Цель

Сделать browser authentication непрерывной частью Web navigation: default
после входа — дневной экран, активная сессия видна только как безопасный
boolean state, а protected routes автоматически восстанавливаются после OAuth
без open redirect, browser storage и доступа к HttpOnly cookie.

## Утверждаемая архитектура

### Return route

- `/api/browser-auth/sign-in` принимает optional `returnTo`.
- Разрешён только same-origin absolute path reference: `/path` и optional
  query; scheme, host, `//`, backslash, fragment, control characters и
  oversized values запрещены.
- Default и любой fail-safe fallback — `/day`.
- Валидированный route хранится только в подписанной short-lived HttpOnly OAuth
  transaction cookie вместе со state/PKCE verifier.
- Callback использует только verified cookie claim и игнорирует любой target
  из callback query.
- Fragment не передаётся и не восстанавливается.

### Session presence

- API публикует `GET /browser-auth/session`.
- Valid HttpOnly API session: `204 No Content`.
- Missing/expired/invalid session: `401 Unauthorized`.
- Всегда `Cache-Control: no-store`; endpoint не возвращает Person, subject,
  roles, expiry, cookie или token и не продлевает session.
- Проверка использует тот же verifier, что protected API routes.

### Web behavior

- Один typed browser-auth adapter инкапсулирует session probe и построение
  sign-in URL.
- Reusable client route middleware применяется к `/day` и будущим страницам с
  opt-in metadata.
- Без сессии middleware выполняет top-level navigation на sign-in с текущими
  path+query; browser storage не используется.
- На `/` pending state не показывает ложный auth CTA. После `204` primary CTA —
  **Open my day**; после `401` — текущий passkey sign-in.
- `401` от защищённого domain read повторно запускает тот же безопасный flow,
  сохраняя current path+query.

### Responsive `/day`

- Heading использует bounded responsive size (`clamp`) и не вытесняет controls
  на узком viewport.
- Vertical rhythm сокращается на phone/tablet widths.
- Cards не имеют искусственной высоты/min-height, создающей пустые области.
- Date, status, actions и history остаются читаемыми без horizontal overflow.

## Scope

### Входит

1. Принятие ADR и точных return-route invariants.
2. API transaction claim, validator, default `/day` и callback redirect.
3. Credential-free session-presence endpoint `204/401` с `no-store`.
4. Web browser-auth adapter и reusable protected-route middleware.
5. Landing CTA states: pending, **Open my day**, passkey sign-in.
6. `/day` automatic sign-in/return и обработка expired session.
7. Responsive `/day` CSS/layout correction.
8. API unit tests, Web unit/component tests и disposable real-browser OAuth E2E.
9. Post-quality alignment только затронутых Wiki/changelog страниц.

### Не входит

- Изменение Identity OAuth provider, passkey flow или Person mapping.
- Новый OAuth client, scope, token, refresh behavior или cookie format.
- Серверное session persistence, refresh, revocation propagation или sliding
  expiration.
- SSR/Nitro runtime, новый deployable, database, migration или secret.
- Account profile API или раскрытие session/Person/role details в Web.
- Сохранение URL fragments.
- Новый дизайн landing/day за пределами перечисленных navigation и responsive
  corrections.
- Commit, push, deployment и staging operations без отдельных gates.

## Затрагиваемые области

| Область | Изменение |
|---|---|
| `apps/api/src/browser-auth/` | Return-route validation, signed transaction claim, default redirect, session probe |
| API tests | Redirect/security/session-presence matrix |
| `apps/web/app/` | Browser-auth adapter, route middleware, landing CTA, protected `/day`, responsive CSS |
| Web tests | Auth states, guard, route restoration, responsive viewport checks |
| Full browser E2E | Real OAuth default/landing revisit/protected return |
| ADR/Wiki/changelog | Только подтверждённый current-state contract после Quality |

## Security invariants

1. Redirect target никогда не берётся напрямую из callback query.
2. Target не может содержать origin, scheme, authority, fragment, backslash,
   control character или превышать установленный limit.
3. `returnTo` защищён той же signature/TTL, что state и PKCE verifier.
4. Invalid/legacy/expired return state fail-safe ведёт только на `/day`.
5. Session endpoint возвращает только boolean-equivalent `204/401` и `no-store`.
6. Web не читает HttpOnly cookie и не хранит auth/return state в
   `localStorage`, `sessionStorage` или IndexedDB.
7. Route middleware передаёт только `pathname + search`, без hash.
8. Existing CSRF/Origin checks и MCP bearer boundary не меняются.

## Выполненные этапы

1. [x] Перевести ADR TASK-0041 в `accepted` и зафиксировать approval в timeline.
2. [x] Реализовать pure return-route validator и API unit matrix.
3. [x] Расширить signed transaction claim и callback default/restore behavior.
4. [x] Добавить credential-free session-presence endpoint и tests.
5. [x] Добавить Web browser-auth adapter и protected-route middleware.
6. [x] Обновить landing CTA и `/day` 401 recovery.
7. [x] Исправить responsive `/day` и viewport assertions.
8. [x] Расширить disposable real-browser OAuth E2E тремя сценариями.
9. [x] Прогнать service/monorepo/Docker/docs gates.
10. [x] Провести независимый Quality Review и Architecture Review.
11. [x] После accepted quality отдельно запросить и выполнить Wiki alignment;
    commit, push и deploy остаются отдельными
    approvals.

## Критерии приёмки

1. Sign-in без `returnTo` после успешного callback открывает `/day`.
2. Direct `/day?date=...` без сессии запускает OAuth и после успеха возвращает
   exact path+query.
3. External/protocol-relative/backslash/fragment/control/oversized targets
   никогда не используются и заканчиваются безопасным `/day`.
4. Подмена callback query или OAuth state без valid transaction cookie не
   меняет redirect target.
5. Session probe возвращает только `204/401`, не кэшируется и не раскрывает
   identity/authorization state.
6. Главная при active session показывает **Open my day** и не предлагает
   повторный sign-in; без session показывает passkey sign-in.
7. Protected route guard reusable и не использует browser storage.
8. Expired session на `/day` запускает тот же return flow без redirect loop.
9. `/day` не имеет horizontal overflow на 320/375 px; heading/actions/cards
   сохраняют читаемый rhythm на phone, tablet и desktop.
10. Cards не создают пустую высоту, не обусловленную содержимым.
11. Disposable E2E покрывает успешный default login, повторный заход на `/` и
    возврат на исходный protected path+query.
12. Нет schema/migration/deployable/secret/Identity/MCP/Person-mapping changes.

## План проверки

- API unit: validator table, signed claim, default/legacy fallback, callback
  tampering, session `204/401/no-store`.
- Web unit/component: landing pending/active/inactive; URL builder; middleware
  success/401/expired behavior; no storage calls.
- Web viewport E2E: 320x720, 768x1024, 1440x900; overflow, heading bounds,
  spacing and card-content bounds.
- Full disposable auth E2E: passkey + OAuth + callback `/day`; authenticated
  landing revisit; unauthenticated protected query return.
- Existing API OAuth/CSRF, Identity OAuth, Web unit/Playwright and edge tests.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`.
- `pnpm test:e2e`, full browser auth E2E and staging deployment contracts.
- `node scripts/validate-docs.mjs`, `git diff --check` and exact scope review.

## Architecture Review checklist

1. Complexity: один signed claim и boolean probe вместо client token/session
   store.
2. Deployables: static Nuxt + existing API; SSR/BFF не добавляется.
3. DDD: API владеет browser authority, Web только отображает/navigation.
4. Duplication: reusable guard/adapter, без per-page auth policy.
5. Simplification: path+query only и default `/day` уменьшают redirect surface
   без потери заявленного UX.

## Результат

- Independent Quality принял все 12 критериев без P0/P1/P2.
- API unit: 58/58; Web unit: 13/13; static Playwright: 13/13; disposable full
  OAuth/WebAuthn E2E: 1/1.
- Полные monorepo tests, lint, typecheck, build, общий disposable API+Identity
  E2E, canonical docs validation и `git diff --check` прошли.
- Schema, migration, Identity, MCP, Person mapping, deployable, dependency,
  secret, commit, push и deployment changes отсутствуют.
