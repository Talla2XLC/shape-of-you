---
id: "decisions-20260828-keep-daily-coach-protocol-portable-across-approved-mcp-clients"
kind: adr
title: "Сохранить Daily Coach protocol переносимым между одобренными MCP clients"
status: accepted
date: 2026-08-28
supersedes: []
superseded_by: null
tags:
  - "chatgpt"
  - "coaching"
  - "mcp"
  - "oauth"
  - "providers"
---

# Сохранить Daily Coach protocol переносимым между одобренными MCP clients

## Context

Web открывает один постоянный Person-bound ChatGPT Work conversation через
server-owned `chatgpt_work` launcher. Это даёт удобный one-click сценарий, но
может создавать ложное впечатление, что состояние Coach принадлежит этому
чату. Пользователь может начать новый ChatGPT conversation или выбрать другого
AI provider, однако такие sessions не разделяют chat history, connector state,
OAuth authorization или native tool behavior.

PostgreSQL через Shape of You API и typed MCP tools остаётся operational
authority и единственным interactive writer. Daily Coach уже обязан начинать с
`get_daily_projection`, использовать bounded typed reads, разделять `Planned`,
`Proposed now` и `Actually completed`, подтверждать writes и выполнять typed
read-back. Поэтому данные дня не требуют синхронизации conversations.

Поддержка произвольного provider не может следовать только из совместимости с
чатом. Необходимо отдельно доказать remote MCP transport, OAuth redirect и
resource behavior, scopes, native confirmation UX, tool annotations, read-back
и fail-closed обработку ошибок. На сегодня такая проверка и OAuth registration
выполнены только для существующей ChatGPT Work integration.

## Decision

Считать Daily Coach interaction protocol provider- и session-neutral, пока он
исполняется одобренным MCP client поверх неизменных API-owned instructions,
typed tool contracts и PostgreSQL authority.

Каждая новая conversation или provider session независимо восстанавливает
current state:

1. получает точные Person-local `localDate` и IANA `timezone`;
2. первым authoritative read вызывает `get_daily_projection`;
3. выполняет только необходимые typed MCP reads;
4. не использует прежний chat history как факт, память или fallback;
5. выполняет write только существующим typed MCP tool после корректного native
   confirmation и завершает его owning-domain typed read-back.

Conversation text, provider memory и cross-provider transcript sync не входят
в систему authority. Token или authorization одной integration никогда не
передаются другому client или provider.

Существующий `chatgpt_work` launcher остаётся неизменной и единственной
поддержанной one-click Coach surface. Не обобщать `ChatAssistantSurface`, URL
builders или conversation bindings и не добавлять provider selector, generic
launcher, OAuth client, callback, secret, database, deployable или собственный
chat UI в рамках этого решения.

Подключение каждого нового provider является отдельной архитектурной и
delivery-задачей. До регистрации OAuth client или изменения Web оно должно
пройти capability probe, который подтверждает:

- совместимый remote MCP transport и tool discovery;
- точные OAuth authorization, PKCE, callback, resource и scope contracts;
- refresh behavior, если он требуется выбранному client;
- native mutation confirmation и корректное использование tool annotations;
- typed write и owning-domain read-back без скрытого retry или duplicate write;
- fail-closed поведение при missing/stale/closed day, MCP и OAuth failure.

OAuth client и callbacks регистрируются отдельно для конкретного одобренного
client только после operator approval. До этого provider считается
unsupported и не получает доступ, launcher или fallback. Google Sheets и chat
history не используются как alternative authority при любой ошибке.

## Considered alternatives

- **Оставить только один постоянный ChatGPT conversation.** Минимальная
  стоимость и лучший текущий one-click UX, но архитектура оставалась бы
  неясной для новых chats и создавала бы впечатление chat-owned state.
- **Provider-neutral protocol с отдельным approval каждого MCP client
  (выбрано).** Сохраняет authority и текущие boundaries без нового runtime.
  Цена — отсутствие one-click launcher для внешнего provider до отдельной
  интеграционной задачи.
- **Multi-provider launcher registry.** Provider selector, generic bindings и
  отдельные OAuth clients дали бы единый Web entry point, но заранее добавили
  бы schema, callback, ambiguity и lifecycle complexity без подтверждённого
  второго provider.
- **Собственный chat gateway или UI.** Нормализовал бы providers, но создал бы
  новую deployable, auth и conversation-persistence boundary, дублировал бы
  vendor chat capabilities и нарушил бы текущий product scope.

## Consequences

- Новый ChatGPT conversation может быть Coach client только когда пользователь
  явно выбирает доступный Shape of You MCP connector и проходит его OAuth;
  прежний conversation не переносит туда state автоматически.
- External provider получает поддержку только после отдельного capability
  evidence и approval; данный ADR не утверждает совместимость DeepSeek или
  другого конкретного provider.
- Current facts и completion одинаково восстанавливаются из typed reads во
  всех одобренных sessions; natural-language wording и неперсистентные
  proposals могут различаться.
- Нет cross-provider conversation continuity. Это осознанная граница, которая
  исключает новую chat platform и не смешивает provider memory с domain facts.
- Не добавляются entity, schema, service, database, OAuth client, secret или
  deployment boundary.

## Verification

- Canonical docs явно различают текущий ChatGPT-only launcher и переносимый
  protocol contract.
- Capability checklist не позволяет объявить provider supported до проверки
  MCP, OAuth, scopes, confirmation, read-back и fail-closed behavior.
- Existing MCP contract tests продолжают закреплять projection-first reads,
  PostgreSQL authority, confirmation/read-back и no-Sheets fallback.
- Independent Quality Review проверяет отсутствие неподтверждённых promises и
  смешения current implementation с future provider onboarding.
- Architecture Review проверяет отсутствие generic launcher, cross-provider
  history sync, нового deployable и дублирования authority.

## Related material

- [Daily Coach over existing MCP tools](20260827-orchestrate-daily-coach-over-existing-mcp-tools.md)
- [ChatGPT Pro MCP authority](20260827-enforce-chatgpt-pro-authority-in-mcp.md)
- [Stable ChatGPT connector callback](20260827-adopt-stable-chatgpt-connector-platform-oauth-callback.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [TASK-0074 plan](../../plans/2026/08/completed/2026-08-28-task-0074-provider-portable-daily-coach.md)
