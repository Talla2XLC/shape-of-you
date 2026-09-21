---
id: "decisions-20260921-use-recommendation-completion-in-ordinary-coach-flow"
kind: adr
title: "Контекстно использовать выполнение рекомендации в обычном Coach-сценарии"
status: accepted
date: 2026-09-21
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - daily-assessment
  - mcp
  - recommendations
---

# Контекстно использовать выполнение рекомендации в обычном Coach-сценарии

## Context

TASK-0121 добавила `DailyAssessment V4` и read-only MCP tool
`get_daily_recommendation_completion`. Он вычисляет неизменяемый объяснимый
результат для точного `snapshotId`, различает `completionState`,
`evidenceMode`, свежесть, полноту, typed owner evidence, активный
append-only self-report и ограничения.

Текущий Coach flow уже требует `get_daily_assessment` как единственную
authority для полного Daily Coach ответа. Однако MCP instructions пока не
задают правила, когда обычный Coach должен дополнительно проверить completion,
как использовать каждое состояние и когда ручное уточнение действительно
необходимо. Поэтому наличие автоматического результата ещё не устраняет
регулярный вопрос «выполнили ли вы рекомендацию?».

Без дополнительного контекста Coach также не может безопасно выбрать
предыдущую рекомендацию. Поиск по произвольной дате или action text создаёт риск
смешать разные snapshots. Обязательный completion lookup при каждом ответе
добавил бы лишние tool calls, задержки и новую поверхность ошибок в
нерелевантных разговорах.

## Decision

1. Использовать контекстный completion lookup. Coach вызывает
   `get_daily_recommendation_completion` только когда результат точной текущей
   или предыдущей рекомендации способен изменить полезный ответ.
2. Допустимые triggers:
   - явный вопрос о выполнении или прогрессе рекомендации;
   - только что подтверждённый owning-domain факт может выполнить известную
     актуальную рекомендацию;
   - текущий assessment возвращает ранее созданный snapshot и его outcome
     важен для ответа;
   - формируется сегодняшний полный Daily Coach ответ и server-owned context
     содержит одну релевантную рекомендацию за непосредственно предыдущую
     Person-local дату.
3. Нерелевантная routine capture, factual read или другой обычный разговор не
   запускает discovery DailyAssessment/completion только ради фоновой проверки.
   Если точного relevant snapshot нет, completion tool не вызывается.
4. `get_daily_assessment` остаётся единственной authority для сегодняшнего
   статуса и следующего action. Completion не входит в DailyAssessment input,
   checksum, baseline или policy и не влияет на выбор следующей рекомендации.
5. `get_daily_recommendation_completion` остаётся единственной authority для
   outcome одной рекомендации. Coach не реконструирует completion из отдельных
   domain reads, conversation text или action presentation.
6. Fresh model-facing Daily Coach context может содержать максимум одного
   `previousRecommendation` candidate. API выбирает последний V4 snapshot за
   ровно предыдущую Person-local дату и не ищет произвольно более старые даты.
   Candidate содержит точный `snapshotId`, `localDate` и presentation-safe
   action context. При отсутствии такого snapshot поле полностью опускается.
7. Candidate является MCP orchestration context, а не новым полем публичного
   `DailyAssessmentResult` и не частью recommendation policy. Existing
   structured contract остаётся неизменным. Внутренняя модель candidate
   остаётся закрытой и типизированной; generic JSON rules не добавляются.
8. Completion всегда используется только вместе с action и `localDate` того же
   snapshot. Нельзя применять outcome предыдущего snapshot к сегодняшнему
   action или смешивать разные даты и recommendation versions.
9. Для `completed/observed` Coach сообщает подтверждённый факт естественным
   языком и не спрашивает пользователя о выполнении повторно.
10. Для `self_reported` Coach явно приписывает вывод пользователю и использует
    активную вершину append-only correction chain. Старые superseded feedback
    events не представляются как текущие.
11. Для `partially_observed` Coach называет подтверждённую часть и конкретное
    ограничение: partial, stale, unknown, unlinked или требующее self-report.
    Частичное evidence не повышается до полного выполнения.
12. Для `unknown` Coach не делает вывод о невыполнении. Обычно неизвестный
    outcome опускается; он объясняется только если важен для ответа.
13. При `self_report_conflicts_with_observation` Coach сохраняет оба
    свидетельства, формулирует честную неопределённость и не изменяет owner
    facts. Conflict detection симметрично покрывает как completed report против
    неполного observed evidence, так и skipped report против полностью
    observed выполнения.
14. Ручное уточнение допускается только когда разные ответы изменят
    сегодняшний action, безопасность или конкретный полезный следующий шаг.
    В остальных случаях Coach сообщает доступный уровень уверенности без
    вопроса.
15. MCP initialization instructions, свежий DailyAssessment result content и
    completion result content публикуют одинаковые trigger и presentation
    правила. Tool names, identifiers, enum/property names и internal mechanics
    не попадают в пользовательский ответ.
16. Реализация остаётся в существующем API modular monolith. Не добавляются
    migration, service, database, queue, scheduler, dependency, environment
    variable, LLM learning, generic rules engine или ручная серверная операция.

## Considered alternatives

### Вызывать completion при каждом Coach-ответе

Даёт максимальную осведомлённость, но требует лишних assessment/completion
reads для Meal capture, factual questions и других нерелевантных сообщений.
Увеличивает latency и превращает недоступность completion в общую проблему
Coach. Отклонено.

### Вызывать completion только в daily-plan сценарии

Сохраняет простой flow и ограничивает calls, но пропускает прямые вопросы о
прогрессе и routine owner writes, которые только что выполнили текущую
рекомендацию. Не достигает цели обычного Coach-сценария. Отклонено.

### Контекстный lookup

Использует результат в daily brief и обычных взаимодействиях только при
наличии точного relevant snapshot. Сохраняет low-friction Coach и минимальное
число calls. Выбрано.

### Возвращать completion внутри каждого DailyAssessment

Устраняет отдельный MCP call, но делает completion обязательным для любого
daily read, смешивает две независимые projections и увеличивает coupling.
Отклонено: completion остаётся отдельной lazy authority.

### Полагаться только на snapshotId из истории разговора

Не требует backend candidate, но chat history не должна определять, какая
предыдущая рекомендация релевантна. Exact typed pointer из истории можно
использовать для явного follow-up, но сегодняшний brief получает bounded
previous-date candidate от API. Выбрана комбинированная модель.

## Consequences

- Полный Daily Coach ответ может сделать один дополнительный completion call,
  только если предыдущая V4 рекомендация за вчера существует и её outcome
  полезен для краткого retrospective.
- Routine capture может проверить completion после typed write/read-back, если
  exact current snapshot уже известен и action соответствует записанному
  домену. Она не запускает отдельный assessment discovery автоматически.
- Public DailyAssessment и completion schemas остаются совместимыми; migration
  не требуется.
- Появляется bounded repository read предыдущего V4 snapshot и динамический
  model-facing MCP content. Это orchestration concern, а не новый domain fact.
- Symmetric conflict detection может добавить limitation к новому immutable
  completion assessment при том же owner evidence; старые assessments и owner
  facts не переписываются.
- Неизвестный outcome иногда не упоминается пользователю. Это намеренная цена
  отсутствия ложного негативного вывода и ненужных вопросов.
- Commit, push, deploy, migration execution и server access остаются
  отдельными operator gates.

## Verification

- MCP instruction tests фиксируют triggers, запрет unconditional lookup,
  exact-snapshot pairing и user-facing правила всех evidence modes.
- Unit tests проверяют previous candidate: только предыдущая Person-local дата,
  latest V4 snapshot, omission при отсутствии и отсутствие произвольного
  lookback.
- Completion policy tests проверяют symmetric conflict для skipped против
  fully observed evidence и сохранение owner facts.
- MCP tests проверяют неизменный structured `DailyAssessmentResult`,
  model-facing previous candidate, точный `snapshotId`, read-only scope,
  authorization и fail-closed behavior.
- Stable projection compatibility tests подтверждают, что прежний factual
  contract не получает completion как policy input.
- Выполняются focused/full unit tests, typecheck, lint, build, canonical docs
  validation, independent Quality Review и Architecture Review.

## Related material

- [DailyAssessment authority](./20260914-own-daily-assessment-and-next-action-in-api.md)
- [Stable MCP daily reads](./20260915-deliver-daily-assessment-through-stable-mcp-reads.md)
- [Typed recommendation feedback](./20260918-record-typed-daily-recommendation-feedback.md)
- [Automatic recommendation completion](./20260921-determine-daily-recommendation-completion-from-domain-facts.md)
- [TASK-0122 plan](../../plans/2026/09/completed/2026-09-21-task-0122-contextual-completion-in-coach-flow.md)
- TASK-0122
