---
id: "decisions-20260827-orchestrate-daily-coach-over-existing-mcp-tools"
kind: adr
title: "Оркестрировать Daily Coach поверх существующих MCP tools"
status: accepted
date: 2026-08-27
supersedes: []
superseded_by: null
tags:
  - "chatgpt"
  - "coaching"
  - "daily-projection"
  - "mcp"
  - "web"
---

# Оркестрировать Daily Coach поверх существующих MCP tools

## Context

Shape of You уже предоставляет authenticated Web `/progress`, canonical dated
day view, постоянный Person-bound ChatGPT Work conversation и API-owned
`Shape of You Staging` MCP с 23 typed tools. PostgreSQL является operational
authority и единственным interactive writer. Google Sheets Fitness Tracker
остаётся бессрочным non-authoritative read-only legacy reference и не может
использоваться как current truth, write target или fallback.

Текущие контракты уже содержат почти все необходимые части ежедневного
сценария:

- `get_daily_projection` компонует module-owned факты за Person-local date и
  возвращает `open`, `closed`, `stale` или `superseded` lifecycle state;
- `get_active_training_program` явно различает active immutable Training
  program prescriptions и валидное отсутствие active program;
- typed list tools читают current Meals, WorkoutSessions,
  RecoveryObservations, DailyContextNotes, Weight и Body facts;
- typed write tools создают или корректируют факты только в owning context
  после native ChatGPT confirmation;
- `DayClosure` сохраняет immutable snapshot и требует append-only
  reopen/reclose lifecycle для поздних изменений;
- `CoachingRecommendation` отделяет предложение и решение от исполнения:
  `accepted` не означает `executed`, а выполнение доказывает только отдельный
  owning-context command и fact.

Пробел находится в interaction composition. Пользователь видит progress, но
не получает краткое состояние текущего дня, один следующий шаг и явное
разделение существующего плана, нового предложения и реально записанного
выполнения. Создавать ради этого broad `DailyPlan`, новый service или
собственную chat-платформу преждевременно.

ChatGPT Pro conversation не является управляемым Workspace Agent. Поэтому
conversation text не может быть authority. MCP protocol instructions и tool
descriptions направляют client behavior, а hard enforcement остаётся в
Person-scoped OAuth/API/domain boundaries.

## Decision

Реализовать Daily Coach как presentation-only interaction protocol поверх
существующих Web, API, permanent ChatGPT Work conversation и неизменного
23-tool MCP surface.

Не создавать `DailyPlan`, новый recommendation aggregate, database table,
migration, public API route, MCP tool, OAuth client, deployable, queue,
scheduler или собственный chat UI.

### Web composition

Authenticated `/progress` получает factual today summary через уже
опубликованный daily projection HTTP contract. Today card показывает только
typed projection fields:

- Person-local date и IANA timezone, выбранные браузером;
- lifecycle state;
- краткие recorded Nutrition, Training и Recovery indicators;
- ссылку на canonical `/days/:localDate` для полного projection/history;
- существующую action открытия того же Person-bound Coach conversation.

Web не вычисляет coaching recommendations, не создаёт plan state, не хранит
conversation id или OAuth credentials и не подменяет unavailable projection
данными progress history. Missing, unauthorized, invalid или unavailable
projection показывается как controlled fail-closed state.

### Conversation protocol

API-owned MCP initialization instructions закрепляют следующий порядок:

1. получить точные `localDate` и IANA `timezone`; при отсутствии уточнить их и
   не подставлять server timezone;
2. первым authoritative read вызвать `get_daily_projection`;
3. для `open` дня выполнить только необходимые bounded typed reads;
4. вернуть краткий factual state, один `Next step` и по одному bounded
   предложению для nutrition, training и recovery;
5. явно разделить `Planned`, `Proposed now` и `Actually completed`;
6. не вызывать write до того, как пользователь сообщает о фактическом
   выполнении, typed command однозначен и native confirmation получен;
7. после write выполнить owning-domain typed read-back и считать действие
   completed только при совпадении returned identifier и typed fields;
8. при missing tool, MCP/OAuth failure или inconsistent read-back остановиться
   без fallback и без объявления успеха.

Tool names, scopes, annotations и count 23 не меняются. Output
`get_active_training_program` использует отдельно одобренный typed
presence/absence envelope.

### Семантика состояния

- `Planned` содержит только существующие typed plan artifacts. В первом
  сценарии это active TrainingProgramVersion и prescriptions. Отсутствующий
  typed nutrition или recovery plan показывается как отсутствующий, а не
  синтезируется из chat history.
- `Proposed now` содержит bounded evidence-linked предложения Coach. Они
  являются conversation presentation, не persisted facts и не
  `CoachingRecommendation`, пока отдельный typed domain command не создаст
  такую рекомендацию.
- `Actually completed` содержит только current owning-domain facts,
  подтверждённые typed reads. Намерение, план, chat text или accepted
  recommendation выполнением не являются.

### Write и closure lifecycle

Open-day write выполняется как один atomic typed command с idempotency key,
native confirmation и обязательным typed read-back. Ambiguous input вызывает
clarification и zero writes.

Для `closed` или `stale` дня обычный write flow запрещён. Требуется явный
`reopen → edit → reclose` workflow:

1. показать lifecycle state и запросить решение с обязательной причиной;
2. после отдельного confirmation вызвать `reopen_day` и прочитать projection
   обратно до состояния `open`;
3. выполнить отдельно подтверждённый domain write и typed read-back;
4. получить отдельное confirmation на `close_day`;
5. прочитать projection и closure history обратно.

Ни reopen, ни reclose не выполняются автоматически. Любая ошибка оставляет
видимый stop state и не переписывает immutable closure history.

### Safety boundary

Daily Coach не выдаёт медицинские заключения и не предлагает punitive fasting,
double sessions или excessive cardio. High recovery/load risk может понизить
интенсивность или остановить progression, но не создаёт новый TrainingProgram.

PostgreSQL authority, no-Sheets fallback, Person isolation, OAuth scopes,
idempotency, domain validation и correction rules остаются существующими hard
server-side guarantees. MCP guidance не считается их заменой.

## Considered alternatives

- **Новый неперсистентный `DailyCoachProjection` и MCP tool:** сделал бы labels
  отдельным typed contract, но расширил бы public API и стабильный 23-tool
  surface, частично продублировал `DailyProjection` и active Training read и
  всё равно не создал бы отсутствующие nutrition/recovery plan contracts.
  Отклонено до доказательства, что existing-tools orchestration недостаточна.
- **Persistent `DailyPlan` или новые CoachingRecommendation kinds:** дали бы
  durable history и execution linkage, но требуют отдельного domain design,
  schema, migration, policy activation и typed nutrition/recovery evidence.
  Это слишком большой и дорогой первый срез; отложено в отдельную будущую
  product/ADR задачу.
- **Web-owned plan/recommendation engine:** дублирует domain rules в client и
  превращает Web в новую authority. Отклонено.
- **Собственный chat UI или Responses/ChatKit runtime:** требует conversation
  persistence, model/tool orchestration, approvals, moderation и эксплуатации.
  Отклонено как запрещённая преждевременная chat-платформа.
- **Workspace Agent как основная поверхность:** даёт более сильный managed
  instruction contract, но недоступен на текущем ChatGPT Pro и не нужен для
  минимального сценария. Может рассматриваться позже отдельным решением.

## Consequences

- Пользователь получает полезный ежедневный вход без нового чата и без смены
  существующих service/data boundaries.
- Web показывает authoritative facts, а Coach отвечает за presentation и
  natural-language sequencing, не становясь источником выполнения.
- Первый planned contract покрывает Training. Nutrition и Recovery
  предложения честно остаются `Proposed now`, пока для них не утверждены typed
  plan/recommendation contracts.
- Надёжность client sequencing зависит от ChatGPT Pro behavior; поэтому
  metadata tests и live Work acceptance обязательны, а hard write integrity
  остаётся server-side.
- Любая будущая потребность в новом MCP tool, persisted plan или recommendation
  kind возвращает задачу на отдельное архитектурное одобрение.

## Verification

- MCP unit tests подтверждают ровно 23 tools, неизменные names/schemas/scopes и
  instructions для projection-first, трёх состояний, confirmation/read-back,
  closed/stale workflow и no-Sheets fallback.
- Existing DayClosure integration tests продолжают доказывать immutable
  snapshot, stale detection, append-only reopen/reclose и timezone conflict.
- Existing MCP authorization/error tests доказывают Person-scoped fail-closed
  behavior без alternative writer.
- Web unit/browser tests проверяют today card, exact typed values, lifecycle,
  canonical dated link, existing launcher и controlled unavailable/OAuth state.
- Live read-only acceptance в том же Work conversation проверяет
  projection-first reads, Planned/Proposed/Completed labels, один Next step,
  reload/reopen и persisted MCP source.
- Первый live staging write требует отдельного operator approval и после него
  проверяет native confirmation, ровно один typed write и exact read-back.
- Independent Quality и Architecture Reviews проверяют отсутствие нового
  aggregate, deployable, database, OAuth client, duplicated authority и chat UI.

## Related material

- [TASK-0069 plan](../../plans/2026/08/completed/2026-08-27-task-0069-daily-coach.md)
- [Person-local day closures](20260811-model-versioned-person-local-day-closures.md)
- [Coaching recommendation lifecycle](20260731-model-immutable-coaching-recommendations-and-separate-user-decisions.md)
- [Progress overview authenticated default](20260818-make-progress-overview-the-authenticated-default.md)
- [ChatGPT Pro MCP authority](20260827-enforce-chatgpt-pro-authority-in-mcp.md)
- [Typed active-program absence](20260828-represent-active-training-program-absence-explicitly-in-mcp.md)
- [Integrity and lifecycle](../wiki/data/integrity-and-lifecycle.md)
- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
