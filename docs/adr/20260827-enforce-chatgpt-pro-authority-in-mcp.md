---
id: "decisions-20260827-enforce-chatgpt-pro-authority-in-mcp"
kind: adr
title: "Обеспечить authority и fail-closed contract в MCP для ChatGPT Pro"
status: accepted
date: 2026-08-27
supersedes: ["decisions-20260827-use-person-bound-chatgpt-work-launcher"]
superseded_by: null
tags:
  - "chatgpt"
  - "integration"
  - "mcp"
  - "oauth"
  - "routing"
  - "web"
---

# Обеспечить authority и fail-closed contract в MCP для ChatGPT Pro

## Context

Первоначальное решение предполагало, что постоянный ChatGPT Work conversation
или его source сможет хранить durable authority/fail-closed instructions.
Read-only проверка существующего закреплённого conversation подтвердила
сохранение режима Work, `Shape of You Staging` source, одного URL и dialogue
history после reload. Последующий confirmed canary без `@mention` обнаружил 23
typed tools, выполнил read, остановился на native confirmation, сделал ровно
один staging write и подтвердил его typed read-back.

Однако текущая ChatGPT Pro surface не предоставляет builder, durable
instructions или tool-policy controls для этого conversation. Официальный
ChatGPT contract относит durable instructions, custom MCP attachment, write
approval policy и connector constraints к Workspace Agents. Live `/agents`
для текущего аккаунта показывает, что Workspace Agents недоступны и требуют
eligible Business, Enterprise, Edu или Teachers workspace. Обычный chat source
или сообщение в history нельзя считать системной policy.

Переход на платный managed workspace не является минимальным продуктовым
решением TASK-0068. Создание собственного chat runtime остаётся преждевременным.
При этом data integrity можно гарантировать независимо от поведения модели:
API-owned MCP уже является единственным интерактивным writer и вызывает только
Person-scoped PostgreSQL-backed domain services.

## Decision

Сохранить существующий постоянный ChatGPT Work conversation и утверждённый
Person-bound Web launcher. Не создавать новый chat, Workspace Agent,
микросервис или собственную chat-платформу.

Перенести durable authority/fail-closed contract в существующий API-owned MCP
boundary:

- MCP initialization публикует protocol-native `instructions` о том, что
  PostgreSQL является operational authority, MCP — единственным interactive
  writer, а Google Sheets — non-authoritative read-only legacy reference;
- каждое из 23 tool descriptions повторяет короткий authority/fail-closed
  invariant, поэтому contract доступен клиенту при discovery;
- tool names, input/output schemas, OAuth scopes и число tools не меняются;
- MCP adapter композиционно имеет доступ только к Person-scoped domain
  services и не получает Google Sheets writer или fallback dependency;
- authorization failure, отсутствующий tool и domain failure возвращают typed
  MCP error и не переключаются на другой источник;
- write tools сохраняют write annotations, которые позволяют ChatGPT запросить
  confirmation; runtime instructions рекомендуют typed read-back успешной
  записи. Confirmation и read-back остаются client behavior, а не server
  invariant.

Work conversation остаётся UX и dialogue owner, но его текст не является
authority. Empirically persisted source используется как удобный entrypoint;
целостность данных зависит только от server-side contracts. После deployment
существующий connector должен быть refreshed, чтобы ChatGPT принял обновлённые
instructions/descriptions без создания нового conversation или OAuth client.

OAuth 2.1, `offline_access`, rotating refresh tokens, stable callback, Person
authorization и scope validation остаются без изменений. Launcher binding не
хранит token, chat content или fitness facts.

## Considered alternatives

- **Создать Workspace Agent:** даёт лучший durable prompt/tool policy contract,
  но недоступен на текущем ChatGPT Pro и требует смены workspace/тарифа и
  one-time migration. Отклонено для TASK-0068; допустимо как будущее отдельное
  решение после подтверждённой продуктовой необходимости.
- **Положить правила в сообщение или source file:** сохраняется рядом с chat,
  но не имеет системного приоритета и не гарантирует применение. Отклонено как
  authority mechanism.
- **Полагаться только на tool descriptions:** помогает модели, но без
  server-side Person/OAuth/domain boundary не гарантирует data integrity.
  Используется только вместе с существующим enforcement.
- **Собственный chat runtime:** даёт полный контроль, но добавляет model
  orchestration, persistence, approvals, moderation и эксплуатацию. Отклонено.
- **Перейти на другой новый chat:** не создаёт durable policy и нарушает цель
  постоянного разговора. Отклонено.

## Consequences

- Пользователь продолжает один закреплённый conversation без plugin search,
  «Попробовать в чате», `@mention` и ежедневного выбора source.
- Data authority и запрет Sheets fallback проверяемы в коде и не зависят от
  history или послушности модели.
- ChatGPT Pro/Work остаётся внешней evolving surface. MCP instructions повышают
  consistency, но не превращают Pro chat в управляемый Workspace Agent.
- Изменение metadata потребует refresh существующего connector после staging
  deployment; новые tool contracts или OAuth reconnect не требуются, если
  platform принимает backward-compatible refresh.
- Переход на Workspace Agent остаётся возможным позднее без изменения fitness
  domain, PostgreSQL authority или launcher abstraction.

## Verification

- Unit test проверяет protocol `initialize.result.instructions`.
- `tools/list` возвращает ровно 23 tools, неизменные schemas/scopes и authority
  guidance prefix в каждом description.
- Existing authorization и domain-error tests доказывают fail-closed behavior
  без обращения к Google Sheets.
- Launcher unit/integration/browser tests сохраняют Person isolation,
  allowlisted redirect, no-store и controlled same-origin failure UX.
- Live acceptance после deployment и connector refresh проходит в том же
  conversation: launcher, discovery, read, native-confirmed write и read-back.
- OAuth expiry/refresh и revocation проверяются без чтения credentials; revoked
  access останавливается fail closed и не включает fallback.
- Independent Architecture и Quality Reviews проверяют отсутствие нового
  deployable, duplicated authority и непринятого chat/workspace expansion.

## Related material

- [Superseded launcher decision](20260827-use-person-bound-chatgpt-work-launcher.md)
- [TASK-0068 plan](../../plans/2026/08/completed/2026-08-27-task-0068-production-ready-chatgpt-mcp-ux.md)
- [Durable OAuth connections](20260810-require-offline-access-for-durable-oauth-connections.md)
- [Stable ChatGPT callback](20260827-adopt-stable-chatgpt-connector-platform-oauth-callback.md)
- [OpenAI Workspace Agents](https://help.openai.com/en/articles/20001143)
- [OpenAI developer mode and MCP apps](https://help.openai.com/en/articles/12584461)
