# TASK-0034 — Первый минимальный Nuxt frontend

## Статус и граница разрешения

- Статус: implementation и независимый quality review завершены 2026-08-07.
- Текущий этап: completed; commit, push и deployment требуют отдельных
  разрешений.
- ChatGPT client provisioning, deployment и любые операции с секретами не
  входят в эту задачу.

## Исходный запрос

Подготовить первый минимальный браузерный релиз Shape of You, после которого
можно продолжить подключение ChatGPT MCP/OAuth. Сохранить существующие Identity,
API и staging ingress boundaries; не начинать implementation до утверждения
архитектуры и плана.

## Цель

Добавить статический Nuxt 4 client, который даёт пользователю landing,
первичную регистрацию passkey, passkey sign-in и минимальное управление
passkeys/sessions через уже реализованные Identity API, не создавая новый
backend или deployable runtime.

## Утверждаемая архитектура

- Канонический ADR:
  [`docs/adr/20260807-serve-static-nuxt-client-through-existing-edge.md`](../../../../docs/adr/20260807-serve-static-nuxt-client-through-existing-edge.md).
- `apps/web` — build-time Nuxt client package без БД, credentials, migrations,
  Nitro runtime/API и доменной логики.
- Существующий edge image содержит immutable static output и остаётся
  единственным владельцем доставки web assets.
- `staging.shape-of-you.ru` отдаёт Nuxt по умолчанию и сохраняет `/api/` и MCP
  metadata за API.
- `identity.staging.shape-of-you.ru` отдаёт Nuxt по умолчанию, но сохраняет
  `/.well-known/`, `/oauth/`, `/v1/` и действующие probes за Identity/edge.
- Enrollment, sign-in и security UI работают на exact Identity origin и
  используют относительные Identity API URLs без CORS.
- Bootstrap enrollment token передаётся только как `#token`, немедленно
  удаляется из адресной строки, хранится только в памяти текущей вкладки и
  используется только в Bearer header существующего WebAuthn API.

## Scope

### Входит

1. Nuxt application shell и минимальный визуальный foundation без отдельной
   design-system инициативы.
2. Landing page с понятным переходом на Identity origin.
3. `/enroll` для first-passkey flow по текущим
   `/v1/webauthn/registration/*` endpoints.
4. `/sign-in` для discoverable passkey flow по текущим
   `/v1/webauthn/authentication/*` endpoints.
5. Минимальная authenticated security page:
   - список, добавление, переименование и отзыв passkeys;
   - список и отзыв browser/OAuth sessions;
   - обозначение текущего passkey/session и безопасная обработка self-revoke.
6. Чтение текущего non-HttpOnly CSRF cookie и отправка `X-CSRF-Token` только
   для cookie-authenticated mutations.
7. Static build внутри edge image, nginx routing/fallback и необходимые
   deployment/Compose/smoke contract updates.
8. Unit/component/browser/edge-contract tests, accessibility baseline,
   документационное выравнивание и независимый quality review.

### Не входит

- UI для fitness-domain данных, Intake или Google Sheets.
- TOTP setup, TOTP recovery и recovery-code UI.
- ChatGPT client provisioning, CIMD/DCR, внешний OAuth/MCP smoke или consent
  redesign.
- Public sign-up, password/email/SMS authentication или административный HTTP
  API.
- Изменение Identity endpoint contracts, cookie attributes, CSRF model,
  WebAuthn RP ID/origin, OAuth issuer или resource audience.
- SSR, server routes, Nitro runtime, отдельный frontend container, CDN или
  object storage.
- Новая БД, migrations, credentials, secrets или production deployment.

## Затронутые области

| Область | Ожидаемое изменение |
|---|---|
| `apps/web/` | Новый Nuxt package, `AGENTS.md`, страницы, client-only API/WebAuthn adapters, стили и тесты |
| `package.json`, `pnpm-lock.yaml` | Workspace scripts и точно закреплённые совместимые frontend dependencies |
| `deploy/staging/nginx/` | Multi-stage edge build, static root, host-specific reserved routes, SPA/static fallback и security headers |
| `deploy/staging/scripts/tests/` | Контракты static artifact и reserved-path routing |
| `.github/workflows/_quality.yml` | Frontend/browser проверки, если они не покрываются root scripts автоматически |
| `.github/workflows/publish-staging.yml` | Root build context для edge image без нового image coordinate |
| `scripts/run-e2e.mjs` и local Compose | Только необходимые изменения для воспроизводимого browser flow; отдельный web runtime не добавляется |
| `docs/wiki/architecture/` | После утверждения ADR — только затронутые current-state страницы о runtime, deployment и Identity UI boundary |
| `docs/wiki/product/`, `docs/wiki/changelog.md` | Отразить принятый первый browser scope и результат после accepted quality |

## Technical impact checklist

| Область | Impact | Комментарий |
|---|---|---|
| Affected files/modules | yes | Новый `apps/web`, edge build/routing, CI и тесты |
| Data model | no | Новых таблиц, полей и migrations нет |
| API/contracts | no | Используются текущие Identity endpoints без изменения wire contract |
| Deployment topology | yes | Edge image получает static artifact; нового runtime/deployable нет |
| Backward compatibility | yes | API, MCP metadata, Identity protocol paths и probes обязаны сохранить поведение |
| Security | yes | Fragment bearer, exact Origin, WebAuthn, cookies и CSRF являются обязательными invariants |
| Secrets | no | Frontend получает только public config; secret reads/writes запрещены |
| Test surface | yes | UI states, WebAuthn bridge, routing, static build и deployment contracts |
| Rollback | yes | Откат к предыдущему edge digest убирает frontend без database rollback |
| Documentation | yes | Proposed ADR сейчас; current-state Wiki только после явного принятия решения |

## Требования к реализации

1. Создать `apps/web/AGENTS.md` на английском с явным запретом backend/domain
   logic, secrets, server routes и direct imports из deployable services.
2. Настроить Nuxt 4 на статический client output. Production artifact не
   должен требовать Node process или writable filesystem.
3. Изолировать browser integrations за малыми typed adapters:
   - same-origin Identity HTTP client;
   - WebAuthn ceremony adapter;
   - CSRF cookie reader;
   - canonical Identity-origin navigation.
4. Не копировать Identity domain/security policy во frontend. UI отображает
   серверные состояния и generic safe errors; backend остаётся authority.
5. На `/enroll` принять только один token формата текущего opaque bearer,
   вызвать `history.replaceState` до первого network request, не сохранять
   значение и очистить in-memory reference после success/failure/cancel.
6. Не включать enrollment token, CSRF token, WebAuthn challenge/response,
   cookies или OAuth state в URL, telemetry, console, error objects, fixtures,
   screenshots и rendered messages.
7. `/sign-in` должен обрабатывать success, unsupported browser/insecure
   context, user cancellation, invalid/expired challenge и server denial без
   раскрытия внутренних деталей.
8. Security page должна сначала безопасно определить authenticated state через
   текущие list endpoints. `401/403` переводят пользователя к sign-in; mutation
   повторно загружает server-owned state.
9. Любая cookie-authenticated mutation отправляет exact CSRF cookie value в
   `X-CSRF-Token`. Enrollment bearer flow не подмешивает ambient CSRF authority.
10. Nginx reserved locations должны иметь приоритет над static fallback.
    `/.well-known/`, `/oauth/`, `/v1/`, `/api/`, probes и ACME нельзя вернуть
    как Nuxt HTML при upstream error или неизвестном backend route.
11. Edge runtime остаётся unprivileged/read-only. Static assets получают
    корректные MIME types, deterministic cache policy, no-sniff/referrer/frame
    protections и проверенный CSP без сторонних origins.
12. Оба deployment topology render должны использовать один и тот же edge
    artifact и routing template. Release protocol не получает новый image
    coordinate.
13. Не изменять `apps/api` и Identity persistence/domain behavior, если quality
    не обнаружит отдельный blocker и оператор не утвердит расширение scope.

## Этапы

1. [x] Получить явное утверждение proposed ADR и этого плана; сменить ADR на
   `accepted` и синхронизировать только затронутые proposed/current-state Wiki
   формулировки до исходного кода.
2. [x] Создать границу `apps/web`, закрепить Nuxt и совместимые browser/test
   dependencies, добавить root scripts и package-level quality commands.
3. [x] Реализовать application shell, public runtime config, host guard и
   landing page.
4. [x] Реализовать безопасный fragment-only `/enroll` flow и его негативные
   состояния.
5. [x] Реализовать `/sign-in` и переход в authenticated security surface.
6. [x] Реализовать passkey/session management без TOTP/recovery UI.
7. [x] Встроить static output в edge image и настроить host/path partition без
   изменения Identity origin и API/MCP routes.
8. [x] Добавить unit/component/browser tests, edge routing/static artifact
   contracts и обновить local/staging smoke только в рамках задачи.
9. [x] Прогнать полный validation plan и устранить дефекты.
10. [x] Провести независимый quality review и Architecture Review.
11. [x] После accepted quality обновить changelog и фактические current-state
    Wiki формулировки; не выполнять commit/deploy/provisioning без отдельных
    разрешений.

## Критерии приёмки

1. Production build создаёт статический Nuxt artifact; в Compose нет web/Nitro
   service и на VM не запускается новый Node frontend process.
2. `https://staging.shape-of-you.ru/` отдаёт landing, а `/api/` и
   `/.well-known/oauth-protected-resource` сохраняют текущие API contracts.
3. Identity host отдаёт Nuxt client routes, но Identity metadata, OAuth, `/v1/`
   и probes не перехватываются static fallback.
4. `/enroll#<token>` удаляет fragment до первого fetch, не сохраняет token и
   успешно регистрирует first passkey через Bearer authority. Missing,
   malformed, expired, replayed и rejected tokens имеют безопасные состояния.
5. `/sign-in` завершает discoverable-passkey ceremony, получает существующие
   host-only cookies и открывает security UI без доступа JavaScript к session
   credential.
6. Пользователь может list/add/rename/revoke passkeys и list/revoke sessions в
   пределах текущих Identity rules; запрещённые операции показывают безопасную
   ошибку и не оптимистично подменяют server state.
7. Cookie-authenticated mutations без верного `X-CSRF-Token` не проходят, а
   frontend всегда использует exact Identity origin без CORS.
8. Нет UI или route для fitness data, TOTP/recovery и ChatGPT provisioning.
9. Generated assets, logs, URLs, storage и test artifacts не содержат bearer,
   CSRF, cookie или WebAuthn secrets.
10. Edge image остаётся unprivileged/read-only; оба staging topology contracts,
    rollback contract и existing API/Identity smoke проходят.
11. Keyboard navigation, visible focus, semantic labels, status announcements,
    reduced-motion preference и responsive layout проходят agreed browser
    checks.
12. Canonical ADR/Wiki/plan не дублируют authority: ADR хранит решение, Wiki —
    краткое текущее состояние, план — execution scope.

## План проверки

- `pnpm lint` — lint всех workspace packages.
- `pnpm typecheck` — contracts/config и все package typechecks.
- `pnpm build` — API, Identity и статический web/edge build contract.
- `pnpm test` — package unit/integration/component tests.
- `pnpm test:e2e` — существующий disposable local API/Identity stack.
- `pnpm test:e2e:web` — статическая сборка и Playwright browser flow.
- Browser tests — fragment removal/non-persistence, WebAuthn adapter states,
  CSRF header, auth redirects, passkey/session mutations и accessibility smoke.
- Edge contract tests — main/Identity host routing, reserved-path precedence,
  static fallback, cache/security headers и отсутствие нового service.
- `docker compose ... config --quiet` для `shared-ingress` и `standalone` с
  Identity overlay и безопасными fixture values.
- `sh deploy/staging/scripts/tests/rollback-readiness.sh`.
- `sh deploy/staging/scripts/tests/write-smoke-contract.sh`.
- `sh deploy/staging/scripts/tests/tls-automation-contract.sh`.
- `sh deploy/staging/scripts/tests/identity-deployment-contract.sh`.
- `sh deploy/staging/scripts/tests/deployment-bootstrap-contract.sh`.
- `sh deploy/staging/scripts/tests/frontend-edge-contract.sh`.
- `sh deploy/staging/scripts/tests/frontend-edge-runtime.sh`.
- `node scripts/validate-docs.mjs` до handoff, quality и завершения.
- Manual staging browser smoke требует отдельного deployment approval и не
  входит в автоматическое разрешение на implementation.

## Architecture Review

1. Лишняя сложность: новый runtime, CDN и BFF не добавляются; build-time Nuxt
   и existing edge достаточны.
2. Premature services: `apps/web` не является deployable service и не получает
   БД, credentials или независимый release lifecycle.
3. DDD: domain/application authority остаётся в API и Identity; client только
   оркестрирует browser ceremonies и отображает server state.
4. Дублирование: ADR содержит долговечное решение; Wiki после утверждения
   содержит краткое текущее состояние; этот план содержит только scope и шаги.
5. Упрощение: same-origin Identity UI устраняет CORS и не меняет cookie/RP/CSRF
   contracts. Дальнейшее объединение origins было бы не упрощением, а
   security/protocol migration.

## Результат проверки

- `pnpm lint`, `pnpm typecheck`, `pnpm build`, frontend unit tests, девять
  Playwright E2E, local API/Identity E2E, deployment contracts, edge runtime
  E2E и canonical documentation validation прошли.
- Production static build и nginx syntax проверены в Node 24 edge image;
  локальный host Node 22 остаётся ниже поддерживаемого диапазона проекта.
- Первый полный `pnpm test` прошёл. Два последующих полных повтора выявили
  существующую нестабильность двух Intake concurrency assertions при
  параллельном API suite; изолированный `intake.integration.test.ts` прошёл
  `5/5`. TASK-0034 не изменяет API/Intake, поэтому дефект оставлен отдельным
  residual risk, а не скрыт изменением чужой test/runtime boundary.
- Независимый quality review принят после устранения browser, edge runtime и
  documentation-status замечаний; functional, security и architecture
  blockers не осталось.

## Допущения и открытые вопросы

- Допущение: один static artifact может безопасно обслуживаться на обоих
  staging hosts, если identity-only routes hard-navigate к configured Identity
  origin и reserved paths имеют приоритет.
- Допущение: текущие Identity response shapes достаточны для минимального UI;
  wire contract не меняется.
- В implementation plan допускается выбрать конкретный совместимый browser
  WebAuthn/test package после проверки pinned Nuxt/Node compatibility, но это не
  разрешает смену архитектуры или endpoint contracts.
- Реализация подтвердила допущения; открытых архитектурных вопросов в границе
  TASK-0034 не осталось.

## Handoff

TASK-0034 прошёл developer validation, независимый quality review и
Architecture Review. Следующий продуктовый шаг — отдельно утверждённое
продолжение ChatGPT MCP/OAuth. Commit, push, deployment и ChatGPT provisioning
остаются отдельными approval gates.
