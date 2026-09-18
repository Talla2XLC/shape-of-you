---
id: "decisions-20260918-preserve-stable-oauth-session-during-consent-reauthentication"
kind: adr
title: "Сохранять стабильную OAuth-сессию при повторной аутентификации consent"
status: accepted
date: 2026-09-18
supersedes: []
superseded_by: null
tags:
  - "authentication"
  - "identity"
  - "oauth"
  - "security"
  - "webauthn"
---

# Сохранять стабильную OAuth-сессию при повторной аутентификации consent

## Context

После добавления нового OAuth scope для `TASK-0119` живой ChatGPT connector
запросил повторный consent. У `oidc-provider` оставалась действующая provider
session, но host-only Shape of You browser-session отсутствовала. Identity
сначала возвращал `authentication_required`; исправление научило consent page
показывать passkey-вход и после него возвращаться к consent.

На staging это открыло второй дефект. Обычная passkey-аутентификация создавала
новую строку `oauth_sessions`, а pending consent interaction первоначально был
связан со старой строкой, которая уже владела provider UID и provider-cookie
credential. Перепривязка interaction к новой строке приводила при resume к
нарушению `oauth_sessions_provider_uid_uq` и `Internal Server Error` после
`Allow`.

Простой перенос только `provider_uid` и `provider_credential_hash` на новую
строку отклонён Quality и Architecture Review. Grants, session authorizations,
authorization codes и refresh-token families остаются связаны со старой
строкой; частичный перенос разрушает единый lifecycle session aggregate и
может сделать действующий refresh token неработоспособным без явной revocation
и audit evidence.

Решение должно сохранить принятую модель из
[typed Identity lifecycle ADR](20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md):
browser credential и provider credential адресуют один стабильный
`oauth_sessions` aggregate, а provider UID, grants и refresh-token families не
переезжают между session IDs неявно.

## Decision

При passkey-аутентификации, начатой с consent interaction без действующей
Shape of You browser-session, Identity обновляет browser authority внутри уже
существующего стабильного `oauth_sessions` aggregate этого interaction. Новая
параллельная session row для этого сценария не создаётся.

1. Consent page передаёт opaque interaction credential только в вызов
   WebAuthn verification, начатый из этого consent recovery flow. Обычный
   browser login и OAuth `login` prompt сохраняют существующий путь создания
   новой session.
2. После успешной проверки passkey Identity в одной транзакции находит exact
   pending, unexpired consent interaction по hash его credential, блокирует
   interaction и связанную session row и проверяет совпадение account.
3. Session должна быть active, unrevoked и unexpired. Interaction другого
   account, другого prompt, completed/abandoned или expired interaction
   отклоняется без раскрытия чужого состояния и без создания новой session.
4. В стабильной session ротируются только browser-facing authority:
   `credential_hash`, `csrf_token_hash`, binding к подтверждённому WebAuthn
   credential, `last_activity_at` и sliding `expires_at`. Старый browser
   credential немедленно становится недействительным.
5. `id`, `account_id`, `provider_uid`, `provider_credential_hash`, provider
   authentication timestamp, grants, session authorizations, authorization
   codes и refresh-token families сохраняются. Свежая passkey-проверка
   фиксируется существующим typed security event; она не переписывает
   историческое provider authentication time.
6. Новые browser и CSRF credentials генерируются криптографически и
   возвращаются только через существующие `__Host-` cookies/response contract;
   в PostgreSQL сохраняются только их SHA-256 hashes.
7. После reload consent page разрешает обычный session-bound CSRF submit.
   `bindOAuthInteractionSession` видит тот же стабильный session ID, а provider
   resume обновляет ту же provider session без смены aggregate ownership.
8. Любая ошибка после начала транзакции откатывает credential rotation.
   Одноразовый WebAuthn challenge и row locks сериализуют повторы; concurrent
   replay не создаёт вторую session и не меняет provider ownership.
9. Никакие cookies, tokens, interaction credentials или URL query не пишутся в
   логи. Runtime error остаётся структурированным и privacy-safe.

Решение уточняет, но не отменяет ADR 20260803: стабильный session aggregate
остаётся authority, а exact interaction даёт узкое доказательство того, какую
session разрешено повторно аутентифицировать.

## Considered alternatives

### Отменить consent и начать новый OAuth login

Сохраняет текущую модель хранения, но добавляет ещё один внешний reconnect и
зависит от того, как ChatGPT обработает `login_required` и очистку provider
cookie. Пользователь уже прошёл passkey, поэтому повторный цикл неоправдан и
хуже по надёжности.

### Перенести provider binding на новую session row

Потребовал бы атомарно переносить либо явно отзывать grants, session
authorizations, authorization codes, refresh-token families и audit relations.
Частичный перенос уже показал нарушение refresh lifecycle. Полный перенос
существенно сложнее и не даёт продуктовой пользы по сравнению с сохранением
стабильного aggregate.

### Оставить ручную очистку cookies как runbook

Обходит конкретное состояние, но перекладывает согласование двух session
lifecycle на пользователя и оставляет воспроизводимый production defect.
Отклонено как постоянное решение; до deployment исправления это допустимый
временный обход.

## Consequences

- Reconnect после истечения только Shape of You browser-session завершается в
  одном consent flow без потери provider session и refresh continuity.
- Generic passkey login и создание независимых browser sessions не меняются.
- Authentication verification получает узкий optional interaction context;
  его нельзя использовать как общий session selector.
- Ротация browser credential инвалидирует его предыдущую копию для этой
  session, что уменьшает риск session fixation.
- Реализация требует транзакционного ветвления и дополнительных security
  regression tests, но не требует миграции, нового deployable, env или ручной
  серверной операции.

## Verification

- Full OAuth browser test воспроизводит: действующая provider cookie, отсутствие
  browser cookie, consent prompt, passkey, reload, `Allow`, callback и code
  exchange.
- PostgreSQL integration подтверждает неизменность session ID, provider UID,
  provider credential, grants и refresh-token family после reauthentication.
- Старый browser credential отклоняется, новый credential и CSRF работают.
- Refresh token, выданный до reconnect, успешно проходит rotation после него.
- Tests отклоняют wrong-account, wrong-prompt, unknown, expired, completed и
  replayed interaction без частичных mutations.
- Concurrent verification создаёт ровно один успешный credential rotation и
  не создаёт дополнительную `oauth_sessions` row.
- Existing login, consent, deny, refresh reuse, revocation и recovery suites
  остаются зелёными.

## Related material

- [Typed Identity lifecycle](20260803-model-identity-protocol-state-in-typed-lifecycle-tables.md)
- [Passkey-bound sliding sessions](20260806-use-passkey-bound-sliding-identity-sessions.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [TASK-0119 feedback ADR](20260918-record-typed-daily-recommendation-feedback.md)
- [Implementation plan](../../plans/2026/09/completed/2026-09-18-task-0119-oauth-consent-session-recovery.md)
