---
id: "decisions-20260828-represent-active-training-program-absence-explicitly-in-mcp"
kind: adr
title: "Явно представлять отсутствие активной TrainingProgram в MCP"
status: accepted
date: 2026-08-28
supersedes: []
superseded_by: null
tags:
  - "coaching"
  - "mcp"
  - "training"
---

# Явно представлять отсутствие активной TrainingProgram в MCP

## Context

Daily Coach использует `get_active_training_program`, чтобы наполнить
`Planned` только существующими typed training artifacts. Отсутствие активной
программы является нормальным состоянием Person, но существующий Training
service выражает его через `NotFoundError`, необходимый HTTP
`GET /v1/training/programs/active` contract преобразует его в `404`, а общий
MCP adapter превращает любой non-OAuth error в generic tool failure.

В результате MCP client не может отличить валидное отсутствие программы от
сбоя PostgreSQL, repository или transport. Fail-closed Coach вынужден
останавливать весь сценарий даже после успешного `get_daily_projection`.
Нельзя исправлять это prompt-инструкцией, предположением `no plan` или
fallback на chat history и Google Sheets.

## Decision

Сохранить существующий `get_active_training_program`, его empty input,
`person:read` scope, read-only annotations и место в неизменном 23-tool MCP
surface, но заменить его MCP output на явный discriminated envelope:

- `{ status: "active", program: TrainingProgram }`, когда active program
  существует;
- `{ status: "absent", program: null }`, когда существующий Training service
  возвращает ожидаемый `NotFoundError` для отсутствующей active program.

Любая другая ошибка остаётся generic fail-closed MCP tool error. Adapter не
интерпретирует произвольные сообщения ошибок и не превращает repository,
database, authorization или schema failure в `absent`.

Envelope является MCP presentation contract и остаётся внутри API-owned MCP
adapter. Доменная `TrainingProgram`, Training service/repository и HTTP
`GET /v1/training/programs/active` с `404` не меняются. Новый shared domain
type, route, tool, database entity, migration, service, OAuth client или
deployable не создаётся.

Daily Coach может объявить отсутствие `Planned` training artifact только при
`status: "absent"`. Tool error по-прежнему означает unknown и останавливает
зависимую часть ответа без fallback.

## Considered alternatives

- **Сохранить generic error для отсутствия.** Безопасно, но делает обычный
  день без активной программы непригодным для Daily Coach. Отклонено.
- **Возвращать raw `TrainingProgram | null`.** Меньше полей, но `null` хуже
  объясняет семантику public tool result и труднее расширяется без
  неоднозначности. Отклонено.
- **Добавить второй MCP tool.** Сохраняет старую output shape, но дублирует
  query semantics и расширяет стабильный 23-tool surface. Отклонено.
- **Не читать active program.** Убирает ошибку, но лишает `Planned` typed
  authority и подталкивает client к догадкам. Отклонено.
- **Изменить Training service и HTTP contract на nullable result.** Унифицирует
  внутренний return type, но расширяет изменение за пределы MCP problem и
  ломает существующую REST semantics. Отклонено.

## Consequences

- Новый и постоянный ChatGPT conversation могут продолжить Daily Coach при
  нормальном отсутствии active program.
- Client получает явное различие между `absent` и unknown/error.
- Output shape существующего MCP tool меняется; одобренные clients должны
  читать discriminator и вложенное `program`, а не ожидать raw object.
- HTTP clients и доменная модель остаются неизменными.
- Реализация содержит небольшой MCP-specific translation expected absence и
  не создаёт новую authority или boundary.

## Verification

- Tool discovery test проверяет exact output schema, discriminator и
  неизменные name/scope/annotations/count.
- Authorized MCP tests проверяют `active` и `absent` structured content.
- Genuine service error test проверяет generic fail-closed tool error и
  отсутствие ложного `absent`.
- Diff review подтверждает, что HTTP controller/service path и его `404` при
  отсутствии active program не изменены; отдельный HTTP regression test не
  является evidence этой MCP-local задачи.
- Canonical docs validator, API tests/typecheck, Quality и Architecture Reviews
  проверяют отсутствие новых boundaries и fallback.

## Related material

- [TASK-0076 plan](../../plans/2026/08/completed/2026-08-28-task-0076-typed-active-training-program-absence.md)
- [Daily Coach orchestration](20260827-orchestrate-daily-coach-over-existing-mcp-tools.md)
- [Provider-portable Daily Coach](20260828-keep-daily-coach-protocol-portable-across-approved-mcp-clients.md)
- [Training API](../wiki/api/training.md)
- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
