---
id: "decisions-20260825-issue-refresh-tokens-by-registered-client-policy"
kind: adr
title: "Выдавать refresh token по зарегистрированной политике OAuth-клиента"
status: accepted
date: 2026-08-25
supersedes: ["decisions-20260810-require-offline-access-for-durable-oauth-connections"]
superseded_by: null
tags:
  - "authentication"
  - "chatgpt"
  - "identity"
  - "mcp"
  - "oauth"
  - "security"
---

# Выдавать refresh token по зарегистрированной политике OAuth-клиента

## Context

Predefined ChatGPT MCP client зарегистрирован как public OAuth client с
`refreshTokensEnabled = true`, rotating refresh tokens, S256 PKCE и
десятиминутным access token. Предыдущее решение дополнительно требовало, чтобы
внешний клиент явно запросил OIDC scope `offline_access`.

Проверка живого staging-соединения показала несовместимость этого требования с
фактическим ChatGPT connector workflow. Активный grant содержит разрешённые MCP
resource scopes, но не содержит `offline_access`. В Identity при этом нет
активной refresh-token family. После истечения десятиминутного access token
ChatGPT вынужден повторно запускать интерактивную авторизацию. Google Drive и
другие managed connectors не демонстрируют такой UX, потому что их durable
credential lifecycle управляется connector platform.

Отсутствие `offline_access` в protected-resource metadata корректно:
metadata MCP resource должна перечислять resource permissions, а не OIDC
protocol scopes. Shape of You не может заставить внешний connector добавить
scope, которого нет в его authorization request. Увеличение access-token TTL
только отложит повторный login и ухудшит безопасность bearer credential.

## Decision

Считать зарегистрированную typed client policy
`oauth_clients.refresh_tokens_enabled` единственным серверным разрешением на
выдачу rotating refresh token при authorization-code exchange. Активный public
client с этой capability получает refresh token независимо от присутствия
`offline_access` в requested scopes. Client с capability `false` refresh
token не получает.

`offline_access` остаётся поддержанным и allowlisted OIDC scope для клиентов,
которые умеют его запрашивать. Он продолжает храниться отдельно от resource
permissions, но больше не является обязательным условием refresh issuance.
Consent page для refresh-enabled client явно показывает
`Keep this connection active`, даже когда внешний request не содержит
`offline_access`, чтобы долговременность доступа не была скрытой.

Сохранить без изменений:

- десятиминутный audience-bound ES256 access token;
- S256 PKCE, exact redirect URI и exact client/scope allowlists;
- 30-дневные session-bound rotating refresh-token families;
- resource, client, session и grant binding;
- one-time rotation, reuse detection, revocation и security audit;
- отсутствие refresh token у `shape-of-you-web-staging`;
- resource-only MCP protected-resource metadata.

Решение не добавляет endpoint, schema migration, DCR, CIMD, client secret,
долгоживущий access token или новый deployable.

## Considered alternatives

- **Сохранить обязательный `offline_access`:** уже приводит к повторной
  авторизации живого ChatGPT connector после истечения access token. Отклонено
  по фактическому interoperability evidence.
- **Добавить `offline_access` в MCP protected-resource metadata:** смешивает
  protocol scope с resource permissions и расширяет неверный contract.
  Отклонено.
- **Незаметно дописывать `offline_access` в authorization request:** сервер
  не должен изменять запрошенный клиентом scope set. Отклонено.
- **Увеличить или отменить access-token TTL:** увеличивает окно компрометации и
  не создаёт корректный renewable lifecycle. Отклонено.
- **Сделать исключение по строковому ChatGPT client ID:** дублирует уже
  существующую typed capability. Отклонено в пользу общей зарегистрированной
  policy для refresh-enabled public clients.

## Consequences

- ChatGPT может обновлять access token без повторного passkey/consent flow.
- Администраторская client registration, а не поведение внешнего клиента,
  определяет допустимость долговременного доступа.
- Пользователь видит долговременность на consent screen.
- `offline_access` остаётся interoperable signal, но не security gate.
- Ошибочная выдача refresh token refresh-disabled Web client считается
  регрессией и блокируется integration tests.
- Existing grants не требуют schema migration; новое authorization-code
  exchange создаёт новую refresh-token family по текущей client policy.

## Verification

- End-to-end OAuth test выполняет ChatGPT-shaped authorization request без
  `offline_access`, получает refresh token и сохраняет только реально
  requested OIDC/resource scopes.
- Тест пересекает access-token renewal boundary через refresh grant, проверяет
  rotation и отклонение повторного использования старого credential.
- Consent test подтверждает `Keep this connection active` для
  refresh-enabled client без requested `offline_access`.
- Web OAuth test подтверждает отсутствие refresh token.
- Discovery и MCP metadata tests сохраняют разделение protocol и resource
  scopes.

## Related material

- [Superseded explicit offline-access decision](20260810-require-offline-access-for-durable-oauth-connections.md)
- [Predefined OAuth client reconciliation](20260811-reconcile-predefined-oauth-clients-during-deployment.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [TASK-0051 plan](../../plans/2026/08/completed/2026-08-25-task-0051-durable-chatgpt-oauth-refresh.md)
