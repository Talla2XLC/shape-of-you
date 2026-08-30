# TASK-0079 — Capture-first Coach без DayClosure и routine confirmations

## Статус и gate

- Архитектура одобрена оператором 2026-08-29: полностью удалить DayClosure,
  записывать релевантные routine facts без повторного вопроса и использовать
  обычный ChatGPT Chat с Instant вместо Work binding.
- Accepted ADR:
  `docs/adr/20260829-remove-day-closure-and-use-capture-first-coach.md`.
- Этот документ является implementation plan; первый source-code patch требует
  отдельного одобрения плана оператором.
- Не разрешены deployment, staging/production writes, execution destructive
  migrations, connector permission changes, conversation rebinding, OAuth
  reconnect, secrets, Google Sheets mutations, commit и push.

## Цель

Сделать Coach естественным continuously available capture interface: сообщение
пользователя сохраняется как наиболее точный доступный typed fact, позднее
уточнение автоматически создаёт correction, а актуальное состояние любой даты
всегда вычисляется из current owning-domain facts.

## Scope

1. Удалить DayClosure domain, storage, HTTP, MCP, OAuth, Web и legacy-import
   contracts.
2. Сохранить `get_daily_projection` как always-live composed typed read.
3. Убрать routine confirmation language и закрытый-day choreography из MCP.
4. Разрешить честный partial Meal capture без fabricated nutrient values.
5. Сохранить automatic typed read-back после каждого write/correction.
6. Заменить Work-specific conversation binding contract на обычный ChatGPT
   conversation contract; operational rebind выполнить только отдельно.
7. Удалить незакоммиченную rejected TASK-0078 implementation и её hardcoded
   Nutrition policy/tool/schema changes, не затрагивая unrelated user changes.
8. Обновить только affected canonical Wiki/ADR/current-state docs.
9. Провести E2E обычного capture и независимые Quality/Architecture Reviews.

## Capture contract

- Прямая фраза пользователя о релевантном fitness/health/lifestyle факте уже
  является write intent.
- Один безопасно определимый факт → один idempotent typed write → automatic
  typed read-back → короткое подтверждение результата.
- Optional omissions не вызывают вопросы.
- Unknown значения остаются `null`/partial; estimate создаётся только по
  запросу пользователя или по подтверждённому catalog evidence.
- Если owning-domain fact пока невозможно представить без выдумки, сохранить
  релевантное наблюдение через typed `DailyContextNote`.
- Latest uniquely matching current fact исправляется автоматически через
  append-only correction. Вопрос разрешён только при нескольких materially
  different targets или неоднозначной Person/date/domain semantics.
- Destructive, credential/OAuth, administrative и material goal/program changes
  остаются confirmation-gated.

## Implementation stages

### 1. Изолировать rejected TASK-0078

- удалить uncommitted `nutrition_next_meal` contracts, schema, migration,
  repository/API/MCP tools, `coaching:write` additions и соответствующие tests;
- удалить rejected TASK-0078 ADR/plan/current-state Wiki claims;
- сохранить pre-existing accepted Training Coaching behavior;
- доказать diff review, что unrelated working-tree changes не потеряны.

### 2. Always-live DailyProjection

- выделить `DailyProjectionService` из текущего DayClosure module;
- сохранить Person-scoped composition через existing module read ports;
- упростить public contract до `localDate`, `timezone`, `asOf` и current
  `snapshot`;
- оставить HTTP `GET /v1/day-projections` и MCP `get_daily_projection`;
- удалить close/reopen/history controllers, services, stores и tests;
- удалить `open/closed/stale/superseded` branching из Progress и dated day UI.

### 3. Удалить persistence и legacy import

- добавить transactional migration, удаляющую closure import FK/table,
  operations, references, closures и closure enums в dependency-safe order;
- удалить schema declarations, repositories и application tokens;
- удалить `DayStatus` closure candidate/apply/target-reader paths, сохранив
  Nutrition Meal import и frozen Sheets read-only boundary;
- обновить clean-install и every-prefix migration coverage;
- статически проверить все generated PostgreSQL identifiers на лимит 63 bytes;
- доказать до/после migration, что counts/checksums owning-domain facts не
  меняются.

### 4. Capture-first MCP и partial Meals

- заменить MCP operational instructions: direct user report authorizes routine
  create/correct; no duplicate confirmation; read-back обязателен;
- удалить `list_day_closure_history`, `close_day`, `reopen_day` и
  `day-closure:write` из API metadata/cutover inventory;
- изменить interactive Meal create/correct input nutrients с обязательных
  complete numbers на partial numbers/null;
- обеспечить `nutritionCompleteness = partial` и null totals без zero fallback;
- покрыть cappuccino-like create, later correction, dedupe и read-back;
- сохранить write annotations low-risk, idempotent и non-destructive.

### 5. Chat surface и OAuth compatibility

- заменить `chatgpt_work` domain naming на обычную ChatGPT conversation binding
  без model authority в Shape of You;
- подготовить migration/command compatibility для нового surface value;
- удалить DayClosure scope из новых API/OAuth contracts и зафиксировать, что
  current refresh token потребует reconnect;
- не менять live binding, ChatGPT permission или OAuth connection локальной
  implementation;
- после отдельного approval выполнить coordinated staging cutover: deploy,
  OAuth reconnect, regular Chat binding, выбрать Instant, разрешить low-risk
  actions и провести live E2E.

### 6. Documentation и reviews

- обновить affected Wiki pages: daily lifecycle, data ownership, MCP access,
  migration strategy, Coaching, Web flow и changelog;
- не переписывать исторические ADR; пометить superseded decisions ссылками;
- выполнить independent Quality Review по acceptance criteria;
- выполнить Architecture Review на unnecessary complexity, DDD ownership,
  duplicated authority, deployable boundaries и дальнейшее упрощение.

## Acceptance criteria

1. В runtime отсутствуют DayClosure aggregate, tables, enums, repositories,
   close/reopen/history API, Web UI и MCP tools.
2. `get_daily_projection` для любой exact date/timezone возвращает только live
   current facts и не имеет closure state.
3. Сообщение «я выпил капучино» допускает один partial typed Meal write без
   fabricated calories/macros и без дополнительного вопроса.
4. Последующее уточнение автоматически создаёт append-only correction к
   однозначно найденному current Meal.
5. Routine create/correct не требует textual или native confirmation после
   approved connector cutover; destructive/high-impact actions требуют.
6. Каждый успешный write/correction подтверждён automatic typed read-back;
   inconsistent/unavailable read-back не объявляется успехом.
7. PostgreSQL остаётся единственным interactive writer; Sheets остаётся frozen
   non-authoritative read-only reference без fallback.
8. Launcher contract поддерживает обычный persistent Chat; Shape of You не
   обещает и не навязывает model через URL.
9. Rejected TASK-0078 hardcoded Nutrition implementation отсутствует в final
   diff, а accepted Training Coaching не регрессирует.
10. Unit, integration, migration, MCP, Identity, Web и docs gates проходят;
    Quality и Architecture дают `ACCEPT`.

## Validation plan

- API/contracts unit tests;
- Nutrition, DailyProjection и migration PostgreSQL integration tests;
- every-journal-prefix migration suite и identifier byte-length check;
- MCP discovery/authorization/metadata/read-back tests;
- Identity predefined-client and refresh-scope compatibility tests;
- Web unit/browser tests для Progress и dated day;
- root lint, typecheck, build и `node scripts/validate-docs.mjs`;
- `4dt-board`, `4dt-sources`, `4dt-wiki`, `4dt-memory` validation;
- live staging E2E только после отдельных deploy/OAuth/binding/permission
  approvals.

## Rollout и stop conditions

- Local implementation и tests не меняют staging/production state.
- Destructive migration не исполняется вне disposable integration databases
  без отдельного approval.
- Scope contraction не deployится без согласованного OAuth reconnect окна.
- Connector permission не меняется до deployment нового no-closure contract.
- Любая обнаруженная зависимость authoritative fact от closure id останавливает
  deletion и возвращает задачу на архитектурное рассмотрение.
- Commit/push предлагаются только после accepted Quality/Architecture и
  отдельного release approval.
