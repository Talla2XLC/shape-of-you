---
id: "decisions-20260827-use-person-bound-chatgpt-work-launcher"
kind: adr
title: "Открывать постоянный ChatGPT Work conversation через Person-bound launcher"
status: superseded
date: 2026-08-27
supersedes: []
superseded_by: "decisions-20260827-enforce-chatgpt-pro-authority-in-mcp"
tags:
  - "chatgpt"
  - "integration"
  - "mcp"
  - "oauth"
  - "routing"
  - "web"
---

# Открывать постоянный ChatGPT Work conversation через Person-bound launcher

## Context

Shape of You Staging MCP предоставляет 23 typed tools и является единственным
writer для staging PostgreSQL. Google Sheets Fitness Tracker после TASK-0067
остаётся non-authoritative read-only legacy reference. Технический MCP contract
работает, но его пользовательский вход зависит от знания внутренних поверхностей
ChatGPT: выбора Work, поиска app/plugin, «Попробовать в чате», `@mention` или
ручного перехода к конкретному разговору.

Старый project-chat `Трекер от 05.08` не поддерживает developer MCP и возвращает
`FORBIDDEN: This conversation does not support developer MCPs`. Он не может быть
runtime или fallback. Отдельный закреплённый Work conversation
`Фитнес-трекер — основной` уже показывает `Shape of You Staging` как
прикреплённый source и сохраняет один dialogue history для последовательных
сообщений.

Прямая ссылка на один conversation решает демонстрацию для одного аккаунта, но
не является production-ready multi-Person contract. Conversation принадлежит
внешнему ChatGPT account и не должен попадать в публичный static Web bundle,
deployment-wide config или fitness-domain authority. Создание собственной chat
платформы только ради входа потребовало бы владения conversation persistence,
streaming, model/tool orchestration, approvals, moderation и эксплуатацией.

Правила PostgreSQL authority также нельзя оставлять только в историческом
сообщении. Постоянный Work source должен применять их как durable task/source
contract или как plugin skill, связанный с существующим MCP server.

## Decision

Использовать один постоянный ChatGPT Work conversation на Person и открывать его
одним authenticated действием из Shape of You Web.

Добавить в существующую API PostgreSQL database typed entity
`ChatAssistantConversationBinding` со следующими полями и invariants:

- `id` — UUID;
- `personId` — обязательная ссылка на API-owned `Person`;
- `surface` — controlled enum с начальным значением `chatgpt_work`;
- `externalConversationId` — opaque identifier без полного arbitrary URL;
- `status` — `active` или `disabled`;
- `createdAt` и `updatedAt`;
- не более одного active binding для `(personId, surface)`;
- conversation identifier должен формировать только allowlisted URL вида
  `https://chatgpt.com/c/{id}`.

Binding принадлежит API integration module, а не fitness bounded context и не
Identity service. Он не хранит OAuth token, credential, chat content, MCP tool
result или fitness fact. Создание, замена и disable binding выполняются через
отдельную API-owned operational command под operator control; обычный launcher
только читает active binding.

Добавить authenticated API launcher endpoint. Он разрешает текущего `Person`
через существующую browser session, читает active binding и отвечает external
redirect только на сформированный allowlisted ChatGPT URL. Missing, disabled,
ambiguous или malformed binding завершается fail closed: browser navigation
возвращается на allowlisted same-origin `/progress` с controlled reason code,
который Web показывает как понятный stop state. API clients могут получить тот
же typed error через content negotiation. Ни один failure не раскрывает
conversation ID и не создаёт новый чат.

Static Shape of You Web добавляет одну явную кнопку `Открыть Shape of You
Coach`, ведущую на same-origin launcher endpoint. Web не хранит conversation ID,
не строит ChatGPT URL, не получает OAuth credentials и не встраивает chat UI.

Target Work conversation один раз provisioned и закреплён. В нём постоянно
прикреплён Shape of You MCP/source. Durable source contract или plugin skill
применяет следующие правила:

- staging PostgreSQL через `Shape of You Staging` MCP — operational authority;
- MCP — единственный writer;
- Google Sheets — только non-authoritative read-only legacy reference;
- Google Sheets writes, fallback, reverse sync, archive/delete и ACL changes
  запрещены;
- current-state и write requests требуют MCP discovery;
- write использует только typed MCP tool после native confirmation;
- успешный write требует typed read-back по returned identifier;
- missing MCP, OAuth failure, cancelled confirmation или inconsistent read-back
  завершается понятным stop state без альтернативного writer и без нового чата.

Существующий OAuth 2.1 contract, `offline_access`, rotating refresh tokens,
stable callback, Person authorization, resource, issuer, audience, expiry и
scope validation сохраняются. TASK-0068 проверяет refresh и reconnect UX в том
же разговоре, но не вводит второй OAuth client и не хранит token в binding.

## Considered alternatives

- **Использовать только закреплённый Work conversation:** сохраняет один
  dialogue и source, но не даёт понятного entrypoint из продукта и заставляет
  пользователя искать разговор. Отклонено как самостоятельное решение;
  сохранено как runtime часть выбранного варианта.
- **Hardcode один ChatGPT URL в static Web или deployment config:** минимально
  для single-user демонстрации, но раскрывает Person-specific external handle,
  ошибочно делит его между пользователями и смешивает user state с deployment
  config. Отклонено.
- **Использовать только Plugin/App directory entrypoint:** удобно упаковывает
  MCP и skill, но документированный first-use flow включает install/selection
  или `@mention` и не гарантирует возврат в один conversation. Отклонено как
  пользовательский entrypoint; plugin допустим как внутренняя упаковка
  постоянного source contract.
- **Вернуться в project-chat:** текущая поверхность явно запрещает developer
  MCP. Отклонено; fallback на несовместимый chat запрещён.
- **Создать собственный chat UI на Responses API или ChatKit:** даёт полный
  контроль, но преждевременно добавляет chat persistence, orchestration,
  approvals и эксплуатационную поверхность. Отклонено до отдельной доказанной
  продуктовой потребности.
- **Хранить binding в Identity service:** conversation относится к
  Person-facing product integration, не к authentication protocol state.
  Перенос создал бы cross-service coordination без security-преимущества.
  Отклонено.

## Consequences

- Обычный пользователь входит в существующий Shape of You Web и одним действием
  продолжает тот же Work conversation без поиска plugin, `@mention` и перехода
  между чатами.
- Один небольшой Person-owned integration binding добавляет migration,
  repository, application service, operational command и HTTP contract внутри
  существующего API deployable.
- Static Web остаётся presentation-only и не получает backend, secret или
  external conversation state.
- ChatGPT остаётся владельцем dialogue history, а PostgreSQL — владельцем
  fitness facts. Conversation text не становится source of truth.
- MCP/plugin platform остаётся внешней beta surface; изменения поддержки Work
  source должны проявляться как fail-closed error, а не скрытый fallback.
- Initial provisioning или replacement внешнего conversation binding остаётся
  operator-controlled operation. Ежедневный пользовательский сценарий не
  содержит provisioning шагов.
- Google Sheets остаётся бессрочным legacy reference. Его архивирование,
  удаление и ACL changes не являются частью roadmap или этого решения.

## Verification

- Migration tests создают entity из каждого historical prefix, проверяют
  foreign key, enum values, partial uniqueness и PostgreSQL identifiers не
  длиннее 63 UTF-8 bytes.
- Repository/integration tests доказывают Person isolation, единственный active
  binding, deterministic missing/disabled/malformed failures и отсутствие
  arbitrary external redirect.
- HTTP tests подтверждают browser-session authorization, `Cache-Control:
  no-store`, allowlisted `https://chatgpt.com/c/{id}` success redirect,
  allowlisted same-origin failure redirect, typed API error и отсутствие
  conversation ID в unauthenticated или fail-closed response.
- Web unit/browser E2E проверяют одну keyboard-accessible launcher-кнопку,
  authenticated navigation и понятные missing/disabled errors без нового chat
  UI или публичного hardcoded URL.
- Live ChatGPT acceptance в одном conversation проверяет MCP discovery, typed
  read, два последовательных follow-up, reload, повторный launcher open и
  OAuth refresh без ручного app selection.
- После отдельного operator approval bounded staging canary проходит
  `entrypoint → discovery → read → confirmed write → read-back`.
- Failure matrix проверяет MCP unavailable, revoked refresh, cancelled write и
  inconsistent read-back. Каждый сценарий fail closed, не использует Google
  Sheets и не создаёт новый conversation.
- Independent Quality и Architecture Review подтверждают отсутствие нового
  deployable, собственной chat platform, duplicated authority, cross-service
  SQL и преждевременной сложности.

## Related material

- [TASK-0068 plan](../../plans/2026/08/2026-08-27-task-0068-production-ready-chatgpt-mcp-ux.md)
- [Durable OAuth connections](20260810-require-offline-access-for-durable-oauth-connections.md)
- [Stable ChatGPT callback](20260827-adopt-stable-chatgpt-connector-platform-oauth-callback.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [Source of truth and authority](../wiki/data/source-of-truth-and-authority.md)
- [OpenAI plugin architecture](https://developers.openai.com/plugins/concepts/plugins)
- [OpenAI plugin authentication](https://developers.openai.com/plugins/build/auth)
