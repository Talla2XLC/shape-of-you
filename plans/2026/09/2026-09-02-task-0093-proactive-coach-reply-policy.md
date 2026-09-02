# TASK-0093 — Проактивная политика ответа Coach

## Проблема

ChatGPT получает capture-first правила при MCP initialization, но может
кэшировать их в уже открытом conversation. Model-facing результаты покрыты
неравномерно, а условные формулировки позволяют спрашивать очевидное разрешение,
показывать технические детали и завершать ответ без полезной рекомендации.

## Цель

Сделать проактивный человеческий Coach voice поведением по умолчанию поверх
существующих Web, API и MCP границ: однозначные повседневные факты записываются
сразу, а почти каждое содержательное взаимодействие заканчивается конкретным
evidence-grounded следующим шагом.

## Принятое решение

Реализовать accepted ADR
`20260902-deliver-coach-reply-policy-in-every-relevant-mcp-result.md`:

1. Централизовать общий policy fragment для естественного ответа, запрета
   очевидных permission questions и обязательной рекомендации по умолчанию.
2. Добавить tool-specific presenters ко всем релевантным reads и writes, включая
   Weight, BodyMeasurement, DailyContextNote, active TrainingProgram и
   `get_daily_projection`; существующие Meal, Workout и Recovery presenters
   перевести на тот же общий контракт.
3. Добавить нетехническую fail-closed policy для validation, execution и OAuth
   failures: не заявлять об успехе, не советовать по непроверенным данным и не
   выносить внутреннюю причину ошибки в ответ; OAuth challenge сохранить.
4. Ограничить формат одной–тремя фразами только для routine capture/correction
   и коротких factual reads; Daily Coach brief оставить структурированным.
5. Сохранить typed `structuredContent`, schemas, scopes, domain services,
   idempotency, correction model, typed read-back и fail-closed поведение.
6. Удалить противоречивое canonical утверждение, что ChatGPT обязан подтверждать
   routine mutation до write; зафиксировать capture-first и proactive-default
   правила в затронутых Wiki страницах.
7. Добавить table-driven coverage всех 20 successful tool results и отдельные
   validation, execution и OAuth failure-path regressions.

## Acceptance criteria

1. Прямой однозначный routine report не приводит к вопросу «хочешь, я
   запишу/исправлю/оценю?» и использует существующий typed write.
2. Каждый успешный write по-прежнему требует owning-domain typed read-back.
3. Routine result требует ответа на языке пользователя в одной–трёх естественных
   фразах: факт, интерпретация и конкретный следующий шаг. Daily Coach brief не
   получает конфликтующий sentence limit.
4. Рекомендация обязательна по умолчанию для meaningful nutrition, training,
   recovery и daily-summary interactions. Она пропускается только без безопасной
   evidence-grounded пользы или при явном raw-only запросе пользователя.
5. Все 20 existing tools доставляют актуальную policy в каждом successful
   result. Validation, execution и OAuth failures доставляют нетехническую
   fail-closed policy, поэтому новый deployment не требует переоткрытия chat
   после следующего фактического tool call.
6. Пользовательский ответ не содержит tool/schema/status/partial/typed/read-back,
   API, transport, identifiers или storage mechanics.
7. Planned, proposed и actually completed не смешиваются.
8. Не добавляются tools, services, databases, OAuth clients, migrations,
   deployable boundaries или собственный chat UI.
9. API tests и `node scripts/validate-docs.mjs` проходят.
10. После отдельных разрешений staging E2E покрывает Meal, Workout, Recovery и
    Daily Coach в уже открытом conversation.

## Проверка

- Targeted MCP unit tests.
- Полный API test suite и typecheck/lint, предусмотренные package scripts.
- Canonical docs validator.
- Независимые Quality и Architecture Reviews через 4DreamTeam.
- Отдельно разрешённый staging E2E после deployment.

## Запрещено без отдельного подтверждения

- staging writes и deployment;
- commit и push;
- production и secrets;
- OAuth reconnect;
- Google Sheets writes, ACL, archive или delete.
