---
id: "decisions-20260827-adopt-stable-chatgpt-connector-platform-oauth-callback"
kind: adr
title: "Использовать стабильный OAuth callback платформы коннекторов ChatGPT"
status: accepted
date: 2026-08-27
supersedes: []
superseded_by: null
tags:
  - "authentication"
  - "chatgpt"
  - "deployment"
  - "identity"
  - "mcp"
  - "oauth"
  - "security"
---

# Использовать стабильный OAuth callback платформы коннекторов ChatGPT

## Context

Предопределённый публичный OAuth-клиент
`shape-of-you-chatgpt-staging` принимает один точный callback из окружения.
Текущий контракт разрешает только устаревший адрес вида
`https://chatgpt.com/connector/oauth/<opaque-id>`. Новая форма подключения MCP
в ChatGPT отправляет стабильный адрес
`https://chatgpt.com/connector_platform_oauth_redirect`, поэтому Identity
корректно отклоняет авторизацию с `redirect_uri did not match` до показа
consent.

OAuth discovery Shape of You не публикует Dynamic Client Registration, а
ChatGPT при подключении с пользовательским публичным клиентом требует
зарегистрированный callback. Повторные обновления, reconnect и создание нового
коннектора не могут устранить расхождение на стороне Identity.

## Decision

Перевести предопределённый ChatGPT-клиент на единственный точный callback
`https://chatgpt.com/connector_platform_oauth_redirect`.

Сохранить существующее разделение ответственности: source-controlled manifest
владеет `client_id`, scope allowlist и refresh-token policy, а deployment
environment передаёт точный non-secret callback. Identity и deployment
controller принимают только HTTPS origin `https://chatgpt.com`, точный path
`/connector_platform_oauth_redirect`, без credentials, query и fragment.

Не поддерживать одновременно старый opaque callback и новый стабильный
callback. Старый коннектор уже не предоставляет рабочий каталог инструментов и
не является самостоятельной compatibility boundary. Новый коннектор заменяет
его после staging-проверки.

Не добавлять DCR, CIMD, client secret, bearer-token настройку, новые scopes или
изменения API authority. Reconciliation остаётся транзакционным deployment
шагом и обновляет только reserved predefined client.

## Considered alternatives

- **Разрешить старый и новый callback одновременно:** сохраняет возможность
  повторной авторизации старого коннектора, но расширяет redirect allowlist и
  требует дополнительного environment/schema contract ради уже неработающей
  интеграции. Отклонено.
- **Оставить старый callback и продолжать refresh/reconnect:** не меняет
  зарегистрированный `redirect_uri` и уже воспроизводимо завершается ошибкой.
  Отклонено.
- **Добавить Dynamic Client Registration:** позволило бы ChatGPT регистрировать
  callback самостоятельно, но создаёт новую OAuth registration surface,
  lifecycle и security policy ради одного administrator-managed клиента.
  Отложено.
- **Ослабить проверку до любого path на `chatgpt.com`:** уменьшает операционные
  сбои, но расширяет redirect authority без необходимости. Отклонено.

## Consequences

- Новые ChatGPT MCP connections могут завершить OAuth Authorization Code +
  S256 PKCE flow с существующим публичным `client_id`.
- Устаревший opaque callback перестаёт быть допустимым после reconciliation;
  старый коннектор не следует переподключать как fallback.
- OAuth scopes, refresh-token rotation, Person authorization и MCP tool policy
  не меняются.
- Staging deployment должен обновить Identity runtime и reconciliation
  contract до подключения нового коннектора.
- Callback остаётся non-secret environment configuration и не выводится в
  deployment diagnostics.

## Verification

- Unit tests принимают только точный стабильный callback и отклоняют HTTP,
  чужой origin, credentials, query, fragment и legacy opaque path.
- Deployment contract tests требуют тот же точный callback в controller и
  GitHub Actions validation.
- Identity tests подтверждают idempotent predefined-client reconciliation и
  неизменность scope/refresh policy.
- Staging OAuth authorization больше не возвращает redirect mismatch для
  нового коннектора.
- После consent новый ChatGPT connection обнаруживает полный deployed MCP
  catalog; smoke-проверка не выполняет write tools.

## Related material

- [Reconcile predefined OAuth clients during deployment](20260811-reconcile-predefined-oauth-clients-during-deployment.md)
- [Durable OAuth connections](20260810-require-offline-access-for-durable-oauth-connections.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [TASK-0058 implementation plan](../../plans/2026/08/2026-08-27-task-0058-stable-chatgpt-oauth-callback.md)
