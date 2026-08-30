---
id: "decisions-20260830-retire-contracted-oauth-scopes-during-client-reconciliation"
kind: adr
title: "Транзакционно отзывать OAuth-авторизации при сокращении scope-контракта"
status: accepted
date: 2026-08-30
supersedes: []
superseded_by: null
tags:
  - "deployment"
  - "identity"
  - "oauth"
  - "operations"
  - "security"
---

# Транзакционно отзывать OAuth-авторизации при сокращении scope-контракта

## Context

TASK-0079 удаляет `day-closure:write` из предопределённого ChatGPT OAuth-
клиента. Identity reconciliation хранит scope allowlist как exact desired
state, но существующие grants и незавершённые interactions ссылаются на
`oauth_client_allowed_scopes` внешними ключами. Текущая реализация пытается
сразу удалить retired scope и закономерно останавливает deployment на FK.

Сокращение allowlist отличается от обычного изменения client metadata:
существующая внешняя авторизация была выдана для более широкого контракта.
Сохранить её как активную после сокращения нельзя, а переписать grant на более
узкий набор scopes без нового consent означало бы менять уже данное
пользователем разрешение. Одноразовый SQL cleanup обошёл бы Identity lifecycle
и не сделал бы последующие сокращения повторяемыми.

При этом не требуется новый deployable, database, OAuth client или lifecycle-
таблица. Все зависимые protocol artifacts принадлежат существующему Identity
bounded context, а reconciliation уже выполняется под client lock и database
transaction до замены runtime.

## Decision

Расширить exact reconciliation предопределённого OAuth-клиента явной операцией
scope retirement. В существующей transaction и под существующей сериализацией
сначала вычислять `current scopes - desired scopes`. Если множество пусто,
поведение остаётся прежним и не создаёт `updated_at` churn.

Для каждого retired scope до удаления allowlist row выполнить следующий
порядок:

1. Определить grants данного client, чьи OIDC или resource scope rows содержат
   любой retired scope, и interactions, которые запрашивают такой scope.
2. Удалить authorization codes, которые относятся к затронутым grants либо
   содержат retired scope в `issued_scopes`. Удалить затронутые interactions
   вместе с requested scope/resource child rows: продолжать такой flow после
   сокращения authority нельзя.
3. Отозвать затронутые grants, связанные session authorizations, refresh-token
   families и все tokens этих families. Использовать `coalesce` и тот же
   family-before-token lock order, что и существующий OAuth adapter.
4. Удалить только retired scope rows из grant scope children, необходимые для
   снятия FK-зависимости. Сами revoked grant rows сохранить как lifecycle
   evidence.
5. Удалить retired client allowlist rows и продолжить обычную reconciliation.

Вся последовательность атомарна: любая ошибка откатывает revocation, cleanup и
client reconciliation. Повторный запуск idempotent. Итоговый credential-free
summary сообщает только client result; URI, scopes конкретного пользователя,
tokens, credentials и пользовательские данные не выводятся.

Не отзывать Identity browser session, не менять account, Person authorization,
fitness/product data, security events и grants других clients. Уже выпущенный
stateless access token не хранится в Identity и живёт только до своего короткого
expiry; новый API runtime при этом уже не публикует удалённый tool. Повторная
авторизация внешнего connector обязательна для получения grant текущего scope-
контракта.

Release, сокращающий OAuth client contract, объявляет
`identity_oauth_clients_backward_compatible: false`. Поэтому автоматический
rollback на предыдущий Identity image после успешной reconciliation запрещён:
старый runtime ожидает более широкий client contract. Staging deployment и
последующий OAuth reconnect остаются отдельными operator gates.

## Considered alternatives

- **Одноразово удалить зависимые строки SQL-командой на staging:** быстро
  разблокирует текущий release, но обходит Identity ownership, плохо повторяется
  и оставляет тот же дефект для следующего scope contraction. Отклонено.
- **Вернуть `day-closure:write` в allowlist как inert compatibility scope:**
  сохраняет старые grants и deployability, но продолжает рекламировать
  удалённую authority и расходится с принятым TASK-0079 contract. Отклонено.
- **Молча сузить существующие grants:** уменьшает число reconnects, но меняет
  durable consent без нового authorization flow и скрывает breaking contract
  transition. Отклонено.
- **Удалить весь OAuth client либо все browser sessions:** снимает FK, но
  уничтожает несвязанный durable state и расширяет blast radius. Отклонено.
- **Добавить версии client policy и отдельный lifecycle schema:** может хранить
  полную историю scope sets, но требует migration и новой модели для операции,
  которую существующие grants и revocation state уже выражают. Отложено до
  появления нескольких одновременно поддерживаемых client-policy versions.

## Consequences

- Любое сокращение predefined-client scopes становится повторяемой, fail-closed
  Identity operation вместо ручной коррекции базы.
- Затронутые внешние OAuth connections перестают refresh-иться и требуют нового
  consent; это ожидаемая цена breaking scope contraction.
- Identity browser login и пользовательские/product данные сохраняются.
- Незавершённые flows и authorization codes старого контракта инвалидируются.
- Security-event audit и revoked grant lifecycle evidence сохраняются, но
  retired scope child rows удаляются из-за существующего FK design.
- Schema migration и новые operational boundaries не требуются.
- После успешной reconciliation автоматический rollback на несовместимый старый
  Identity runtime запрещён и требует operator-led recovery.

## Verification

- Integration test строит active и historical grants, session authorization,
  refresh families/tokens, interaction и authorization code с retired scope;
  reconciliation отзывает/удаляет только перечисленные зависимые artifacts и
  затем сокращает allowlist.
- Тест подтверждает сохранение account, browser session, security events,
  unaffected scopes, grants других clients и unrelated grant того же client.
- Failure injection после retirement подтверждает полный transaction rollback.
- Exact repeat подтверждает idempotency и отсутствие `updated_at` churn.
- Concurrent reconciliation подтверждает существующую serialization и lock
  order без deadlock.
- Unit и deployment-contract tests проверяют credential-free summary,
  predefined manifest и обязательное
  `identity_oauth_clients_backward_compatible: false` для этого release.
- После отдельно утверждённого staging deployment read-only verification
  подтверждает новый release, сокращённый tool/scope catalog и необходимость
  OAuth reconnect; write E2E выполняется только по отдельному разрешению.

## Related material

- [Reconcile predefined OAuth clients during deployment](20260811-reconcile-predefined-oauth-clients-during-deployment.md)
- [Инвалидировать одноразовые OAuth-артефакты при ротации callback](20260827-retire-obsolete-oauth-protocol-artifacts-during-callback-rotation.md)
- [Удалить закрытие дня и перейти к capture-first Coach](20260829-remove-day-closure-and-use-capture-first-coach.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [TASK-0080 implementation plan](../../plans/2026/08/2026-08-30-task-0080-oauth-scope-retirement.md)
