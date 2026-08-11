# TASK-0036 — Автоматическая сверка predefined OAuth clients при deployment

Статус: Quality принят; код и canonical docs готовы к release packaging.

Архитектурная основа: accepted ADR
[`docs/adr/20260811-reconcile-predefined-oauth-clients-during-deployment.md`](../../../docs/adr/20260811-reconcile-predefined-oauth-clients-during-deployment.md).

ADR и этот план утверждены оператором 2026-08-11. GitHub configuration,
staging database и OAuth clients остаются отдельными operational gates.

## Цель

Устранить drift между versioned Identity policy и persisted predefined OAuth
client: каждый успешный Identity deployment должен idempotently привести
reserved clients к manifest-состоянию и exact environment callback, не меняя
operator-created clients и не перенося provisioning в normal server startup.

## Выбранная граница

### Versioned Identity manifest

- Manifest внутри `apps/identity` содержит только reserved `client_id`, display
  name, `refreshTokensEnabled` и exact allowed scopes.
- Первый reserved ID — `shape-of-you-chatgpt-staging`.
- Его policy: public client, Authorization Code + S256 PKCE, refresh tokens,
  `openid`, `offline_access` и пять принятых MCP resource scopes.
- Redirect URI, hostname-specific credentials и environment values в manifest
  не входят.
- General `oauth-client:provision` отклоняет reserved IDs. Он остаётся для
  отдельно управляемых non-reserved clients.

### Environment callback

- Exact callback поступает из non-secret GitHub Environment variable
  `STAGING_IDENTITY_CHATGPT_REDIRECT_URI`.
- Restricted deployment wrapper передаёт его как
  `IDENTITY_CHATGPT_REDIRECT_URI` только в Identity operational environment.
- Допустим только credential-free HTTPS URL с origin `https://chatgpt.com` и
  path `/connector/oauth/<opaque-id>`; query и fragment запрещены.
- Callback не печатается в command output, logs, test reports или 4DT timeline.

### One-shot reconcile

- Новый Identity command `oauth-client:reconcile-predefined` загружает manifest
  и required callback, затем в Identity DB transactionally создаёт или exact
  reconciles только reserved clients.
- Результат на client: `created`, `updated` или `unchanged`; повторный запуск не
  меняет `updated_at`.
- Grants, sessions и authorization history не переписываются.
- Отсутствие client в manifest ничего не удаляет и не отключает.
- Output содержит только client ID и status, без callback, scopes, DB URL или
  credentials.

### Deployment и rollback

- В `compose.identity.yaml` появляется operations-only service для reconcile с
  тем же Identity image, отдельным process и доступом только к Identity DB.
- `deploy.sh` запускает его после `identity-migrate` и до `compose up identity`.
- Missing/invalid callback или reconcile failure останавливает deployment до
  замены runtime container.
- Release contract получает декларацию backward compatibility predefined
  OAuth client policy. Automatic rollback разрешён только при совместимости и
  schema, и client contract; иначе требуется operator-led recovery.
- Normal Identity startup, `/ready` и runtime replicas не выполняют reconcile.

## Scope

Входит:

- typed predefined-client manifest и validation;
- reserved client ID boundary в operator command;
- created/updated/unchanged repository reconciliation;
- one-shot command и credential-free formatter;
- Identity unit/integration tests;
- staging Compose operations service;
- deploy/controller/workflow/runtime-env/rollback contract changes и shell
  tests;
- accepted ADR, затронутые current-state Wiki/runbook/changelog после Quality.

Не входит:

- DCR, CIMD или public client-management API;
- новые OAuth tables/columns/migrations;
- автоматическое удаление/disable clients;
- управление grants, sessions, users, PersonAccessGrant или MCP tools;
- callback в Git repository;
- secrets, ChatGPT UI automation или чтение SSH config;
- production deployment или production callback policy.

## Этапы реализации после утверждения

1. Перевести ADR в `accepted`, отметить этот план одобренным и зафиксировать
   analytic handoff в TASK-0036.
2. Реализовать typed manifest, callback parser и reserved-ID guard с concise
   English TSDoc/JSDoc.
3. Расширить `OAuthClientStore` exact comparison/reconciliation так, чтобы
   unchanged run не обновлял timestamps; добавить one-shot command и output.
4. Добавить Identity unit/integration coverage для create/update/unchanged,
   grants preservation, concurrent repeat, invalid callback и non-reserved
   isolation.
5. Добавить Compose operations service и post-migration/pre-replacement вызов.
6. Добавить non-secret GitHub variable handoff, strict controller validation,
   release compatibility field и rollback tests без вывода callback.
7. Прогнать Identity и monorepo lint/typecheck/build/tests, deployment shell
   contracts, local API+Identity E2E, docs validation, identifier check и
   `git diff --check`.
8. Провести независимый Quality и Architecture Review. Только после acceptance
   обновить Wiki/runbook/changelog и запросить отдельный commit/push approval.
9. До первого auto-reconcile отдельно попросить оператора создать exact GitHub
   Environment variable. Первый staging deployment и проверка persisted client
   остаются отдельным DevOps gate.

## Критерии приёмки

1. Versioned manifest — единственный source of truth для policy reserved client;
   environment variable — единственный source of truth для exact callback.
2. General provisioning не может изменить reserved client, но сохраняет
   поведение для non-reserved clients.
3. Reconcile создаёт missing client, исправляет drift и даёт настоящий no-op
   для exact state без timestamp churn.
4. Reconcile никогда не удаляет client по отсутствию в manifest и не меняет
   grants/sessions/history.
5. Missing/invalid callback fail-closed останавливает deployment до Identity
   replacement; sensitive и full callback values не выводятся.
6. Deploy ordering закреплён как migration → reconcile → runtime replacement.
7. Automatic rollback запрещён при incompatible schema или predefined-client
   contract; compatible rollback не реконструирует external callback.
8. Operations service не имеет published ports, отдельного deployable image,
   cross-service SQL или доступа к API DB.
9. Повторные/concurrent reconcile безопасны и сходятся к одному exact state.
10. Canonical docs, tests и PostgreSQL identifier limits проходят; staging и
    GitHub mutations отсутствуют до отдельных approvals.

## Риски и меры

- **Неверный callback блокирует release:** strict preflight и environment-level
  variable делают ошибку видимой до runtime replacement.
- **Deploy перезапишет ручной client:** reserved namespace и CLI guard исключают
  competing ownership; non-reserved IDs не читаются и не изменяются.
- **Rollback несовместим с новым scope contract:** compatibility declaration
  отключает automatic rollback и требует осознанного recovery.
- **Каждый deploy создаёт ложный audit/update:** exact comparison возвращает
  `unchanged` и сохраняет `updated_at`.
- **Manifest removal станет destructive:** отсутствие никогда не означает
  delete/disable; retirement проектируется отдельно.

## Architecture Review до реализации

1. Отдельный service/deployable не создаётся: one-shot использует Identity
   image и Identity DB как operations process.
2. DDD и ownership сохраняются: Identity владеет OAuth client lifecycle;
   deployment только применяет versioned Identity policy.
3. Manifest не дублирует callback, а environment не дублирует scopes; источники
   истины разделены по типу authority.
4. Решение проще startup reconciliation, DCR/CIMD и новой ownership column, но
   сохраняет масштабирование runtime replicas без startup writes.
5. Deployment/rollback complexity ограничена существующим migration-style
   operations pipeline и явным compatibility gate.

## Developer evidence

- Реализованы typed manifest, strict callback parser, reserved-ID guard и
  credential-free one-shot command.
- `OAuthClientStore` сериализует exact reconcile по client ID; create, drift
  update, no-op без timestamp churn, concurrent create/repeat и сохранение
  grant history закреплены integration test.
- Deployment выполняет Identity migration, затем one-shot reconcile и только
  после успеха заменяет runtime; automatic rollback требует schema и client
  compatibility текущего release.
- Пройдены monorepo lint, typecheck, build и tests: Identity 59/59, API 80/80,
  web 9/9; полный Identity integration 25/25; staging shell contracts и local
  API+Identity Docker E2E.
- Canonical docs validation: 52 Wiki, 42 ADR, 94 unique IDs; docs tests 3/3 и
  `git diff --check` прошли.
- GitHub variables, staging state, commit и push не изменялись.

## Итоговый Architecture Review

1. Лишней сложности нет: один typed manifest и один one-shot operations process
   используют существующие Identity image, DB и deployment pipeline.
2. Новый deployable, database или service boundary не создан; Compose service
   является краткоживущим Identity process без port exposure.
3. DDD и ownership сохранены: Identity владеет OAuth clients и persistence,
   API database не читается, runtime startup остаётся без reconciliation writes.
4. Источники истины не дублируются: manifest владеет policy, Environment —
   callback, ADR — решением, Wiki — текущим состоянием, этот план — исполнением.
5. Startup reconciliation, DCR/CIMD и новая ownership column сложнее без
   требуемой пользы; выбранный вариант сохраняет horizontal scalability и
   fail-closed deployment.

Независимый Quality re-review принят без P0/P1/P2. GitHub Environment variable,
commit, push и первый staging reconciliation остаются отдельными approvals.
