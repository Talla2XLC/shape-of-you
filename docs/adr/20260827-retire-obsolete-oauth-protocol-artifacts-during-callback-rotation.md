---
id: "decisions-20260827-retire-obsolete-oauth-protocol-artifacts-during-callback-rotation"
kind: adr
title: "Инвалидировать одноразовые OAuth-артефакты при ротации callback"
status: accepted
date: 2026-08-27
supersedes: []
superseded_by: null
tags:
  - "authentication"
  - "deployment"
  - "identity"
  - "oauth"
  - "security"
---

# Инвалидировать одноразовые OAuth-артефакты при ротации callback

## Context

Deployment reconciliation хранит redirect allowlist предопределённого OAuth-
клиента как exact desired state. `oauth_interactions` и
`oauth_authorization_codes` ссылаются на конкретную пару
`client_id + redirect_uri` внешними ключами. Поэтому удаление устаревшего
callback блокируется, пока в базе остаются даже уже непригодные для нового
callback одноразовые protocol artifacts.

Перепривязка существующего interaction или authorization code к другому
callback нарушила бы OAuth redirect binding. Сохранение старого callback в
активном allowlist расширило бы redirect authority. Durable grants, sessions,
refresh-token families и security events не зависят от redirect row и не
должны сбрасываться из-за смены callback.

## Decision

При exact reconciliation сначала добавить все новые redirect URI, затем в той
же database transaction определить URI, отсутствующие в desired state.

Для каждого удаляемого URI инвалидировать и удалить только привязанные к нему
одноразовые protocol artifacts:

- authorization codes;
- interaction requested resources;
- interaction requested scopes;
- interactions.

После этого удалить устаревший redirect row. Не переносить эти артефакты на
новый callback и не оставлять legacy URI активным.

Не изменять grants, session authorizations, sessions, refresh-token families,
refresh tokens, security events, client scopes, Person authorization или
product data. Существующие внешние ключи и schema сохраняются; migration не
требуется. Любая ошибка откатывает ротацию и удаление артефактов целиком.

## Considered alternatives

- **Сохранить оба callback:** избегает удаления protocol artifacts, но
  продолжает доверять устаревшему redirect и противоречит exact allowlist.
  Отклонено.
- **Переписать callback в существующих interactions/codes:** сохраняет строки,
  но превращает выданный для одного redirect credential в credential другого
  redirect. Отклонено как нарушение OAuth binding.
- **Добавить lifecycle status к redirect rows:** сохраняет исторические строки
  и позволяет фильтровать active allowlist, но требует migration и новой
  lifecycle-модели ради транзитных protocol artifacts. Отложено.
- **Удалять весь client, grants или sessions:** устраняет ссылки, но разрушает
  durable authorization state без необходимости. Отклонено.

## Consequences

- Ротация callback может прервать только незавершённый flow, привязанный к
  старому URI; такой flow всё равно нельзя безопасно завершить через новый URI.
- Уже выданные refresh tokens, grants и browser sessions продолжают жить по
  своим существующим правилам.
- Security audit остаётся доступным независимо от удаления транзитных protocol
  rows.
- Reconciliation остаётся атомарным, idempotent и не требует schema migration.

## Verification

- Integration test создаёт interaction, requested scopes/resources и
  authorization code на старом URI, выполняет reconciliation и подтверждает их
  удаление вместе со старым allowlist row.
- Тот же test подтверждает сохранение grant, session, refresh-token family и
  security event.
- Transaction rollback test подтверждает, что последующая ошибка scope
  reconciliation восстанавливает callback-bound artifacts.
- Existing idempotency and concurrency tests остаются зелёными.

## Related material

- [Использовать стабильный OAuth callback платформы коннекторов ChatGPT](20260827-adopt-stable-chatgpt-connector-platform-oauth-callback.md)
- [Reconcile predefined OAuth clients during deployment](20260811-reconcile-predefined-oauth-clients-during-deployment.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [TASK-0060 implementation plan](../../plans/2026/08/2026-08-27-task-0060-oauth-callback-artifact-retirement.md)
