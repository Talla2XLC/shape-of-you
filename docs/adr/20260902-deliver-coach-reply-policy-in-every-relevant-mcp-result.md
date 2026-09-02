---
id: "decisions-20260902-deliver-coach-reply-policy-in-every-relevant-mcp-result"
kind: adr
title: "Доставлять политику ответа Coach в каждом релевантном MCP result"
status: accepted
date: 2026-09-02
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - mcp
---

# Доставлять политику ответа Coach в каждом релевантном MCP result

## Context

Shape of You использует внешний ChatGPT как разговорную поверхность и не
владеет его runtime или финальной генерацией текста. MCP initialization и tool
descriptions уже описывают capture-first поведение и естественный Coach voice,
но клиент может удерживать полученную ранее metadata в открытом conversation.
Поэтому изменение только startup-инструкций не исправляет существующие чаты.

Текущие model-facing результаты неоднородны: Meal, Workout и Recovery имеют
специализированные presenters, а Weight, BodyMeasurement, DailyContextNote,
TrainingProgram и DailyProjection возвращают raw/default content. Даже
существующие presenters делают полезный следующий шаг условным через формулировки
`when supported` и `if this completes`. Это позволяет клиенту отвечать как
технический интерфейс, предлагать очевидное следующее действие вместо выполнения
и не давать рекомендацию после содержательного пользовательского сообщения.

## Decision

API-owned MCP server доставляет единую актуальную Coach reply policy в
model-facing `content` каждого релевантного tool result. В успешном результате
typed `structuredContent` остаётся неизменным источником фактов для
orchestration. Validation, execution и OAuth failures получают отдельную
нетехническую failure policy: она запрещает заявлять об успехе, основывать совет
на непроверенном факте или показывать пользователю внутреннюю причину ошибки,
не меняя `isError` и OAuth challenge metadata.

Политика требует:

- прямой однозначный пользовательский отчёт или обычная корректировка запускают
  существующий низкорисковый typed write без вопроса-разрешения;
- после write выполняется owning-domain typed read-back до заявления об успехе;
- после routine capture, correction или короткого factual read пользователь
  получает на своём языке одну–три естественные фразы: краткое подтверждение
  факта, полезную интерпретацию и один конкретный следующий шаг; полный Daily
  Coach brief сохраняет принятую структуру без искусственного лимита фраз;
- для содержательных nutrition, training, recovery и daily-summary
  взаимодействий evidence-grounded рекомендация является поведением по
  умолчанию, а не опциональным дополнением;
- рекомендация может отсутствовать только когда безопасного полезного совета
  действительно нельзя вывести из доступных фактов или пользователь явно
  запросил только сырые данные;
- Coach не предлагает выполнить очевидный разрешённый write или correction
  фразами вроде «хочешь, я запишу/исправлю/оценю», а выполняет его;
- уточнение задаётся только при непреодолимой неоднозначности цели, даты,
  domain fact или масштаба, которую нельзя безопасно разрешить из сообщения,
  изображения и текущего conversation context;
- tool names, schema fields, identifiers, transport/API/storage details и
  внутренние состояния не попадают в пользовательский ответ;
- `Planned`, `Proposed now` и `Actually completed` остаются разными типами
  утверждений; рекомендация никогда не считается выполненным фактом.

Политика централизуется в MCP adapter и используется специализированными
presenters для всех актуальных read/write результатов. Никакой новый Coach
entity, tool, service, database, OAuth client, deployable boundary или chat UI
не создаётся. Подтверждения сохраняются для destructive, credential,
administrative и material goal/program changes.

Внешний клиент по-прежнему формирует финальный текст, поэтому сервер не может
математически гарантировать каждую формулировку без собственного chat runtime.
Per-result policy является самой сильной управляемой и тестируемой границей в
принятой архитектуре. Уже открытый conversation получает новую policy при
следующем tool call, даже если initialization metadata осталась старой.

## Considered alternatives

### Изменить только MCP initialization и tool descriptions

Отклонено: это не гарантирует обновление уже открытых conversations и сохраняет
разное поведение между инструментами.

### Добавить `get_coach_brief` или серверный response composer

Отклонено: новый tool может не появиться в закэшированном каталоге, дублирует
существующую orchestration и приближает API к собственной chat-платформе.

### Создать собственный chat runtime

Отклонено: это дало бы максимальный контроль финального текста, но нарушило бы
явный product scope и добавило новый deployable boundary.

## Consequences

- Старые и новые conversations получают одинаковую актуальную Coach policy из
  результата каждого релевантного вызова.
- Ответы становятся проактивными по умолчанию, при этом советы остаются
  ограниченными доступными evidence и не подменяют выполненные факты.
- Model-facing text больше не является raw JSON для релевантных операций;
  машинный контракт остаётся в `structuredContent`.
- Централизованный policy fragment и contract tests предотвращают расхождение
  presenters между bounded contexts.
- Полное управление стилем внешнего ChatGPT остаётся вне контроля Shape of You.

## Verification

- Table-driven contract test проверяет policy во всех релевантных successful tool
  results, включая Weight, BodyMeasurement, Meal, Workout, Recovery,
  DailyContextNote, active TrainingProgram и DailyProjection.
- Failure-path tests проверяют generic execution, input validation и OAuth
  results: они fail closed, не заявляют об успехе и не передают клиенту
  технический пользовательский текст; OAuth challenge metadata сохраняется.
- Тесты запрещают условные permission offers и требуют конкретный следующий шаг
  по умолчанию, сохраняя исключения для raw-only запроса и отсутствия безопасной
  evidence-grounded рекомендации.
- Регрессии подтверждают неизменность typed `structuredContent`, write scopes,
  read-back и fail-closed правил.
- После отдельного разрешения staging E2E проверяет Meal, Workout, Recovery и
  Daily Coach в существующем conversation без reconnect или переоткрытия.

## Related material

- [Capture-first Coach ADR](20260829-remove-day-closure-and-use-capture-first-coach.md)
- [Daily Coach ADR](20260827-orchestrate-daily-coach-over-existing-mcp-tools.md)
- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [TASK-0093 plan](../../plans/2026/09/2026-09-02-task-0093-proactive-coach-reply-policy.md)
