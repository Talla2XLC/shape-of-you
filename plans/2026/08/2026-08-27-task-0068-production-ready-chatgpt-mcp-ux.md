# TASK-0068 — Production-ready ChatGPT MCP UX без переходов между чатами

## Статус и архитектурный gate

- Статус: Pro-compatible архитектура и developer plan одобрены оператором
  2026-08-27; accepted superseding ADR:
  `docs/adr/20260827-enforce-chatgpt-pro-authority-in-mcp.md`.
- Локальная implementation и confirmed staging canary завершены; independent
  reviews отклоняют completion до deployment, connector refresh и live
  launcher/OAuth failure acceptance.
- Отдельно разрешённый staging canary исчерпан ровно одним write. Production,
  Google Sheets writes, ACL/archive changes, commit, push, secrets и OAuth
  credentials остаются запрещены без следующего явного gate.

## Проблема

Рабочий `Shape of You Staging` MCP уже предоставляет 23 typed tools и является
единственным writer для staging PostgreSQL. Но пользовательский вход в продукт
зависит от знания внутренних механизмов ChatGPT: нужной поверхности, плагина,
кнопки «Попробовать в чате», `@mention` или конкретного разговора. Старый
project-chat `Трекер от 05.08` не поддерживает developer MCP и возвращает
`FORBIDDEN: This conversation does not support developer MCPs`.

Нужен один понятный вход в Shape of You, после которого пользователь всегда
продолжает один и тот же разговор с автоматически доступным MCP и не может
случайно записать данные через legacy Google Sheets.

## Подтверждённые ограничения и наблюдения

1. Старый ChatGPT project-chat не является допустимой MCP-поверхностью для
   этого сценария; его нельзя использовать как fallback.
2. Закреплённый ChatGPT Work-разговор
   `https://chatgpt.com/c/6a904105-5110-83ed-a4c7-1da7dfd81d81`
   существует, называется `Фитнес-трекер — основной` и показывает
   `Shape of You Staging` в постоянном списке источников.
3. В этом же разговоре уже прошла последовательность нескольких сообщений без
   повторного выбора MCP: read/recommendation → план тренировки → несколько
   follow-up результатов. Это подтверждает continuity разговора, но ещё не
   заменяет целевой E2E с подтверждённой записью и read-back.
4. Официальный OpenAI ChatGPT app contract применяет app selection к отдельному
   сообщению; обычный app/plugin entrypoint сам по себе не удовлетворяет
   требованию одного постоянного разговора без повторного выбора.
5. Durable instructions, custom MCP attachment, write approvals и connector
   constraints доступны в Workspace Agents, но live `/agents` подтверждает,
   что текущий ChatGPT Pro не является eligible managed workspace. Поэтому
   текущий scope использует MCP protocol guidance и server-side data boundary.
6. OAuth должен оставаться OAuth 2.1 MCP contract с проверкой token issuer,
   audience, expiry и scopes на каждом вызове. Текущий проект уже имеет
   `offline_access`, rotating refresh tokens и стабильный ChatGPT callback;
   TASK-0068 проверяет эту границу, но не читает и не меняет credentials.

Официальные источники:

- https://help.openai.com/en/articles/12584461
- https://help.openai.com/en/articles/20001143

## Варианты

### Вариант A — постоянный ChatGPT Work task как единственная runtime-поверхность

Пользователь продолжает существующий закреплённый Work-разговор. Один раз к
нему привязывается Shape of You source; далее source сохраняется при
reload и повторном открытии.

Плюсы:

- уже подтверждён на текущем аккаунте и не требует новой chat-платформы;
- один conversation history и естественные follow-up сообщения;
- MCP виден как постоянный источник, без повторного выбора на каждом сообщении;
- сохраняет нативные подтверждения ChatGPT для write actions.

Минусы:

- сам по себе не даёт вход из Shape of You Web;
- точный разговор является внешним пользовательским ресурсом ChatGPT;
- правила authority нельзя оставлять только в старом сообщении: на ChatGPT Pro
  они должны публиковаться MCP server через protocol instructions и tool
  metadata, а data integrity должна обеспечиваться server-side;
- если ChatGPT изменит поддержку source для Work, нужен явный fail-closed UX.

### Вариант B — launcher/deep link из Shape of You Web

Authenticated Web показывает одну кнопку `Открыть Shape of You Coach`. Backend
разрешает Person-owned binding и перенаправляет в тот же постоянный Work URL.

Плюсы:

- одно понятное действие из самого продукта;
- пользователь не ищет plugin и не создаёт новый чат;
- можно fail closed до перехода, если binding отсутствует или disabled;
- URL не приходится публиковать в client bundle.

Минусы:

- deep link не добавляет MCP сам по себе и должен использоваться только вместе
  с вариантом A;
- для multi-user production нельзя hardcode один conversation URL;
- потребуется минимальная typed binding-модель либо строго single-user
  deployment configuration. Для текущей multi-Person архитектуры предпочтительна
  typed Person-owned binding.

### Вариант C — Plugin/App entrypoint без project-chat

Shape of You оформляется как Workspace Agent или plugin, объединяющий
существующий MCP server и durable authority/fail-closed rules.

Плюсы:

- Workspace Agent хранит instructions, MCP, write approvals и connector
  constraints как управляемую конфигурацию;
- подходит для будущего controlled rollout и обычных пользователей.

Минусы:

- Workspace Agents недоступны на текущем ChatGPT Pro и требуют eligible
  managed workspace;
- обычный plugin/app selection применяется к отдельному сообщению и может
  требовать повторный `@mention`;
- публикация и review — отдельный внешний lifecycle;
- plugin directory не гарантирует возврат в один и тот же разговор.

Вывод: вариант C является корректным будущим managed-workspace решением, но
недоступен и не минимален для текущего Pro scope TASK-0068.

### Вариант D — собственный chat UI на Responses API/ChatKit

Плюсы: полный контроль над entrypoint, persistence и ошибками.

Минусы: собственная conversation persistence, streaming, approvals, auth,
model/tool orchestration, observability, moderation и эксплуатация. Это
преждевременная chat-платформа и несоразмерно текущей проблеме.

Вывод: отклонить.

## Рекомендуемое решение

Выбрать композицию **A + B**. Вариант **C** оставить будущим managed-workspace
решением и не включать в текущий ChatGPT Pro scope.

Пользовательский сценарий:

1. Пользователь входит в Shape of You Web.
2. Нажимает одну кнопку `Открыть Shape of You Coach`.
3. Authenticated launcher получает активный Person-owned
   `ChatAssistantConversationBinding` для `chatgpt_work` и перенаправляет в
   существующий постоянный разговор.
4. В разговоре уже прикреплён Shape of You MCP/source; пользователь сразу
   пишет обычным языком, без `@mention` и повторного выбора.
5. MCP initialization instructions и все 23 tool descriptions сообщают клиенту
   protocol guidance для PostgreSQL authority и fail-closed workflow.
6. Read выполняется через typed MCP. Write показывается пользователю на
   подтверждение ChatGPT и выполняется только после подтверждения.
7. Hard enforcement обеспечивают Person-scoped OAuth/API/domain services без
   Google Sheets writer/fallback dependency. Если MCP, OAuth или binding
   недоступны, launcher/server завершаются fail closed.

## Минимальная модель launcher binding

Новая сущность проектируется до реализации:

- `ChatAssistantConversationBinding` принадлежит `Person`;
- поля: typed `id`, `personId`, controlled `surface=chatgpt_work`, opaque
  `externalConversationId`, `status=active|disabled`, `createdAt`, `updatedAt`;
- invariant: не более одного active binding на Person и surface;
- conversation URL формируется server-side только для allowlisted
  `https://chatgpt.com/c/{id}`;
- binding не является authority для fitness data и не хранит OAuth token;
- создание/замена binding — отдельная authenticated administrative operation,
  не часть обычного запуска;
- Web получает только authenticated redirect, а не общий публичный URL.

Альтернатива для демонстрационного single-user staging — deployment config с
одним URL — дешевле, но отклоняется как production architecture: она смешивает
Person-specific state с deployment config и небезопасна при втором Person.

## Постоянный authority и fail-closed contract

API-owned MCP публикует правила как protocol guidance через initialization
`instructions` и descriptions всех 23 tools:

- staging PostgreSQL через `Shape of You Staging` MCP — operational authority;
- MCP — единственный writer;
- Google Sheets Fitness Tracker — только non-authoritative read-only legacy
  reference; никаких writes, ACL changes, archive/delete, fallback или reverse
  sync;
- для current-state запросов клиенту предписан MCP discovery/read;
- write tools помечены write semantics, позволяющими ChatGPT запросить user
  confirmation;
- после write клиенту предписан typed read-back по returned identifier;
- если source отсутствует, tool discovery неполон, OAuth expired/revoked,
  confirmation отменено или read-back не совпал, ответ сообщает конкретный
  stop reason и ничего не записывает через другой путь;
- historical chat text не выдаётся за current authoritative state.

Instructions и descriptions направляют client behavior, но сами не являются
hard enforcement confirmation или read-back. Hard guarantee даёт композиция
Person-scoped OAuth authorization и PostgreSQL-backed domain services: MCP не
имеет Google Sheets writer/fallback dependency, а authorization, unknown tool и
domain failures возвращают error вместо переключения источника.

## OAuth reliability

TASK-0068 не меняет существующую OAuth архитектуру без отдельного решения.
Acceptance проверяет:

1. `offline_access` доступен в discovery metadata;
2. после access-token expiry ChatGPT использует rotating refresh token;
3. refresh replay/revocation fail closed;
4. resource, issuer, audience, expiry и scopes проверяются на каждом MCP call;
5. reconnect выполняется в том же разговоре и не создаёт новый чат;
6. UI не показывает credentials, raw tokens или private OAuth evidence.

## E2E acceptance

### Последовательность одного разговора

1. Открыть Shape of You Web как authenticated Person.
2. Нажать единственную launcher-кнопку.
3. Подтвердить открытие exact canonical Work conversation, а не project-chat и
   не нового чата.
4. Без `@mention` отправить read-запрос; подтвердить MCP discovery и typed read.
5. Отправить два follow-up сообщения, использующих identifiers/context из
   предыдущего результата; conversation ID не меняется.
6. Reload страницы и повторное открытие через launcher; source и conversation
   ID сохраняются.
7. После отдельного operator approval выполнить один bounded synthetic staging
   write через существующий typed canary pattern и нативное подтверждение
   ChatGPT.
8. Выполнить read-back по returned identifier и сравнить typed fields.
9. Проверить failure cases: MCP unavailable, OAuth refresh revoked, binding
   absent/disabled и user cancels write confirmation. Во всех случаях нет
   Google Sheets fallback и нет нового разговора.

### E2E automation boundary

- Репозиторный browser E2E проверяет launcher, authenticated redirect,
  allowlist, missing/disabled binding и отсутствие публичного hardcoded URL.
- Live ChatGPT acceptance проверяет surface-specific часть в одном разговоре:
  source persistence, discovery, sequential messages, reload, OAuth refresh,
  confirmation, write и read-back.
- Live staging write является отдельным operator gate; до него E2E обязан
  остановиться после готовности к confirmation.
- Production, Google Sheets mutation и permission/archive operations не входят
  в TASK-0068.

## План реализации после архитектурного одобрения

1. [x] Создать ADR на русском с утверждённым вариантом и rejected alternatives;
   архитектурное одобрение оператора зафиксировано.
2. [x] Спроектировать и реализовать typed
   `ChatAssistantConversationBinding`, migration и API-owned repository/service.
3. [x] Добавить authenticated fail-closed launcher endpoint и одну кнопку в
   Shape of You Web; не встраивать chat UI.
4. [x] Проверить Work source contract и, после подтверждения ограничений Pro,
   перенести durable authority/fail-closed policy в API-owned MCP instructions
   и descriptions без изменения 23 typed tool schemas/scopes.
5. [x] Добавить unit/integration/browser E2E для binding и launcher.
6. [ ] Провести read-only live acceptance: exact conversation, discovery,
   несколько сообщений, reload/reopen и OAuth refresh.
7. [x] Запросить отдельное разрешение на один bounded synthetic staging write;
   после разрешения пройти confirmation → write → read-back.
8. [ ] Провести независимую Quality проверку всех acceptance criteria.
9. [x] Провести независимый Architecture Review: сложность, deployable
   boundaries, DDD, duplication и возможность упрощения.
10. [ ] Только после Quality acceptance обновить affected canonical Wiki,
    roadmap и changelog.
11. [ ] В roadmap удалить будущий шаг archive/read-only ACL disposition.
    Workbook остаётся бессрочным non-authoritative read-only legacy reference;
    archive/delete/ACL changes не являются roadmap item.
12. [ ] Переместить этот план в `completed/` только после полного acceptance.

## Developer implementation plan

### 1. API-owned binding и migration

Затрагиваем только существующий `apps/api` deployable:

- `apps/api/src/database/schema.ts` — enums и таблица
  `chat_assistant_conversation_bindings` с Person FK, bounded opaque external
  identifier и partial unique index для одного active binding;
- `apps/api/drizzle/<timestamp>_*.sql` и соответствующий generated snapshot —
  только механически сгенерированная migration после schema change;
- `apps/api/src/domain/chat-assistant-conversation-binding.ts` — typed entity,
  controlled values и validation opaque identifier без URL/slash injection;
- `apps/api/src/storage/chat-assistant-conversation-binding-repository.ts` —
  Person-scoped active lookup и operator-controlled bind/disable boundary;
- `apps/api/src/application/tokens.ts`,
  `apps/api/src/application/app.module.ts`, `apps/api/src/app.ts` — явная
  dependency composition без нового service/database/deployable;
- `apps/api/src/commands/manage-chat-assistant-binding.ts` и один package script
  в `apps/api/package.json` — provisioning/replacement/disable только по явным
  `personId`, `surface` и action; команда не открывает ChatGPT, не делает MCP
  calls и не читает OAuth credentials.

Имена PostgreSQL constraints/indexes будут заданы явно и проверены как UTF-8
строки не длиннее 63 bytes. Migration integration пройдёт с каждого historical
prefix, а не только с пустой базы.

### 2. Authenticated launcher contract

Добавляем внутри API integration module:

- `apps/api/src/chat-assistant/chat-assistant.controller.ts`;
- `apps/api/src/chat-assistant/chat-assistant.service.ts`;
- `apps/api/src/chat-assistant/chat-assistant.module.ts`;
- `packages/contracts/src/chat-assistant.ts` и export в
  `packages/contracts/src/index.ts` только для bounded reason codes и API error
  shape; полный ChatGPT URL в публичный contract не входит.

`GET /v1/chat-assistant/launch` не меняет state. Он использует текущий
`PersonContext`, отвечает `Cache-Control: no-store` и:

- при success делает redirect только на server-built
  `https://chatgpt.com/c/{externalConversationId}`;
- при browser navigation на missing/disabled/malformed/ambiguous binding
  возвращает на allowlisted same-origin `/progress` с controlled reason code;
- при JSON `Accept` отдаёт соответствующий typed error без identifier;
- никогда не принимает target URL от клиента, не создаёт conversation и не
  использует project-chat или Google Sheets как fallback.

### 3. Одно действие в static Web

Static-only boundary сохраняется:

- `apps/web/app/pages/progress.vue` — одна keyboard-accessible primary action
  `Открыть Shape of You Coach` и локализованный stop state из controlled query;
- `apps/web/app/assets/css/main.css` — только presentation states;
- новый Web backend, token storage, conversation ID, embedded chat и публичный
  hardcoded ChatGPT URL запрещены.

Кнопка выполняет top-level same-origin navigation на launcher endpoint. После
failure остаётся на `/progress`, объясняет, что Coach временно недоступен, и не
предлагает другой чат или legacy writer.

### 4. MCP protocol guidance и server enforcement для ChatGPT Pro

Read-only acceptance подтвердила, что существующий `Shape of You Staging`
source сохраняется после reload/reopen, но ChatGPT Pro conversation не имеет
builder/instructions/tool-policy controls. Workspace Agents недоступны на
текущем плане. History и source file не считаются системной policy.

После отдельного архитектурного одобрения Pro-compatible варианта MCP
публикует protocol-native `instructions` и единый authority/fail-closed prefix
во всех 23 tool descriptions. API adapter по-прежнему получает только
Person-scoped PostgreSQL-backed services и не имеет Sheets writer/fallback.
Tool names, schemas, scopes и количество tools не меняются. Новый chat,
Workspace Agent, project-chat или собственная chat-платформа не создаются.

### 5. Репозиторные проверки

Планируемые test surfaces:

- `apps/api/test/chat-assistant.unit.test.ts` — opaque-id validation,
  URL allowlist, deterministic failures и no identifier leakage;
- `apps/api/test/chat-assistant.integration.test.ts` — Person isolation,
  active uniqueness, authenticated success/failure navigation и `no-store`;
- `apps/api/test/migrations.integration.test.ts` — historical-prefix migration
  и PostgreSQL identifier byte limit;
- `apps/api/test/app.unit.test.ts` — explicit dependency composition;
- `apps/web/test/chat-assistant.test.ts` — controlled reason parsing и launcher
  route, если logic вынесена в helper;
- `apps/web/test/e2e/frontend.spec.ts` — доступная одна кнопка и понятный
  fail-closed state без embedded/new chat UX.

Перед live acceptance: targeted unit/integration/browser tests, monorepo
typecheck/lint/build в затронутом scope, `git diff --check` и
`node scripts/validate-docs.mjs`.

### 6. Live acceptance и отдельный write gate

Read-only часть выполняется в exact существующем conversation и фиксирует один
conversation ID на discovery, read, два follow-up, reload и reopen через
launcher. OAuth refresh проверяется без чтения token/credentials.

После этого работа останавливается перед write и запрашивает отдельное
разрешение на один bounded synthetic staging canary. Только при разрешении
проходит native confirmation → typed write → read-back. Production и Google
Sheets mutations не входят в этот gate.

### 7. Независимые reviews и документация

После developer handoff отдельные Quality и Architecture reviews проверяют
acceptance и упрощение. Только после `Quality ACCEPT` меняются affected current
Wiki pages, roadmap и changelog. Roadmap должен удалить archive/read-only ACL
disposition для Fitness Tracker: workbook остаётся бессрочным legacy reference.

## Критерии приёмки

1. Из authenticated Shape of You Web пользователь одним действием открывает
   один и тот же Work conversation.
2. Ни plugin search, ни «Попробовать в чате», ни `@mention`, ни переход между
   чатами не требуются в ежедневном сценарии.
3. MCP/source доступен после reload и повторного запуска через launcher.
4. PostgreSQL authority и Sheets legacy rules применяются автоматически и
   fail closed.
5. OAuth refresh проходит без ручного reconnect в нормальном случае; revoked
   или invalid refresh приводит к понятному stop state в том же разговоре.
6. Несколько последовательных сообщений используют один conversation ID и
   актуальные MCP reads.
7. После отдельного разрешения E2E проходит
   `entrypoint → discovery → read → confirmed write → read-back`.
8. Отсутствуют production/deployment, неразрешённые staging/Sheets writes,
   ACL/archive changes, secret access, commit и push.
9. Independent Quality и Architecture Review дают `ACCEPT`.
10. После acceptance canonical Wiki, roadmap и changelog синхронизированы, а
    roadmap больше не предлагает архивирование Google Sheets.

## Developer evidence 2026-08-27

- Generated migration:
  `apps/api/drizzle/20260827172141_typical_blink.sql` и matching snapshot.
- API unit regression: 21 files, 114 tests passed, включая MCP initialization
  instructions и authority prefix для всех 23 tools.
- API integration regression с `--maxWorkers=1`: 14 files, 65 tests passed.
  Первичный parallel run перегрузил локальный Docker Desktop с 1 CPU и около
  1 GB RAM; последовательный повтор прошёл полностью.
- Migration chain: 13 tests passed, включая clean/idempotent apply, каждый
  historical prefix и статический лимит 63 UTF-8 bytes для identifiers.
- Web unit regression: 8 files, 20 tests passed.
- Targeted TASK-0068 API integration: 4 tests passed, включая database-level
  FK, enum/check constraints и partial unique active binding.
- Web browser E2E: 21 test passed, включая полную browser navigation через
  launcher, единственную launcher action и bounded fail-closed state.
- Contracts/API/Web typecheck, API/Web lint, API/Web build, docs validator,
  board validator и `git diff --check` прошли.
- Read-only live acceptance exact Work conversation подтвердил тот же URL,
  закрепление, mode `Work`, persisted `Shape of You Staging` source,
  последовательный контекст и сохранение всего перечисленного после reload.
  Новые сообщения, настройки или tool calls в ChatGPT не выполнялись.
- Confirmed staging canary прошёл в том же conversation: discovery 23 typed
  tools, typed read, native confirmation, ровно один `DailyContextNote` write
  на synthetic date `2000-01-02` и typed read-back. Создан ID
  `4897b5d2-f9a3-460a-b8b7-80e77ade0318`; date, text, source reference и
  dedupe key совпали. Других writes и Google Sheets actions не было.
- ChatGPT Pro/Workspace Agent limitation проверен по official OpenAI contract и
  live `/agents`. Operator одобрил Pro-compatible вариант; superseding ADR и
  MCP initialization/tool metadata pins добавлены локально.
- Normal-path OAuth refresh подтверждён без credential access: deployed
  connection с 600-second access-token TTL успешно выполнил protected canary
  много часов спустя без reconnect. Это inference из accepted TASK-0051 TTL и
  runtime pins плюс текущего live success; rotation/reuse/revocation напрямую
  покрыты Identity integration tests. Live revocation намеренно не выполнялся,
  чтобы не разрушать рабочую connection без необходимости.
- Repository entrypoint после deployment пока не проверен: это оставшийся
  external gate.

## Architecture Review до реализации

- Собственная chat-платформа не создаётся.
- Новый deployable или microservice не требуется.
- Вводится только Person-owned external conversation binding; fitness domain и
  PostgreSQL authority не дублируются.
- Work conversation хранит dialogue context, но не становится source of truth
  для fitness facts.
- MCP instructions, Wiki, ADR и план не должны копировать друг друга целиком:
  ADR фиксирует решение, Wiki — current state, MCP — краткую runtime policy,
  план — выполнение.
- Решение можно упростить только отказом от multi-user safety и hardcode URL;
  это неприемлемо для production-ready результата.

## Current delivery gate

Архитектурно одобрена композиция:

`authenticated Web launcher + Person-owned Work conversation binding + один
постоянный ChatGPT Work conversation + persisted Shape of You MCP/source + MCP
protocol guidance + Person-scoped PostgreSQL-only hard enforcement`.

Локальная implementation и один confirmed canary одобрены и выполнены.
Следующий gate: accepted local reviews, затем отдельный visible release plan и
явное разрешение на commit/push для staging deployment, binding provisioning,
connector refresh и composed live acceptance. До этого release actions не
выполнять.
