# TASK-0069 — Daily Coach: единый ежедневный план и понятный следующий шаг

## Статус и gate

- Статус: завершена локально 2026-08-27; Quality и Architecture Reviews дали
  `ACCEPT`; accepted ADR:
  `docs/adr/20260827-orchestrate-daily-coach-over-existing-mcp-tools.md`.
  Canonical Wiki alignment выполнен и прошёл docs validator.
- Рекомендуемый вариант: presentation-only Daily Coach orchestration поверх
  существующих Shape of You Web, API, постоянного ChatGPT Work conversation и
  текущих 23 typed MCP tools.
- Вариант A принят. Любая потребность в новом MCP tool, public API, persistent
  plan, schema или deployable возвращает задачу на новый architecture gate.
- Разрешены только board/plan shaping и read-only исследование репозитория.
- Не разрешены production, deployment, staging writes, Google Sheets writes,
  ACL/archive/delete, secrets, OAuth credentials, commit и push.

## Проблема

Пользователь уже может открыть постоянный `Shape of You Coach` conversation из
authenticated `/progress`, а `Shape of You Staging` MCP предоставляет 23 typed
tools и является единственным interactive writer в operational PostgreSQL.
Однако текущий Web показывает исторический progress и dated day detail, а
conversation не имеет формализованного ежедневного сценария, который:

1. кратко объясняет актуальное состояние сегодняшнего дня;
2. отделяет существующий план от нового предложения и реально записанного
   выполнения;
3. даёт один понятный следующий шаг;
4. безопасно превращает только подтверждённое выполненное действие в typed fact;
5. прекращает работу при missing/stale/closed day, MCP/OAuth или read-back
   failure вместо догадок и fallback.

## Цель

Добавить полезный ежедневный Coach-сценарий как композицию существующих границ:

- Web показывает короткий factual snapshot дня и одну кнопку продолжения того
  же постоянного Coach conversation;
- Coach сначала читает `get_daily_projection`, затем только необходимые
  существующие typed reads;
- conversation формирует краткий, evidence-linked ответ с одним главным
  следующим шагом и отдельными предложениями по питанию, тренировке и
  восстановлению;
- фактическое выполнение появляется в системе только после отдельного
  подтверждённого typed write и обязательного typed read-back.

## Non-goals

- собственный chat UI, Responses/ChatKit orchestration или новая chat-платформа;
- новый conversation, project-chat fallback или Workspace Agent как основное
  решение;
- новый deployable, database, OAuth client, credential store, queue, scheduler
  или cross-service SQL;
- новый `DailyPlan`, `JournalDay` или broad `DayRecord` aggregate;
- автоматическое применение CoachingRecommendation, изменение TrainingProgram
  или создание completed facts из принятого предложения;
- медицинские выводы, наказание голоданием, двойными тренировками или чрезмерным
  кардио;
- Google Sheets current-state read, write, fallback, reverse sync, ACL/archive
  или delete;
- production, deployment, staging mutation, commit или push без отдельных gates.

## Подтверждённые существующие контракты

### Day lifecycle и projection

- `get_daily_projection(localDate, timezone)` возвращает `open`, `closed`,
  `stale` или `superseded`, immutable closure snapshot и current freshness.
- Projection уже компонует module-owned Weight, Body, Nutrition, Training,
  DailyContextNote, Recovery и Coaching references, но не владеет этими facts.
- Closed projection нельзя тихо переписать. Late/corrected evidence делает его
  `stale`; изменение требует явного `reopen_day`, а повторное закрытие создаёт
  новую append-only версию.
- Другой IANA timezone для закрытого дня конфликтует и должен fail closed.

### Planned, proposed и completed

- `get_active_training_program` является существующим typed источником
  активной TrainingProgramVersion и её prescriptions. Это planned training, а
  не факт выполнения.
- `CoachingRecommendation` имеет projection states
  `proposed|accepted|rejected|expired`. Даже `accepted` не является
  `executed`; выполнение доказывает только command/fact owning context.
- Daily projection и typed list tools возвращают recorded facts. Только они
  могут отображаться как actually completed.
- Для nutrition и recovery сейчас нет отдельного persistent daily-plan
  контракта. Отсутствие такого плана должно быть показано честно, а не заполнено
  вымышленным planned state.

### MCP authority, confirmation и read-back

- MCP initialization/tool metadata закрепляют PostgreSQL authority, отсутствие
  Google Sheets fallback, подтверждение writes, read-back и fail-closed policy.
- Все mutating tools имеют write annotations и Person-scoped OAuth scope;
  ChatGPT получает native confirmation до вызова.
- Confirmation является client interaction policy, а не серверным
  криптографическим фактом. Hard boundary обеспечивают OAuth/API/domain
  authorization, typed schema, idempotency и owning-module invariants.
- Current 23-tool surface включает typed record/correct reads/writes для
  Weight, Body, Meals, WorkoutSessions, RecoveryObservations и
  DailyContextNotes, а также daily projection/history/close/reopen.

### Web

- Authenticated `/progress` уже является entry point, получает factual sparse
  progress и имеет одну кнопку `Open Shape of You Coach`.
- `/days/:localDate` уже читает projection/history, показывает closure state и
  делает close/reopen только через API с explicit confirmation/reason.
- Person-owned launcher открывает только существующий allowlisted
  `chatgpt.com/c/{opaque-id}` и fail closed при missing/disabled/misconfigured
  binding.

## Семантический контракт Daily Coach

Daily Coach response всегда содержит три явно подписанные группы:

1. **Planned** — только существующие typed plan artifacts. В первом варианте
   это активная TrainingProgramVersion/prescriptions. Если typed nutrition или
   recovery plan отсутствует, ответ говорит `нет подтверждённого плана`, а не
   придумывает его.
2. **Proposed now** — краткие evidence-linked предложения Coach. Они существуют
   только в conversation presentation, не записываются как facts, не считаются
   `CoachingRecommendation` без вызова соответствующего domain command и не
   получают статус completed.
3. **Actually completed** — только current typed facts из
   `get_daily_projection` и уточняющих reads. Chat text, intention,
   recommendation acceptance и запланированное действие сюда не попадают.

Ответ выделяет ровно один **Next step**. Дополнительно он может показать по
одному bounded предложению для nutrition, training и recovery. Любое
предложение указывает, на каких typed facts оно основано и чего в evidence не
хватает.

## Варианты архитектуры

### Вариант A — existing-tools orchestration и короткий Web day card

Conversation использует текущие 23 MCP tools. API-owned MCP instructions
добавляют Daily Coach protocol: projection-first, точечные reads, трёхслойная
семантика, один next step, confirm/write/read-back и fail-closed stops. Web
добавляет на `/progress` короткую today-card через уже опубликованный daily
projection HTTP contract и сохраняет существующую launcher-кнопку.

Плюсы:

- нет новой сущности, таблицы, migration, deployable, OAuth client или tool;
- использует уже принятые DayClosure, Training, Coaching и authority contracts;
- сохраняет native ChatGPT confirmation и постоянный conversation;
- Web не реализует coaching rules и показывает только factual day state;
- самое малое изменение, которое даёт видимый ежедневный сценарий.

Минусы:

- предложенный план является presentation, а не durable aggregate;
- ChatGPT Pro instructions направляют client behavior, но hard guarantee
  остаётся в существующих OAuth/API/domain boundaries;
- nutrition/recovery planned state отсутствует до появления отдельных typed
  domain contracts;
- conversation E2E частично остаётся live surface acceptance и не может быть
  полностью эмулирован repository tests.

### Вариант B — новый неперсистентный `DailyCoachProjection`

Добавить API application coordinator и новый MCP read tool, который возвращает
единый typed read model: day state, planned, proposed inputs и completed facts.
Никакой новой таблицы или deployable не требуется.

Плюсы:

- labels и shape можно проверять contract/unit tests;
- меньше orchestration-зависимости от поведения ChatGPT;
- Web и MCP могут читать один специализированный response.

Минусы:

- расширяет публичный API и стабильный 23-tool MCP surface без доказанной
  необходимости;
- рискует превратить read coordinator в новый источник recommendation rules;
- дублирует значительную часть `DailyProjection` и active Training read;
- всё равно не создаёт typed nutrition/recovery plan из отсутствующих contracts.

Вывод: допустимый fallback только если E2E покажет, что вариант A недостаточно
детерминирован или слишком дорог по количеству tool calls.

### Вариант C — persistent `DailyPlan` или новые CoachingRecommendation kinds

Создать durable cross-domain daily plan либо расширить Coaching typed kinds для
nutrition/training/recovery и связать их с execution facts.

Плюсы:

- полная история планов, решений, сроков и explicit execution linkage;
- строгие typed состояния и воспроизводимая policy/evidence graph.

Минусы:

- требует нового domain design, contracts, schema, migration и policy
  activation;
- daily plan рискует дублировать module ownership и broad `DayRecord`;
- nutrition/recovery recommendation kinds ещё не спроектированы;
- несоразмерно первому пользовательскому Daily Coach workflow.

Вывод: отложить до отдельной product/ADR задачи с доказанной потребностью в
durable recommendation history.

### Вариант D — Web считает план или становится chat UI

Web самостоятельно объединяет facts, выполняет rules/model calls и хранит
conversation/approvals.

Плюсы: полный UI control.

Минусы: дублирует business rules, создаёт собственную chat-платформу,
conversation persistence и approval surface, расширяет эксплуатацию и нарушает
прямой запрет scope.

Вывод: отклонить.

## Рекомендуемое решение

Выбрать **вариант A**.

Daily Coach остаётся interaction protocol внутри существующего постоянного
conversation, а не новым domain aggregate. Web отвечает только за factual
today summary и entrypoint. MCP/API остаются единственной текущей authority и
writer boundary. Новые persisted recommendations, plan model или API/tool
контракт не добавляются.

## Нормальный пользовательский сценарий

1. Authenticated `/progress` определяет browser IANA timezone и local date.
2. Today-card читает существующий daily projection и показывает:
   `open|closed|stale`, основные recorded totals, наличие workout/recovery
   evidence и безопасную ссылку на `/days/:localDate`.
3. Пользователь одним действием открывает тот же постоянный Coach conversation.
4. На запрос ежедневного плана Coach требует точные `localDate` и IANA
   `timezone`. Если они не определены надёжно, он задаёт уточнение и не
   подставляет server timezone.
5. Coach первым вызывает `get_daily_projection`.
6. Для `open` дня он при необходимости вызывает только существующие reads:
   `get_active_training_program`, `list_meals`, `list_workout_sessions`,
   `list_recovery_observations`, `list_daily_context_notes` и иные bounded
   reads, необходимые для ответа.
7. Coach выдаёт краткий state, разделы Planned / Proposed now / Actually
   completed и один Next step, плюс bounded nutrition/training/recovery actions.
8. Пока пользователь не сообщил о выполнении и не подтвердил запись, никаких
   write tools не вызывается.
9. После подтверждённого write выполняется typed read-back и response обновляет
   Actually completed только при exact match.

## Write workflow

### Open day

1. Преобразовать сообщение пользователя в один atomic typed command.
2. При ambiguity запросить clarification; ничего не записывать.
3. Показать пользователю точное действие, дату, значение и source/provenance.
4. Получить native write confirmation.
5. Вызвать ровно один подходящий existing typed MCP write tool с устойчивым
   idempotency key.
6. Выполнить owning-domain typed read и найти returned identifier/typed fields.
7. Только exact read-back переносит действие в Actually completed.
8. Missing/inconsistent read-back возвращает stop/unknown outcome; запрещены
   silent retry с новым key, другой writer и Google Sheets fallback.

### Closed или stale day

1. Не предлагать обычный write flow и не считать snapshot текущим editable
   состоянием.
2. Показать closure/staleness и запросить явное решение
   `reopen → edit → reclose` с обязательной причиной.
3. После отдельного confirmation вызвать `reopen_day` и прочитать projection
   обратно; ожидается `open`.
4. Выполнить atomic domain write через обычный confirmation/read-back workflow.
5. Запросить отдельное confirmation на `close_day`; затем прочитать projection
   и history обратно. Закрытие не выполняется автоматически без confirmation.
6. Любая ошибка оставляет видимый stop state; история не удаляется и snapshot
   не переписывается.

### Missing day, MCP или OAuth

- Missing/invalid date or timezone: clarification, zero writes.
- Projection/tool unavailable: `Daily Coach unavailable`, zero alternative
  data source calls.
- OAuth expired с работающим refresh: продолжить в том же conversation после
  успешной авторизации.
- OAuth revoked/disconnected: остановиться до reconnect; не создавать новый
  conversation и не использовать Sheets.
- Missing/partial tool discovery: не строить полный daily plan из chat history;
  показать, какой authoritative read отсутствует.

## Предварительный implementation scope после одобрения

### Existing MCP boundary

- Расширить только protocol guidance в `apps/api/src/mcp/server.ts`: daily
  projection first, Planned/Proposed/Completed semantics, one next step,
  closed/stale workflow и exact read-back.
- Не менять names, input/output schemas, scopes и count 23 tools.
- Сохранить `readOnlyHint`, write annotations, Person-scoped authorization и
  PostgreSQL/no-Sheets authority text.

### Existing Web boundary

- Переиспользовать `dayApi.projection()` на `/progress` для короткой today-card;
  не добавлять client-side coaching rules.
- Отобразить factual counts/totals и lifecycle state, ссылку на exact dated
  record и существующую Coach launcher action.
- При projection/OAuth failure не показывать синтетический state и не
  подменять его progress history.
- Не передавать conversation id, credentials или private MCP data в client.

### Contracts и persistence

- Новые contracts, entities, schema, migration и tables не ожидаются.
- Если реализация потребует новый public API/MCP tool или persistent plan, она
  останавливается и возвращается на отдельное архитектурное одобрение.

## Developer implementation plan

### Шаг 1 — MCP Daily Coach protocol

Изменить только существующий MCP adapter:

- `apps/api/src/mcp/server.ts` — расширить initialization instructions
  projection-first workflow, семантикой Planned/Proposed/Actually completed,
  одним Next step, bounded nutrition/training/recovery actions, atomic
  confirmation/write/read-back и fail-closed ветвями;
- сохранить все 23 tool definitions, names, schemas, scopes и annotations;
- не добавлять Coaching write/read API, новый coordinator или persistence;
- не ослаблять существующие PostgreSQL/no-Sheets и closed-day tool
  descriptions.

Tests:

- `apps/api/test/mcp-server.unit.test.ts` — exact instructions и стабильная
  23-tool matrix; projection-first, no invented planned state,
  accepted-not-executed, confirmation/read-back, closed/stale lifecycle,
  missing MCP/OAuth/tool/read-back stop contract.

### Шаг 2 — factual today card на `/progress`

Переиспользовать существующий Web/API contract:

- `apps/web/app/pages/progress.vue` — параллельно progress overview читать
  `dayApi.projection(today, timezone)` и показать компактную today card;
- `apps/web/app/lib/day-api.ts` — менять только если нужен полный существующий
  projection state typing; не добавлять endpoint или transport contract;
- card показывает lifecycle, calories/meal count, workout count и latest
  readiness/risk evidence, canonical dated link и существующий Coach launcher;
- card не вычисляет recommendations и не создаёт Planned/Proposed state;
- projection error остаётся отдельным controlled state и не скрывает доступный
  historical progress; unauthorized route использует существующий browser
  OAuth return flow.

Tests:

- `apps/web/test/day-api.test.ts` или новый узкий pure presentation test — exact
  request/typed mapping без domain rules;
- `apps/web/test/e2e/frontend.spec.ts` — authenticated progress today card,
  open/closed/stale rendering, exact `/days/:localDate?timezone=...` link,
  unchanged launcher и unavailable projection without fallback.

### Шаг 3 — repository verification

Выполнить:

- focused API MCP unit tests;
- full API unit suite, typecheck, lint и build;
- focused Web unit/browser tests;
- full Web unit, typecheck, lint, build и browser E2E под `TZ=UTC`;
- existing DayClosure integration suite, если изменение metadata может
  затронуть workflow expectations;
- `node scripts/validate-docs.mjs`;
- `git diff --check` и scoped changed-file review;
- `4dt-board validate`.

### Шаг 4 — независимые reviews и live gates

- Developer после local checks без промежуточного gate передаёт результат
  независимому Quality.
- Architecture Review отдельно проверяет simplicity, DDD ownership,
  duplication и отсутствие новых boundaries.
- Live read-only Work acceptance выполняется после local acceptance.
- Live staging write, deployment, connector refresh, production, commit и push
  требуют каждый своего отдельного разрешения; developer plan их не разрешает.

## E2E обычного дня

### Repository E2E без внешних writes

1. Authenticated `/progress` загружается в фиксированном IANA timezone.
2. Today projection `open`; card показывает только returned facts и lifecycle.
3. Launcher открывает существующий Person-bound conversation route.
4. MCP metadata discovery подтверждает ровно 23 tools и Daily Coach guidance.
5. Contract harness/recorded scenario проверяет порядок:
   `get_daily_projection → bounded reads → no write before confirmation`.
6. Proposed actions не появляются в DayProjection или Actually completed.
7. После simulated confirmation typed write возвращает id; соответствующий
   typed read-back совпадает и только тогда действие становится completed.
8. Tests отдельно покрывают stale/closed, invalid timezone, missing tool,
   authorization error, cancelled confirmation и inconsistent read-back.

### Live ChatGPT Work acceptance

1. Через Web открыть тот же canonical conversation; conversation id не меняется.
2. Без `@mention` запросить план обычного open дня.
3. Подтвердить projection-first и необходимые typed reads.
4. Проверить видимые Planned / Proposed now / Actually completed и один Next
   step с nutrition/training/recovery actions.
5. Reload/reopen сохраняет conversation и Shape of You Staging source.
6. Live write не входит в автоматическое разрешение TASK-0069. Перед первым
   bounded synthetic staging write требуется отдельное разрешение оператора.
7. После такого разрешения пройти native confirmation → one typed write →
   exact typed read-back; не использовать production или Google Sheets.

## Acceptance criteria

1. Authenticated Web показывает краткое authoritative состояние текущего дня
   или ясный fail-closed error без synthetic/fallback state.
2. Одна существующая launcher action открывает тот же Person-bound permanent
   Coach conversation.
3. Daily Coach всегда начинает с `get_daily_projection` и использует только
   необходимые существующие typed MCP reads.
4. Ответ содержит один Next step и конкретные bounded предложения по nutrition,
   training и recovery с evidence/unknowns.
5. Planned, Proposed now и Actually completed визуально и семантически
   различимы; accepted recommendation не считается executed.
6. До explicit confirmation не вызывается ни один write tool.
7. Факт выполнения записывается только существующим owning-domain typed MCP
   write tool с Person scope и idempotency key.
8. Каждый успешный write сопровождается typed read-back; inconsistent/missing
   read-back не объявляется успехом и не вызывает fallback.
9. Closed/stale day требует подтверждённого reopen/edit/reclose lifecycle;
   missing date/timezone, unavailable MCP/tool и OAuth failures fail closed.
10. Tool count/names/schemas/scopes остаются стабильными; нет нового service,
    database, OAuth client, chat UI или persistent DailyPlan.
11. Repository E2E покрывает нормальный день и все fail-closed ветви; live
    staging write остаётся отдельным operator gate.
12. Independent Quality и Architecture Reviews дают `ACCEPT`, после чего
    affected canonical Wiki/ADR/plan alignment проходит docs validator.

## Validation plan

- MCP unit tests: exact 23-tool surface, projection-first instructions,
  confirmation/read-back, lifecycle and no-Sheets fallback guidance.
- API unit/integration: существующие DayClosure и writer invariants остаются
  зелёными; новых persistence migrations нет.
- Web unit: today-card maps only typed projection fields and shows controlled
  stop states.
- Browser E2E: authenticated progress → today-card → dated detail → launcher;
  unavailable projection и launcher failures remain fail closed.
- Existing full API/Web typecheck, lint, build, unit/integration/browser suites.
- `node scripts/validate-docs.mjs`, `git diff --check`, `4dt-board validate`.
- Live read-only Work acceptance; live staging write только после отдельного
  явного разрешения.

## Architecture Review checklist

1. Нет ли лишней сущности, read model или protocol abstraction?
2. Не появился ли новый deployable, database, OAuth client или chat platform?
3. Сохранены ли DDD ownership и различие plan/recommendation/execution fact?
4. Не дублируются ли DailyProjection, Coaching policy или canonical authority в
   Web, MCP instructions, plan и Wiki?
5. Можно ли удалить часть изменений без потери acceptance criteria?
6. Остаются ли PostgreSQL identifiers неактуальными для scope; если schema
   неожиданно появится, task должен остановиться до проверки 63 UTF-8 bytes.

## Порядок после архитектурного одобрения

1. [x] Создать и принять русскоязычный ADR с выбранным вариантом и
   alternatives.
2. [x] Уточнить developer file/test plan и отдельно запросить implementation
   gate.
3. [x] Реализовать только approved existing-boundary изменения.
4. [x] Запустить repository validation и E2E normal/failure matrix.
5. [x] Сохранить live staging write за отдельным operator gate; write не
   выполнялся.
6. [x] Провести независимые Quality и Architecture Reviews.
7. [x] После `ACCEPT` обновить только affected canonical Wiki/ADR и завершить
   план.
8. Commit/push/deployment остаются отдельными release/devops gates.

## Внешние gates вне завершённого локального scope

- Независимые Quality и Architecture Reviews должны дать `ACCEPT`.
- Live read-only Work acceptance не выполнялась локальным repository E2E.
- Любой live staging write, deployment, production, commit и push по-прежнему
  требуют отдельного явного разрешения оператора.
