# TASK-0035 — Подключение ChatGPT к staging MCP/OAuth

## Статус и граница разрешения

- Статус: pre-provisioning code gate завершён и принят независимым Quality
  review 2026-08-10; external provisioning ожидает отдельного approval.
- Разрешено этим этапом: исходный код, tests и локальные disposable database
  проверки в точной границе плана.
- Не разрешено до отдельного утверждения: staging provisioning, доступ к
  секретам, операции со staging databases, действия в ChatGPT, commit, push и
  deployment.
- 4DreamTeam board/memory tooling находится в состоянии `degraded_tooling`
  из-за read-only SQLite; план опирается на canonical ADR/Wiki, код и
  проверенные публичные endpoints без прямого чтения managed storage.

## Цель

Подключить один operator-owned ChatGPT plugin/MCP connection к публичному
staging endpoint Shape of You, завершить Authorization Code + S256 PKCE flow
через project-owned Identity и доказать, что восемь MCP tools работают только
в контексте явно связанного API User и активного PersonAccessGrant.

Первый результат является staging dogfood для одного оператора. Он не является
публичной публикацией plugin, production activation или доступом к реальным
данным пользователя.

## Архитектурная база

Новый ADR не требуется. Задача реализует уже принятые решения:

- [`docs/adr/20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md`](../../../docs/adr/20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md)
  — project-owned Identity, predefined ChatGPT public client, PKCE и API-owned
  Person authorization;
- [`docs/adr/20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md`](../../../docs/adr/20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)
  — typed OAuth client/grant/session state;
- [`docs/adr/20260730-separate-user-access-from-person-data-ownership.md`](../../../docs/adr/20260730-separate-user-access-from-person-data-ownership.md)
  — внешний subject не даёт Person-доступ без API User и active grant;
- [`docs/wiki/architecture/identity-and-external-tool-access.md`](../../../docs/wiki/architecture/identity-and-external-tool-access.md)
  — текущий OAuth/MCP contract и scope ownership.

Актуальная официальная документация OpenAI подтверждает поддержку predefined
OAuth clients, Authorization Code + S256 PKCE, exact callback вида
`https://chatgpt.com/connector/oauth/{callback_id}`, protected-resource
metadata и audience-bound `resource`:

- <https://developers.openai.com/plugins/build/auth>;
- <https://developers.openai.com/plugins/deploy/connect-chatgpt>.

## Подтверждённый публичный baseline

Read-only проверка 2026-08-10 подтвердила:

1. `GET https://staging.shape-of-you.ru/.well-known/oauth-protected-resource`
   возвращает `200`, exact resource
   `https://staging.shape-of-you.ru/api/mcp`, Identity authorization server и
   пять resource scopes.
2. `GET https://identity.staging.shape-of-you.ru/.well-known/oauth-authorization-server`
   возвращает `200`, exact issuer, authorization/token endpoints,
   `code_challenge_methods_supported: ["S256"]`,
   `token_endpoint_auth_methods_supported: ["none"]` и ожидаемые scopes.
3. MCP `initialize` и `tools/list` через
   `https://staging.shape-of-you.ru/api/mcp` работают по Streamable HTTP.
4. Advertised metadata содержит ровно восемь allowlisted tools с per-tool
   `oauth2` security schemes и утверждёнными scopes.

Проверка не использовала access token, credentials, staging database или
приватные данные.

## Выбранное решение

### OAuth client

Использовать существующую модель administrator-provisioned public client:

- стабильный staging `client_id`: `shape-of-you-chatgpt-staging`;
- `token_endpoint_auth_method`: `none`;
- Authorization Code + S256 PKCE;
- ровно один callback, скопированный из ChatGPT management page;
- protocol scope `openid` и resource scopes `person:read`, `weight:write`,
  `body-measurement:write`, `meal:write`, `workout:write`;
- rotating refresh tokens остаются включены по принятому Identity contract.

Callback нельзя угадывать, заменять legacy URI или получать из логов. Он
копируется оператором из текущего ChatGPT connection и передаётся в
Identity provisioning command как точное значение.

### API authorization principal

Добавить недостающий operator-only API command
`identity-access:provision`, который в одной транзакции и только в API database:

1. принимает exact Identity issuer и public subject;
2. создаёт active API User;
3. создаёт отдельного active `real` Person для контролируемых staging fixtures;
4. создаёт active `owner` PersonAccessGrant;
5. создаёт exact `(issuer, subject) -> User` binding;
6. при безопасном повторе возвращает `existing`, не создавая дубликаты;
7. при частичном, неоднозначном или конфликтующем состоянии завершается с
   ошибкой и ничего не исправляет автоматически.

Команда не принимает Person id от ChatGPT, не обращается к Identity database,
не использует cross-service SQL и не включает synthetic compatibility Person.
Существующий runtime по-прежнему разрешает MCP request только после обычной
проверки mapping и active grant.

### Identity subject

Public subject не является credential, но должен передаваться без прямого SQL.
Добавить Identity operator command `account:subject`, который принимает точный
`--account-id`, читает только Identity database и печатает только account id и
public subject. Не выводить passkeys, sessions, display name, cookies, tokens
или другие account records.

Новый bootstrap при необходимости продолжает показывать enrollment token
только в интерактивном TTY. Токен не попадает в чат, plan, shell history,
screenshots, CI или логи.

## Рассмотренные альтернативы

### CIMD

OpenAI рекомендует Client ID Metadata Documents для масштабируемых
интеграций. Сейчас CIMD потребовал бы новый Identity validation contract,
fetch/SSRF policy, metadata caching, `private_key_jwt` или отдельную public
client policy и новый security review. Для одного staging-оператора это лишняя
архитектурная и эксплуатационная сложность. Отложено до multi-client rollout.

### Dynamic Client Registration

DCR устраняет ручное создание client row, но открывает registration endpoint,
расширяет attack surface и создаёт отдельный client на каждое connection.
Принятый ADR явно откладывает DCR. Для первого dogfood не используется.

### Ручной SQL

Отклонён. Он обходит service-owned invariants, не даёт безопасной
идемпотентности, плохо аудируется и создаёт риск cross-service coordination.
Все изменения состояния выполняются только service-owned operator commands.

### Доступ к synthetic compatibility Person

Отклонён. Authenticated MCP никогда не должен использовать synthetic fallback.
Для smoke создаётся отдельный real Person с контролируемыми неперсональными
staging fixtures.

## Scope

### Входит

1. `apps/api` operator CLI и storage transaction для idempotent provisioning
   API User, real Person, owner grant и Identity subject binding.
2. `apps/identity` read-only operator CLI для exact account subject lookup.
3. Package scripts, integration/unit tests и concise English TSDoc/JSDoc для
   новых module contracts и non-obvious command helpers.
4. Автоматизированный OAuth/MCP readiness smoke без credentials.
5. Operator-assisted создание одного ChatGPT developer-mode connection и
   получение exact callback.
6. Provision predefined public client в Identity через существующий
   `oauth-client:provision`.
7. Provision или reuse одного staging Identity account/passkey и создание
   API-owned authorization principal через новые команды.
8. External OAuth flow, consent, read tool smoke, одна контролируемая write
   операция и проверка идемпотентного retry.
9. Негативные проверки invalid/missing token, scope, audience, mapping и grant,
   а также session/grant revocation.
10. Независимый quality review, Architecture Review и последующее выравнивание
    только затронутых canonical Wiki/changelog страниц.

### Не входит

- CIMD, DCR, `private_key_jwt`, mTLS enforcement или public registration API.
- Публичная публикация/marketplace submission полного plugin package.
- Production activation, production data, Google Sheets cutover или импорт
  персональных fitness records.
- Новые OAuth/MCP tools, изменение schemas, scopes или domain behavior.
- Новые таблицы, migrations, deployables, databases или credentials.
- Изменение issuer, resource audience, Identity origin, WebAuthn RP ID,
  cookies, CSRF policy или access-token lifetime.
- UI redesign, frontend fitness-data pages, TOTP/recovery work.
- Key-rotation implementation, Vault/KMS и production conformance scope.

## Затронутые области

| Область | Ожидаемое изменение |
|---|---|
| `apps/api/src/commands/` | Новый operator-only `identity-access:provision` command |
| `apps/api/src/storage/` | Транзакционная idempotent provisioning boundary без cross-service SQL |
| `apps/api/package.json` | Точный package script для operator command |
| `apps/api/test/` | Integration tests для create/repeat/conflict/rollback и authorization result |
| `apps/identity/src/commands/` | Read-only exact account-to-subject lookup command |
| `apps/identity/package.json` | Точный package script для subject lookup |
| `apps/identity/test/` | Tests для exact lookup, unknown account и safe output contract |
| staging/ChatGPT state | Отдельно одобренные provisioning и external connection operations |
| `docs/wiki/**`, `docs/wiki/changelog.md` | Только после accepted quality — фактический current state и результат dogfood |

## Technical impact checklist

| Область | Impact | Комментарий |
|---|---|---|
| Affected files/modules | yes | Два узких operator CLI и tests |
| Data model | no | Используются принятые таблицы без migration |
| Public API/contracts | no | HTTP, OAuth и MCP wire contracts не меняются |
| Deployment topology | no | Новых images/services/routes нет |
| Backward compatibility | yes | Существующие flows и synthetic runtime остаются без изменений |
| Security | yes | Provisioning создаёт authorization relationships и требует fail-closed behavior |
| Secrets | operational only | Значения не читаются и не фиксируются до отдельного approval |
| External state | yes | ChatGPT connection и staging rows создаются только после отдельного approval |
| Test surface | yes | CLI idempotency, OAuth flow, authorization и revocation |
| Documentation | yes | Current state меняется только после подтверждённого external smoke |

## Этапы

1. [x] Получить явное утверждение этого плана. До утверждения не писать код и
   не выполнять provisioning.
2. [x] Реализовать API provisioning transaction и operator command с
   fail-closed conflict behavior.
3. [x] Реализовать Identity public-subject lookup command без sensitive output.
4. [x] Добавить package scripts, TSDoc/JSDoc и isolated integration tests.
5. [x] Прогнать monorepo quality gates и независимый quality review кода.
6. [ ] Отдельно запросить approval на staging/ChatGPT operations и доступ к
   строго необходимым operator-managed credentials без чтения/вывода секретов.
7. [ ] Проверить наличие operator Identity account. Reuse существующего
   account/passkey, если exact account id известен; иначе выполнить interactive
   bootstrap и завершить `/enroll` с user-presence passkey.
8. [ ] Создать ChatGPT developer-mode MCP connection для
   `https://staging.shape-of-you.ru/api/mcp`, зафиксировать только connection id
   и exact callback без cookies/tokens/screenshots чувствительных состояний.
9. [ ] Provision `shape-of-you-chatgpt-staging` в Identity с exact callback и
   утверждённым protocol/resource scope allowlist.
10. [ ] Получить public subject через Identity command и provision API User,
    real Person, owner grant и exact binding через API command.
11. [ ] Пройти passkey login, consent и Authorization Code + S256 PKCE flow;
    подтвердить exact issuer, audience/resource и scopes без вывода token.
12. [ ] Выполнить external evaluation set: direct read, indirect read,
    follow-up, подтверждаемая write, idempotent retry и unsupported request.
13. [ ] Проверить negative authorization и revocation scenarios.
14. [ ] Провести независимый quality review и Architecture Review operational
    result.
15. [ ] После accepted quality обновить current-state Wiki/changelog. Commit,
    push и последующий deployment остаются отдельными release gates.

## Результат pre-provisioning code gate

- Independent Quality decision: `ACCEPTED`; blocking code/security findings
  отсутствуют.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:unit` и
  `pnpm test:docs` прошли на уровне monorepo.
- Identity integration: 24/24 tests passed.
- API integration: 36/36 tests passed, включая create/repeat/conflict
  provisioning scenarios.
- `node scripts/validate-docs.mjs`: 52 Wiki pages, 40 ADRs, 92 unique ids.
- `git diff --check`: clean.
- External acceptance criteria 5–11 и external часть criterion 12 не
  проверялись, поскольку staging/ChatGPT provisioning пока не разрешён.

## Критерии приёмки

1. Новый API command на чистом состоянии создаёт ровно один active User, один
   active real Person, один active owner grant и одно exact subject mapping в
   одной транзакции.
2. Повтор команды с тем же issuer/subject не создаёт rows; конфликтующее или
   неоднозначное состояние завершается ошибкой без частичного изменения.
3. Identity subject lookup требует exact account UUID и не выводит ничего,
   кроме account id, public subject и стабильного status message.
4. Ни один command не читает другую service database, не принимает raw SQL и
   не выводит credentials или enrollment bearer в non-interactive output.
5. ChatGPT обнаруживает endpoint, ровно восемь tools и их per-tool OAuth scopes.
6. Predefined client использует exact callback ChatGPT, public-client token
   exchange (`none`), S256 PKCE и allowlist `openid` плюс пять resource scopes.
7. Passkey login и consent завершаются; access token принимается только при
   exact issuer, resource audience, expiry и достаточном scope.
8. Known subject с единственным active Person grant выполняет read tool.
   Unknown subject, missing/revoked grant или ambiguous Person context получает
   fail-closed authorization error.
9. Write tool вызывается только после явного подтверждения в ChatGPT, создаёт
   контролируемую staging fixture и не дублирует факт при повторе с тем же
   idempotency key.
10. Отзыв Identity refresh/session authority и API PersonAccessGrant проверен
    раздельно; последующие вызовы не получают доступ.
11. Ни tokens, cookies, passkey material, OAuth state/code/verifier, private
    keys, database URLs, `.env` values и реальные Person data не попадают в
    chat, Git, docs, screenshots, fixtures или test logs.
12. Полный quality pipeline и canonical documentation validation проходят; в
    diff нет нового deployable, migration или незаявленного public contract.

## План проверки

### До provisioning

- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm build`;
- `pnpm test:unit`;
- targeted API/Identity integration tests для новых commands;
- `pnpm test:e2e` и `pnpm test:e2e:web` для regression coverage;
- `node scripts/validate-docs.mjs`;
- `git diff --check`.

### Публичный protocol smoke

- HTTP status и exact fields protected-resource metadata;
- OAuth/OIDC discovery, issuer, endpoints, `S256`, `none` и scopes;
- MCP `initialize` и `tools/list`;
- unauthenticated tool call возвращает OAuth challenge без внутренних деталей;
- MCP Inspector OAuth flow для transport/auth diagnostics.

### External ChatGPT E2E

- developer-mode connection создаётся для exact public MCP URL;
- callback берётся только из текущей ChatGPT management page;
- ChatGPT показывает linking UI, passkey login и consent;
- evaluation prompts покрывают direct/indirect/follow-up/write/unsupported;
- tool selection, arguments, result, confirmation и retry проверяются без
  сохранения raw conversation или sensitive protocol material.

Автоматизируются все доступные protocol, CLI и service проверки. ChatGPT
management UI и WebAuthn user-presence остаются минимальными operator-assisted
шагами: exact callback существует только во внешнем connection UI, а passkey
по определению требует присутствия пользователя. Browser не используется как
замена автоматическим E2E tests.

## Architecture Review

1. Лишняя сложность: не добавляются CIMD, DCR, registration endpoint, новый
   service, frontend или orchestration layer.
2. Premature services: Identity и API сохраняют существующие deployable и
   database ownership boundaries; каждый operator command работает только со
   своей БД.
3. DDD: Identity подтверждает account subject; API самостоятельно создаёт и
   проверяет User, Person и PersonAccessGrant. OAuth token не становится
   доменной авторизацией.
4. Дублирование: ADR остаются authority для архитектуры, Wiki — для current
   state, этот plan — только для execution scope и gates.
5. Упрощение: два узких service-owned commands заменяют ручной SQL и не меняют
   schema/public API. Один command в общем admin service был бы сложнее и
   нарушил бы service autonomy.
6. Масштабирование: predefined client намеренно ограничен первым dogfood.
   Переход к CIMD рассматривается отдельным ADR при multi-client/public rollout,
   когда его эксплуатационная выгода оправдает security contract.

## Блокирующие approval gates после утверждения плана

1. Реализация кода.
2. Использование operator-managed staging credentials без чтения или вывода
   secret values.
3. Изменение staging databases через service-owned commands.
4. Создание или изменение ChatGPT connection.
5. Enrollment/passkey и consent с user presence.
6. External write smoke, даже с контролируемыми неперсональными fixtures.
7. Commit, push и deployment.

## Handoff после утверждения

После утверждения план переходит в developer implementation для двух CLI и
tests. Developer и независимый quality review выполняются до любых staging
mutations. Затем DevOps получает отдельное разрешение на точный provisioning и
external ChatGPT E2E scope.

## Одобренное дополнение: безопасная проверка revocation

После успешного external evaluation 2026-08-10 обнаружено, что Identity
session можно отозвать через существующий Security UI, но API не имеет
service-owned operator contract для отзыва `PersonAccessGrant`. Ручной SQL
остаётся запрещённым.

Одобрено добавить две узкие API operator-команды без изменения schema,
публичного HTTP API или deployment topology:

1. `identity-access:revoke --issuer --subject` атомарно находит exact binding
   и единственный active real Person owner grant, переводит grant в `revoked`
   и устанавливает `revoked_at`. Безопасный повтор возвращает `existing`.
2. `identity-access:restore --issuer --subject` требует exact binding,
   active User, active real Person и отсутствие active grants, после чего
   создаёт новый active owner grant. Отозванная строка не реактивируется, чтобы
   сохранить историю lifecycle. Безопасный повтор возвращает `existing`.
3. Частичное, неоднозначное, disabled, archived или synthetic состояние
   завершается fail-closed без неявного ремонта.
4. External pin test: после revoke MCP read немедленно теряет Person context;
   после restore тот же authenticated subject снова получает доступ. Identity
   session/refresh revocation проверяется отдельно через существующий UI.

Дополнение требует TSDoc для новых contracts/helpers, integration tests для
revoke, повторного revoke, restore, повторного restore и конфликтов, полного
developer gate и независимого Quality review до staging mutation.

## Одобренное дополнение: безопасный OIDC `id_token_hint`

После успешной проверки Identity session/refresh revocation ChatGPT 2026-08-10
начал новый authorization request с OIDC `id_token_hint`. `oidc-provider`
валидирует hint до создания Interaction, но typed adapter отклонил неизвестное
поле и вернул `500`.

Одобрено расширить существующую typed protocol-state модель:

1. Разрешать `id_token_hint` только после стандартной проверки
   `oidc-provider`; adapter не становится отдельным JWT verifier.
2. Из проверенного hint извлекать только обязательный `sub` и сохранять его в
   `oauth_interactions.id_token_hint_subject`. Raw JWT не сохранять, не
   возвращать из adapter и не логировать.
3. При завершении login требовать exact совпадение сохранённого OIDC subject с
   выбранным active account. Принимаются отдельный public
   `identity_accounts.subject` и provider account ID, который уже присутствует
   в ранее выданных ID tokens; lookup другого account или неявная подмена
   запрещены. Mismatch завершается fail-closed до изменения
   Interaction/session/grant state.
4. Добавить backward-compatible nullable column migration, проверку длины,
   чистую migration-chain validation и runtime reconnect tests для accepted
   hint, invalid hint и subject mismatch.
5. Не менять issuer, OAuth endpoints, public client contract, access/refresh
   token TTL, deployment topology или service ownership.

Новый ADR не требуется: дополнение реализует уже принятое хранение OAuth
protocol state в typed lifecycle tables. Migration, implementation, Quality,
commit, push и deployment остаются отдельными gates.

Выравнивание ID-token `sub` с отдельным public subject требует сквозного
изменения provider Session/Grant/AuthorizationCode/RefreshToken contracts и не
входит в это совместимое исправление reconnect.

## Одобренное дополнение: `offline_access` для долгоживущего подключения

После принятого исправления OIDC `id_token_hint` новый authorization flow
завершается успешно, однако после истечения access token ChatGPT снова требует
интерактивное подключение. За тот же период Identity и API не получили refresh
request и не зарегистрировали token/authentication error. В фактическом
authorization request присутствуют `openid` и пять resource scopes, но нет
`offline_access`; Identity также не рекламирует и не разрешает этот protocol
scope.

Дополнение опирается на accepted ADR
[`docs/adr/20260810-require-offline-access-for-durable-oauth-connections.md`](../../../docs/adr/20260810-require-offline-access-for-durable-oauth-connections.md)
и разрешает исходный код в точной границе этого дополнения после утверждения
оператором 2026-08-10.

### Выбранное изменение

1. Добавить `offline_access` в OIDC discovery `scopes_supported` Identity и в
   exact allowlist predefined client `shape-of-you-chatgpt-staging`.
2. Разделить запрошенные scopes при создании/обновлении consent grant:
   `openid` и `offline_access` хранить только в
   `oauth_grant_oidc_scopes`; пять MCP resource scopes — только в
   `oauth_grant_resource_scopes` для exact
   `https://staging.shape-of-you.ru/api/mcp` resource.
3. Не рекламировать protocol scopes в MCP protected-resource metadata и не
   считать их API permissions. API продолжает проверять только exact audience,
   subject mapping, active Person grant и требуемый per-tool resource scope.
4. Сохранить десятиминутный access token, 30-дневный rotating refresh token,
   family reuse detection, session/client/resource binding и существующую
   revocation model.
5. После deployment обновить predefined client только штатным
   `oauth-client:provision`, без ручного SQL, затем пересоздать ChatGPT
   application connection для повторного чтения discovery metadata.

### Scope и ограничения

- Входит: `apps/identity` OAuth runtime/consent scope classification, exact
  client validation, tests, proposed ADR и последующее current-state Wiki
  alignment после accepted Quality.
- Не входит: новые tables/migrations, API/MCP tools, новые resource scopes,
  access-token TTL changes, DCR, CIMD, новый deployable, новая БД или изменения
  WebAuthn/Identity origin.
- Staging client reprovision, ChatGPT application recreation, deployment и
  external expiry smoke остаются отдельными explicit operator gates.
- Tokens, cookies, authorization codes, PKCE verifier, passkey material,
  database URLs и `.env` values не читаются, не печатаются и не фиксируются.

### Критерии приёмки

1. Authorization-server и OpenID discovery рекламируют `offline_access`, а MCP
   protected-resource metadata по-прежнему содержит только пять resource
   scopes.
2. Клиент без exact allowlist или без включённых refresh tokens не может
   запросить `offline_access`; остальные неизвестные scopes также отклоняются.
3. Consent grant хранит `openid`/`offline_access` только как OIDC scopes и пять
   MCP permissions только как resource scopes exact MCP resource.
4. Полный Authorization Code + S256 PKCE flow с `openid offline_access` и
   resource scopes выдаёт short-lived access token и rotating refresh-token
   family без расширения API authority.
5. После simulated access-token expiry refresh rotation проходит, reuse старого
   refresh token отклоняется, новый access token выполняет read MCP action без
   нового интерактивного authorization flow.
6. Repeated/concurrent consent сохраняет один active grant; reconnect с
   `id_token_hint` продолжает проходить, mismatch остаётся fail-closed.
7. Integration coverage проходит и при `DATABASE_POOL_MAX=1`; PostgreSQL
   identifiers проверены на лимит 63 UTF-8 bytes, `git diff --check` и canonical
   docs validation зелёные.
8. External staging pin после отдельного approval подтверждает refresh request
   и последующий read без вывода credentials или sensitive protocol values.

### План реализации и проверки

1. [x] После утверждения ADR перевести его в `accepted` и зафиксировать это
   дополнение как одобренное.
2. [x] Ввести явные OIDC protocol scopes и resource scopes в Identity runtime,
   не создавая второй источник истины для per-tool permissions.
3. [x] Разделить grant persistence и добавить fail-closed client checks для
   `offline_access`.
4. [x] Добавить metadata, adapter, consent, refresh rotation/reuse, concurrency и
   pool-size integration tests; документировать новые exported contracts и
   non-obvious invariants concise English TSDoc/JSDoc.
5. [x] Прогнать `pnpm lint`, `pnpm typecheck`, `pnpm build`, Identity unit и полный
   integration suite, `node scripts/validate-docs.mjs`, identifier check и
   `git diff --check`.
6. Перед implementation completion провести независимый Quality review и
   Architecture Review. До их принятия не выполнять staging mutations.
7. После отдельного DevOps approval дождаться auto-deploy, штатно
   reprovision client, пересоздать ChatGPT application connection и выполнить
   expiry-boundary E2E.

### Architecture Review до реализации

1. Решение использует стандартный OIDC scope вместо специального reconnect
   endpoint или ChatGPT-specific token policy.
2. Новых deployables, databases, credentials и service-to-service contracts
   нет; Identity остаётся единственным владельцем OAuth lifecycle.
3. DDD сохраняется: protocol scope разрешает только durable OAuth session, а
   API-owned User/PersonAccessGrant и resource scopes продолжают определять
   доступ к fitness data.
4. ADR владеет архитектурным решением, Wiki — current state после принятого
   результата, plan — execution/gates; решение не дублируется как competing
   source of truth.
5. Увеличение access-token TTL или нестандартная выдача refresh credential без
   `offline_access` проще только локально, но хуже масштабируется и ослабляет
   явный interoperability/security contract.

## Одобренное дополнение: account-less provider Session до login

Оператор утвердил это дополнение 2026-08-11 до изменения исходного кода.

### Контекст

После успешного auto-deploy `7b2839b` новый внешний authorization request с
`id_token_hint` стабильно возвращает `500`. Identity фиксирует только
`OAuth Session account id is invalid`. `oidc-provider` 9.11.1 допускает
временную Session без `accountId` до обязательного login interaction и
пытается сохранить её, когда request коснулся session state. Текущий adapter
ошибочно требует account-bound Session для любого `upsert`.

### Одобренное решение

1. Не создавать строку `oauth_sessions` для строго пустой provider Session без
   `accountId`; считать её неперсистентным protocol placeholder до login.
2. Разрешать этот no-op только при отсутствии `acr`, `amr`, `loginTs` и
   `authorizations`. Любая account-like или authorization state без exact
   `accountId` остаётся fail-closed.
3. После passkey login сохранять Session существующим способом: exact account,
   interaction/session binding, provider UID/credential hash и typed
   authorizations остаются обязательными.
4. Не добавлять nullable account ownership, новую table, cookie type, endpoint,
   migration или второй источник session state.

### Проверка

1. Integration test воспроизводит authorization с `id_token_hint`, отсутствующим
   provider-session binding и scope set без forced `offline_access`; результат —
   login interaction, а не `500`.
2. До login в `oauth_sessions` не появляется account-less строка.
3. Account-like placeholder без `accountId` отклоняется.
4. Login → consent → callback/token и существующие reconnect/mismatch,
   revocation, refresh, concurrency и `DATABASE_POOL_MAX=1` tests остаются
   зелёными.

### Architecture Review

Новый ADR не требуется: изменение уточняет adapter compatibility внутри уже
принятой typed-session архитектуры. PostgreSQL продолжает хранить только
account-bound Identity sessions; ephemeral provider placeholder не становится
новой domain entity или источником истины. Альтернатива с nullable
`oauth_sessions.account_id` потребовала бы migration, ослабила ownership
invariant и дублировала Interaction lifecycle, поэтому отклоняется.
