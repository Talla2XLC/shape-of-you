---
id: "decisions-20261006-complete-consent-through-same-origin-navigation"
kind: adr
title: "Завершать browser consent через отдельную навигацию того же origin"
status: accepted
date: 2026-10-06
supersedes: []
superseded_by: null
tags:
  - identity
  - oauth
  - browser
---

# Завершать browser consent через отдельную навигацию того же origin

## Context

Оператор сообщил зависание mobile reconnect после Allow. Read-only диагностика
6 октября установила две Android попытки в 21:06 и 21:07 Europe/Belgrade:
consent POST и provider resume GET вернули 303; Identity выдал два кода, но
они не consumed, последующего token POST в проверенном интервале нет.
API/Identity readiness успешны. Ошибок Identity за интервал не найдено.

В текущем browser UI native consent form имеет CSP
`form-action 'self' <registered callback origin>`. Локальный Chromium probe
с реальным текущим renderer и синтетическими данными проходит прямой callback.
Если callback перенаправляет дальше на третий origin, browser фиксирует
нарушение form-action, не достигает третьего origin и остаётся на consent.
Конкретная цепочка телефона не наблюдалась; CSP является воспроизведённым
дефектом и вероятной, но ещё не доказанной причиной этих live попыток.

## Decision

Native browser consent POST завершается документом HTTP 200 того же
Identity origin, затем начинать отдельную GET навигацию к provider resume.
Оператор одобрил архитектуру и план TASK-0163 отдельным сообщением «го».

1. Native POST, точная Origin/CSRF/session binding проверка, grant scopes и
   `mergeWithLastSubmission: false` сохраняются для Allow и Deny.
2. Для этого пути использовать публичный `oidc-provider.interactionResult`,
   который сохраняет тот же результат и возвращает provider-owned returnTo,
   вместо `interactionFinished`, который дополнительно отправляет 303.
3. Перед навигацией проверить returnTo против configured Identity origin и
   точного `/oauth/authorize/<43-character credential>` пути. Не принимать
   arbitrary URL из запроса, foreign origin, query/fragment или иной путь.
   Неподходящий returnTo завершает запрос fail closed без навигации.
4. Ответ HTTP 200 содержит минимальный документ «возвращаем в приложение»,
   nonce-bound script с `location.replace` на проверенный resume URL и обычную
   GET ссылку того же origin как fallback без JavaScript. В нём нет authorization
   code, callback state или token; provider resume сохраняет выдачу кода.
5. CSP остаётся строгой: default-src none, nonce для script/style,
   frame-ancestors none, base-uri none, form-action self. Cache-Control no-store
   и Referrer-Policy no-referrer предотвращают сохранение и передачу страницы.
   Callback затем выполняется отдельной GET навигацией, к которой form-action
   предыдущей формы не применяется. OAuth redirect allowlist не расширяется.
6. JSON/fetch login path, issuer, callbacks, scopes, PKCE, client registrations,
   cookie и authorization ownership не меняются. Нет новых endpoint,
   persisted entity, таблиц, миграций или сервиса. Live reconnect требует
   operator canary после отдельно одобренной доставки.

## Considered alternatives

- Разрешить все HTTPS origins в form-action: меньше кода, но ослабляет защиту
  формы и не даёт точной границы. Отклоняется.
- Добавить известные ChatGPT login origins: зависит от внешней redirect chain
  и требует поддерживать список, который приложение не контролирует.
- Отправлять consent через fetch: предыдущий native flow сохраняет настоящий
  browser Origin и избегает CORS при callback; возврат fetch может вернуть эти
  проблемы. Не рекомендуется.
- Документ того же origin и отдельная GET навигация: рекомендуемый вариант;
  использует публичный provider API, сохраняет native POST защиту и не
  расширяет allowlists, но меняет ответ browser consent POST с 303 на 200.

## Consequences

Цепочка внешних GET redirect не наследует CSP form-action формы согласия.
Появляется краткая промежуточная страница с fallback ссылкой, без новых
persisted данных. Нужно проверить реальный provider resume и deny/error пути,
а не только mock с прямым callback. Локальный успех не доказывает исправление
конкретного телефона или доступность внешнего ChatGPT callback.

## Verification

- Browser baseline: direct callback; chained callback на третий origin;
  Allow и Deny, отсутствие CORS зависимости, точный Origin, один POST,
  отсутствие Referer и fallback при выключенном JavaScript.
- Real provider integration: interaction сохранён, resume выдаёт authorization
  code, synthetic client обменивает его; Deny выдаёт только access_denied.
- Hostile/invalid returnTo fail closed, сохранение CSRF/Origin/session guards,
  nonce/CSP/no-store/referrer headers, login regression.
- Identity lint/typecheck/build, unit/integration/browser E2E; independent
  Quality, Architecture Review, canonical Wiki alignment, docs validation.

## Related material

- [Identity](../wiki/architecture/identity-and-external-tool-access.md)
- [Стабильная OAuth session](20260918-preserve-stable-oauth-session-during-consent-reauthentication.md)
- [План TASK-0163](../../plans/2026/10/completed/2026-10-06-task-0163-mobile-consent-navigation.md)
