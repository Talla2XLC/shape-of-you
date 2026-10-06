# TASK-0163 — возврат mobile OAuth после Allow

## Статус и граница

Диагностика read-only на talking-to-ai отдельно одобрена оператором.
Оператор одобрил [ADR](../../../../docs/adr/20261006-complete-consent-through-same-origin-navigation.md)
и этот план отдельным сообщением «го». Реализация выполнена и принята
независимой Quality: `task-0163-quality-acceptance-20261006`.
Production, live writes, commit/push и доставка не
разрешаются этим планом. Конкретная mobile цепочка не наблюдалась.

## Проверенные факты

Две Android попытки получили 303 от consent и resume, два кода выданы, consumed
count 0, subsequent token POST отсутствует в интервале. Identity errors нет;
readiness успешна. Локальная headless Chromium проверка текущего renderer:
прямой callback проходит; redirect с callback на третий origin вызывает CSP
form-action violation и оставляет consent document. Это воспроизведённый дефект,
вероятный для mobile инцидента, но live причинность ещё не подтверждена.

## Одобренный объём

1. Зафиксировать одобрение ADR/плана в managed timeline.
2. Для native consent Allow/Deny сохранять interactionResult и проверять
   provider-owned same-origin returnTo без изменения authority/allowlists.
3. Вернуть защищённый no-store документ HTTP200 с nonce script GET navigation
   и fallback ссылкой; сохранить JSON/fetch login flow и CSRF/Origin/session guards.
4. Добавить meaningful browser redirect-chain tests и реальную provider
   integration с синтетическим code exchange; deny/invalid returnTo/privacy
   headers/no-JS/duplicate POST/login regressions.
5. Identity typecheck/build/lint и relevant tests; independent Quality;
   пятичастный Architecture Review; affected canonical Wiki после принятия.
6. Docs validator/diff check, completed plan и Conventional Commit message.

## Приёмка и ограничения

Реальный native consent и provider resume работают при следующем cross-origin
GET redirect без ослабления form-action и callback allowlist. CSRF/Origin,
grant/PKCE и session authority сохраняются. Нет секретов в логах, отчётах,
intermediate callback query или persisted новых сущностей. Staging rollout и
operator mobile canary отдельно подтверждают delivery и конкретный сценарий.

Сбой API migration TASK-0161 остаётся отдельным инцидентом: текущий read-only
connection и права успешны, historical underlying error не сохранён.

## Результат

- Native Allow/Deny использует публичный interactionResult с merge false;
  проверяется canonical same-origin exact resume URL, включая отсутствие
  userinfo/query/fragment и нормализованных альтернативных путей.
- HTTP200 документ с nonce CSP/no-store/no-referrer выполняет отдельную GET
  навигацию; no-JS fallback проходит ту же цепочку. Login flow сохранён.
- Developer typecheck/build/lint прошли. Independent Quality отдельно
  проверила 51 unit, 29 isolated PostgreSQL/provider integration и 13 Chromium
  browser tests; все прошли. Guards, PKCE/token exchange, Deny, no-JS, hostile
  targets, headers, direct/chained callbacks и login покрыты.
- Architecture Review: минимальный provider adapter/document; без новых
  deployables/entities/routes/migrations; ownership Identity сохранён;
  ADR/план/current-state Wiki не создают вторую authority или mirrors.
- После принятия обновлена только affected Identity Wiki. Docs validator и
  diff check прошли. Документация передана на отдельную проверку Quality.
- Локальная реализация завершена; commit/push/staging delivery и проверка
  конкретного телефона ещё не выполнялись. Live causality остаётся вероятной.
