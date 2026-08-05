# Identity service и защищённый доступ ChatGPT через MCP

## Цель

Создать принадлежащий проекту Identity service, который обслуживает OAuth/OIDC
для ChatGPT и будущих клиентов, не переносит Person-авторизацию из API и не
реализует стандартные криптографические протоколы с нуля.

## Подтверждённые решения

- Identity service, его данные, UX и публичные контракты принадлежат Shape of
  You.
- OAuth/OIDC и криптографические примитивы реализуются через проверенные,
  закреплённые по версии и заменяемые библиотеки.
- API сохраняет `User`, `PersonAccessGrant` и доменную авторизацию.
- Первичный клиент — ChatGPT через MCP; LLM внутри backend пока не нужен.
- Чтение Person-данных и запись веса, замеров тела, еды и тренировок разрешаются
  отдельными scopes.
- Перед мутацией ChatGPT явно спрашивает подтверждение пользователя.
- TLS-сертификаты выпускает и продлевает edge/ACME, а Identity управляет только
  ключами подписи OAuth-токенов.
- Staging использует `https://staging.shape-of-you.ru` и
  `https://identity.staging.shape-of-you.ru`; staging WebAuthn RP ID —
  `identity.staging.shape-of-you.ru`.
- Staging edge остаётся на nginx. Сертификат для двух точных имён выпускает и
  продлевает Certbot; renewal запускает root-owned systemd timer. Wildcard и
  DNS-provider credentials не используются.
- OAuth-состояние хранится в типизированных реляционных таблицах, не в JSON.
- Вход выполняется через WebAuthn/passkeys без пароля. Аккаунт поддерживает
  несколько passkeys; одноразовые recovery codes хранятся только как hashes и
  разрешают ограниченную регистрацию нового passkey с отзывом сессий.
- Email-only recovery, security questions и password fallback запрещены.

## Блокирующие архитектурные решения

1. До реализации WebAuthn-flow утвердить challenge, counter и attestation
   policies. Staging origin/RP-ID уже утверждены; production RP-ID будет
   `identity.shape-of-you.ru`, но production topology остаётся отдельным gate.
2. До production определить сроки жизни токенов, ротацию ключей, secret storage,
   RPO/RTO и hostname/TLS topology.

## Этапы

### 1. Технический спайк протокольной библиотеки

- [x] Проверить Authorization Code + S256 PKCE, discovery, resource indicators,
  predefined public client и JWT access tokens.
- [x] Проверить adapter payloads и возможность строгого отображения в
  типизированные PostgreSQL-таблицы без JSON.
- [x] Проверить Node.js 24, лицензию, дерево зависимостей, актуальный audit и
  возможность изоляции/fork.
- [x] Выбрать `oidc-provider` 9.11.1 и `@simplewebauthn/server` 13.3.2 за
  проектными adapter boundaries.
- Проверить revocation и refresh rotation/reuse на реализованном persistence
  adapter.
- Перенести end-to-end OpenID/OAuth conformance-набор на работающий HTTP-flow;
  проверка остаётся обязательной до production.

### 2. Каркас deployable `apps/identity`

- [x] Добавить отдельные `package.json`, `Dockerfile`, `AGENTS.md`, конфигурацию,
  probes и integration tests.
- [x] Подключить runtime к отдельному `DATABASE_URL`, database-aware readiness,
  graceful pool shutdown и отдельный migration runner.
- Создать отдельную PostgreSQL database boundary, credentials, Drizzle schema и
  воспроизводимые миграции.
- Не добавлять cross-service SQL или общие credentials.

### 2.1. Типизированная модель Identity

- [x] Принять lifecycle-таблицы без generic artifact table и без JSON.
- [x] Отделить неизменяемый публичный `subject` от внутреннего account ID.
- [x] Реализовать первую миграцию: accounts, passkeys, hashed challenges, recovery
  code batches/codes и passkey recovery sessions.
- [x] Реализовать вторую миграцию: OAuth clients/grants/sessions/interactions,
  hashed authorization codes и refresh-token families.
- [x] Реализовать третью миграцию: signing-key metadata и typed security audit.

### 3. Accounts, login и sessions

- Реализовать WebAuthn/passkey enrollment и login, несколько passkeys на
  аккаунт, hashed single-use recovery codes и replacement enrollment.
- Реализовать account status, consent, registered clients, одноразовые auth
  codes, hashed refresh credentials, rotation family и reuse detection.
- Добавить security audit без токенов, паролей и лишних персональных данных.

### 4. Issuer, tokens и keys

- Опубликовать discovery metadata и JWKS.
- Выпускать короткоживущие JWT access tokens с `iss`, `sub`, `aud`, `exp`, `iat`,
  `jti` и scopes без Person-данных.
- Реализовать перекрывающуюся ротацию signing keys и аварийный runbook.

### 5. API resource-server integration

- Добавить уникальное отображение `(issuer, subject)` на локальный `User`.
- Проверять подпись, issuer, audience/resource, время и scopes.
- После токена обязательно проверять локальный активный `PersonAccessGrant`.
- Не создавать доступ к Person автоматически при первом входе.

### 6. MCP adapter внутри API

- Опубликовать protected-resource metadata и OAuth challenge.
- Добавить allowlisted MCP tools поверх существующих application contracts.
- Привязать scopes `person:read`, `weight:write`,
  `body-measurement:write`, `meal:write`, `workout:write` к отдельным tools.
- Сохранить текущую идемпотентность и provenance; не хранить raw conversation.

### 7. Deployment и проверка безопасности

- [x] Утвердить staging hostname/RP-ID и nginx + Certbot + root-owned systemd
  timer как TLS lifecycle.
- Реализовать воспроизводимый HTTP-01 bootstrap, постоянное раздельное хранение
  ACME/serving state, автоматический renewal, проверку nginx и reload.
- Перевести staging smoke и GitHub Environment URL на HTTPS; убрать публичный
  `3001` после подтверждённого cutover.
- Первый cutover провести в две фазы через
  `STAGING_TLS_AUTOMATION_ENABLED`, чтобы push с новым CI-контрактом не обогнал
  установку root-owned wrapper и systemd units.
- Отдельно, с явным разрешением, установить root-owned units, открыть `80/443`,
  выпустить сертификат и выполнить HTTPS smoke на VM.
- Настроить отдельные secrets, backups, restore drill, rate limits, monitoring
  и alerting.
- Пройти Security Review и проверить revoke/rotation/incident scenarios.
- Не открывать реальные Person-данные до прохождения всех security gates.

## Проверка

- Unit и integration tests для login, consent, PKCE, redirect allowlist, code
  reuse, scopes, audience, refresh rotation/reuse и key rotation.
- Clean/upgrade migration tests для отдельной Identity database.
- API tests для неизвестного subject, неверного audience, недостаточного scope
  и отсутствующего/revoked PersonAccessGrant.
- MCP contract tests для discovery, challenges, per-tool scopes и idempotent
  retries.
- OpenID/OAuth conformance suite, dependency/security review и SBOM.
- Полный monorepo quality pipeline и `node scripts/validate-docs.mjs`.

## Критерии завершения

- ChatGPT проходит OAuth flow и получает только утверждённые scopes.
- Ни один токен сам по себе не даёт доступ к Person без API-owned grant.
- Повтор мутации не создаёт дубликат факта.
- Отзыв refresh session и PersonAccessGrant проверен отдельно.
- Identity можно заменить или форкнуть без изменения доменных контрактов.
- TLS и OAuth signing-key lifecycle остаются раздельными.
