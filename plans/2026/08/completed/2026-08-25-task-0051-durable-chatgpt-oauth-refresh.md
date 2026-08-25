# TASK-0051 — Durable OAuth refresh для ChatGPT MCP

## Статус и разрешение

- Статус: completed.
- Оператор утвердил recommended architecture, ADR, план и реализацию командой
  `go` 2026-08-25.
- Scope выполняется одним delivery package: Identity code, tests, accepted ADR,
  affected current-state Wiki и quality evidence.

## Цель

Устранить повторную интерактивную авторизацию Shape of You connector после
истечения короткого access token, сохранив существующие security boundaries.

## Входит

1. Refresh issuance по typed `refreshTokensEnabled` client policy.
2. ChatGPT authorization без `offline_access` с rotating refresh token.
3. Явный durable-access label на consent screen.
4. Web client regression без refresh token.
5. Rotation, reuse, grant/session/resource binding regression.
6. Superseding ADR, affected Wiki и independent Quality.

## Не входит

- Увеличение access-token TTL или non-expiring tokens.
- Schema/data migration, DCR, CIMD или новые credentials.
- Изменение MCP scopes, API authorization или protected-resource metadata.
- Deployment, commit или push без отдельного разрешения.

## Реализация

1. [x] Воспроизвести re-auth и проверить staging OAuth state без раскрытия
   credentials.
2. [x] Утвердить server-owned registered client policy.
3. [x] Зафиксировать superseding ADR и план.
4. [x] Изменить refresh issuance и consent presentation.
5. [x] Обновить end-to-end OAuth integration pins.
6. [x] Пройти focused/full checks и Architecture Review.
7. [x] Провести independent Quality и обновить affected Wiki.

## Критерии приёмки

1. Refresh-enabled public client получает refresh token без requested
   `offline_access`.
2. Consent screen явно показывает durable connection.
3. Refresh rotation создаёт новый credential, старый повторно не принимается.
4. Access token остаётся десятиминутным и audience-bound.
5. Refresh-disabled Web client не получает refresh token.
6. Scope allowlists, PKCE, redirect, resource, session и revocation invariants
   не ослаблены.
7. MCP protected-resource metadata остаётся resource-only.
8. Schema, deployable boundaries и credentials не меняются.

## План проверки

- Focused Identity OAuth integration test.
- Identity unit/integration suites, lint, typecheck и build.
- Canonical documentation validator и `git diff --check`.
- Architecture Review по security, complexity, DDD и service boundaries.

## Architecture Review checklist

- Используется существующая typed client capability, без ChatGPT-specific
  runtime branch.
- Короткий bearer lifetime и rotation сохранены.
- Protocol scopes не смешиваются с MCP permissions.
- Новых tables, services, credentials и JSON models нет.
- Wiki обновляет current state и ссылается на ADR без копирования истории.

## Результат

- Refresh-enabled registered clients получают rotating refresh token независимо
  от наличия `offline_access` в запросе внешнего клиента.
- Consent screen явно сообщает о сохранении активного подключения.
- Интеграционный сценарий фиксирует ChatGPT-shaped запрос без
  `offline_access`, десятиминутный access token, rotation и rejection повторного
  использования старого refresh token.
- Web client с отключённой refresh policy по-прежнему не получает refresh
  token.
- Полный Identity-набор прошёл: 65/65 тестов; также прошли lint, typecheck,
  build, 2/2 Playwright OAuth browser tests, canonical docs validation и
  `git diff --check`.
- После первого push CI обнаружил отсутствующий `isRefreshTokenEnabled` mock в
  browser fixture. Fixture дополнен typed policy и проверкой durable consent
  label; повторный локальный browser E2E прошёл 2/2.
- Schema, deployable boundaries, credentials, MCP resource scopes и deployment
  не изменялись.

## Architecture Review

Решение использует существующую typed client capability и не вводит ветку по
строковому ChatGPT client ID, новую сущность, сервис или deployable boundary.
Короткий срок жизни bearer token, PKCE, allowlists, session/resource binding,
rotation, reuse detection и revocation сохранены. Protocol presentation не
смешивается с MCP resource permissions. Более простого безопасного варианта
без возврата к постоянной ручной авторизации не обнаружено.
