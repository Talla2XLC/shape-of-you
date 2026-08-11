# TASK-0037 — Exact-Origin отправка OAuth consent

Статус: выполнено и принято Quality 2026-08-11 после rework.

Архитектурная основа:

- [`docs/adr/20260806-bootstrap-first-passkey-and-require-origin-csrf-defense.md`](../../../docs/adr/20260806-bootstrap-first-passkey-and-require-origin-csrf-defense.md);
- [`docs/adr/20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md`](../../../docs/adr/20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md).

Новый ADR не требуется: исправление сохраняет существующие exact-Origin,
session-bound CSRF, Identity ownership и OAuth interaction contracts.

## Проблема

После успешной passkey-аутентификации ChatGPT reconnect доходит до Identity
consent, но OAuth interaction page отвечает `Referrer-Policy: no-referrer`.
Chromium из-за этой policy отправляет native form POST с `Origin: null`, и
backend корректно отвечает `403 invalid_origin`. HTTP integration test вручную
добавлял `Origin` и поэтому не воспроизводил browser submission path.

## Выбранное решение

- Сохранить без изменений строгую серверную проверку exact Identity `Origin`.
- Не принимать missing, opaque или mismatched Origin и не добавлять исключений
  для ChatGPT, браузеров или consent route.
- Сохранить native top-level form submission для consent, чтобы финальный
  cross-origin OAuth redirect не зависел от CORS callback endpoint.
- Изменить только Identity-owned OAuth interaction response policy с
  `no-referrer` на `same-origin`. Тогда same-origin POST несёт exact `Origin`,
  а cross-origin callback не получает `Referer`.
- Кнопки `Allow` и `Deny` остаются явными submit actions и передают текущие
  `csrfToken` и decision только в relative Identity endpoint; повторный submit
  блокируется локальным form guard до navigation.
- Сохранить CSP nonce, `connect-src 'self'`, session cookie, CSRF binding,
  provider interaction validation и redirect processing.

## Рассмотренные альтернативы

1. **Разрешить запрос без `Origin`.** Отклонено: ослабляет утверждённую CSRF
   границу и противоречит canonical ADR.
2. **Особый allowlist для `chatgpt.com` Origin.** Отклонено: consent page и
   session принадлежат Identity origin; cross-origin POST здесь не требуется.
3. **Same-origin `fetch` для consent.** Отклонено Quality: exact Origin
   появляется, но `redirect: follow` завершается CORS `TypeError` на реальном
   cross-origin ChatGPT callback; same-origin test callback маскировал дефект.
4. **Native form плюс `Referrer-Policy: same-origin`.** Выбрано: top-level
   navigation сохраняет OAuth redirect, POST получает exact Origin, внешний
   callback не получает `Referer`, proxy не синтезирует browser authority.

## Scope

Входит:

- Identity-owned OAuth interaction UI для `Allow` и `Deny`;
- тесты exact-Origin, CSRF, allow/deny и redirect behavior;
- настоящий browser E2E interaction submit без ручной подстановки `Origin`;
- regression coverage, что missing/wrong/opaque Origin остаются отклонёнными;
- concise English TSDoc/JSDoc при изменении module contracts;
- независимый Quality и Architecture Review.

Не входит:

- ослабление Origin/CSRF/WebAuthn проверок;
- изменение OAuth scopes, grants, sessions, tokens, callback или ChatGPT client;
- schema, migration, database, API/MCP tool или deployable changes;
- изменение общего Nuxt UI или passkey credential policy;
- deployment, staging mutation, commit или push без отдельных approvals.

## Этапы после утверждения

1. Зафиксировать operator approval в TASK-0037 и перевести task в developer.
2. Сформировать developer implementation plan и перед первой patch подтвердить
   ограничение diff файлом Identity browser UI и релевантными тестами.
3. Вернуть consent native form, добавить duplicate-submit guard и установить
   `Referrer-Policy: same-origin` только для OAuth interaction HTML.
4. Обновить integration coverage для allow, deny, missing/wrong Origin, CSRF и
   provider redirect без ручного обхода browser behavior.
5. Добавить browser E2E, который реально нажимает consent control и проверяет
   переход на отдельный callback origin без CORS, exact browser Origin на POST
   и отсутствие `Referer` на callback; не подставлять `Origin` вручную.
6. Прогнать Identity lint, typecheck, build, unit/integration, browser E2E,
   monorepo gates, docs validation и `git diff --check`.
7. Передать реализацию независимому Quality; после acceptance выполнить
   Architecture Review и определить, требуется ли current-state Wiki update.
8. Отдельно запросить approvals на commit, push и staging verification.

## Критерии приёмки

1. Consent `Allow` и `Deny` отправляются native top-level form POST с exact
   Identity `Origin` и session-bound CSRF token.
2. Успешный `Allow` завершает consent interaction и приводит к provider
   redirect/callback; `Deny` завершает flow с `access_denied`.
3. Missing, opaque и mismatched Origin по-прежнему fail-closed возвращают
   `invalid_origin`; серверная проверка не ослаблена.
4. Missing/wrong CSRF, invalid interaction credential, prompt mismatch и
   inactive session продолжают отклоняться.
5. Browser E2E нажимает реальный consent control, не подставляет `Origin`
   вручную, завершает redirect на отдельном origin без CORS и подтверждает
   отсутствие cross-origin `Referer`.
6. Passkey/login, reconnect, offline access, grants и callback allowlist не
   получают regression.
7. Нет schema, migration, public API, OAuth contract, deployable или data
   ownership изменений.
8. Diff ограничен утверждённым scope; TSDoc/JSDoc и все quality gates проходят.

## Риски и меры

- **Double click создаёт повторный submit:** блокировать controls на время
  запроса либо обеспечить один in-flight submit в page script.
- **Policy раскроет callback страницу:** `same-origin` не отправляет `Referer`
  на другой origin; browser E2E закрепляет это фактическим header assertion.
- **Ошибка скрывается generic message:** безопасно показать локализуемое
  credential-free сообщение без раскрытия provider/internal details.
- **Тест снова имитирует browser вручную:** acceptance требует реального click
  path; HTTP integration остаётся дополнительной security проверкой.

## Architecture Review до реализации

1. Новая сущность, service, deployable, database или ownership boundary не
   создаётся.
2. Identity остаётся единственным владельцем OAuth login/consent interaction.
3. Exact-Origin и CSRF authority не дублируются и не переносятся в proxy или
   ChatGPT-specific исключения.
4. ADR остаётся источником архитектурного решения, Wiki — current state, план —
   только execution scope.
5. Native navigation с одной response policy проще нового transport layer,
   callback bridge или server-side redirect storage и сохраняет stateless
   Identity replicas.
