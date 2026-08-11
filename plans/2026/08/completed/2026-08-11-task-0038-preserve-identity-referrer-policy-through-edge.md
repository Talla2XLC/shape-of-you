# TASK-0038 — Сохранить Identity-owned Referrer-Policy через staging edge

Статус: выполнено и принято Quality 2026-08-11.

Архитектурная основа:

- [`docs/adr/20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md`](../../../docs/adr/20260802-own-identity-service-and-use-replaceable-oauth-oidc-libraries.md);
- [`docs/adr/20260806-bootstrap-first-passkey-and-require-origin-csrf-defense.md`](../../../docs/adr/20260806-bootstrap-first-passkey-and-require-origin-csrf-defense.md).

Новый ADR не требуется: исправление восстанавливает уже утверждённое владение
OAuth browser interaction и его response-specific security policy сервисом
Identity. Топология deployable, публичные контракты и ownership не меняются.

## Проблема

TASK-0037 правильно отдаёт OAuth interaction HTML с
`Referrer-Policy: same-origin`, чтобы native same-origin form POST содержал
точный Identity `Origin`, а внешний ChatGPT callback не получал `Referer`.

Staging edge nginx одновременно добавляет на уровне всего Identity server
`Referrer-Policy: no-referrer`. В итоговом браузерном ответе upstream policy
конфликтует с edge policy; Chromium отправляет consent POST с `Origin: null`,
и строгая backend-проверка корректно отвечает `403 invalid_origin`.

Локальный Identity Playwright E2E не проходил через nginx и поэтому не закрепил
полный production path.

## Выбранное решение

- Убрать только server-level `Referrer-Policy: no-referrer` из Identity nginx
  server, чтобы reserved proxy routes сохраняли response-specific upstream
  policy.
- Не скрывать и не переписывать upstream `Referrer-Policy` для `/oauth/`,
  `/.well-known/`, `/v1/`, `/live` и `/ready`.
- Сохранить явный `no-referrer` для статических Identity Nuxt HTML/assets в их
  собственных nginx locations.
- Сохранить HSTS, CSP, frame, content-type, proxy routing, exact-Origin и CSRF
  проверки без изменений.
- Расширить edge runtime E2E: Identity stub отдаёт `same-origin` на OAuth
  interaction response; nginx обязан вернуть ровно эту policy без второго
  `no-referrer`. Статический Identity UI продолжает возвращать `no-referrer`.

## Рассмотренные альтернативы

1. **Разрешить `Origin: null`.** Отклонено: ослабляет CSRF boundary и
   противоречит ADR.
2. **Установить `same-origin` на весь Identity host в nginx.** Отклонено:
   расширяет policy на JSON/provider/static responses и лишает Identity
   response-specific контроля.
3. **Создать отдельный nginx location только для interaction URL.** Отклонено:
   дублирует OAuth routing/policy в edge и легко расходится с Identity routes.
4. **Пропускать upstream policy на reserved Identity proxy routes.** Выбрано:
   сохраняет ownership, минимальный diff и корректно поддерживает разные OAuth
   responses.

## Scope

Входит:

- `deploy/staging/nginx/nginx.conf.template`;
- edge contract/runtime tests;
- regression pin для единственного upstream `Referrer-Policy: same-origin`;
- проверка, что статический Nuxt UI остаётся `no-referrer`;
- независимый Quality, Architecture Review и staging smoke после отдельного
  commit/push/deploy approval.

Не входит:

- изменения Identity OAuth/CSRF/Origin кода;
- принятие missing/opaque/mismatched Origin;
- изменение scopes, clients, sessions, grants, callback или WebAuthn;
- schema, migration, database, service или deployable changes;
- ручной deploy, SSH, commit или push без отдельных approvals.

## Этапы после утверждения

1. Зафиксировать operator approval и developer plan в TASK-0038.
2. Удалить только конфликтующий server-level Identity `Referrer-Policy`.
3. Обновить edge contract test для ownership boundary.
4. Расширить edge Docker runtime E2E response-specific upstream header pin.
5. Прогнать edge tests, lint/typecheck/build/test, Docker E2E, docs validation
   и `git diff --check`.
6. Передать независимому Quality; после acceptance выполнить Architecture
   Review и определить, нужен ли current-state Wiki update.
7. Отдельно запросить commit/push; дождаться автодеплоя и повторить реальный
   ChatGPT reconnect.

## Критерии приёмки

1. OAuth interaction через staging edge возвращает ровно один
   `Referrer-Policy: same-origin` от Identity.
2. Edge не добавляет `no-referrer` к reserved Identity proxy responses.
3. Identity Nuxt HTML и immutable assets продолжают получать
   `Referrer-Policy: no-referrer`.
4. Native OAuth consent сохраняет exact browser Origin; backend Origin/CSRF
   validation не меняется.
5. Edge runtime E2E воспроизводит upstream policy через реальный nginx
   container, а не только проверяет строки шаблона.
6. Нет schema, migration, API/OAuth contract, deployable или ownership changes.
7. Diff ограничен утверждённым edge/test/plan scope, все quality gates зелёные.

## Architecture Review до реализации

1. Новая сущность, service, deployable, database или credential boundary не
   создаётся.
2. Identity остаётся владельцем OAuth response policy; edge отвечает только за
   безопасную доставку и статический frontend.
3. Policy не дублируется между Identity и nginx для proxy responses.
4. ADR/Wiki остаются архитектурной authority, план описывает только execution.
5. Удаление одного глобального override проще и масштабируемее, чем URL-specific
   OAuth policy в edge.
