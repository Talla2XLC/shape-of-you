---
id: "decisions-20261007-diagnose-and-recover-meal-capture-failures"
kind: adr
title: "Публиковать MCP input schemas без дробного multipleOf"
status: accepted
date: 2026-10-07
supersedes: []
superseded_by: null
tags:
  - architecture
  - mcp
  - nutrition
  - coaching
---

# Публиковать MCP input schemas без дробного multipleOf

## Context

После первого разбора оператор предоставил ответы инструмента: обычные
десятичные 0.7 и 5.1 отклонялись по multipleOf 0.001. Synthetic probe
опубликованной record_meal схемы воспроизвёл оба отказа в стандартном AJV;
с API multipleOfPrecision 6 они принимаются. Реальный локальный MCP handler
dispatches тот же fractional payload в synthetic Nutrition service.
Estimated без confidence отклоняется при normalization; целая порция с
готовыми menu nutrients проходит и quantified, и estimated-with-confidence.
Последний исторический payload неизвестен, поэтому его точный отказ не доказан.

Первый implementation этап ниже — доказанная несовместимость published
input schema, отдельно от предложений диагностики и recovery.

## Decision

### Этап A — совместимая опубликованная схема

Оператор одобрил только этот этап и соответствующий план сообщением «го».
Этап B в плане остаётся непринятым предложением и не является разрешением
менять failure/recovery contracts.

В MCP tool inputSchema публикуется отдельная копия без дробных multipleOf
constraints. Числа, bounds, required fields, enums, formats и имена tools
остаются прежними; integer multipleOf не меняется. Ограничение точности
описывается словами для клиента и остаётся обязательным в API validation
исходной schema с multipleOfPrecision 6 и Nutrition/domain invariants.
Копирование не мутирует shared schema и не меняет REST contracts или
published output schemas. Общая MCP input publication boundary устраняет
этот же дефект для дробных чисел остальных tools без отдельной правки
доменных правил. Frozen client compatibility допускает widening advertised
input restriction; server validation не ослабляется.

Этап A не требует миграций.

## Considered alternatives

- Настроить внешний клиентский валидатор: проект не контролирует его настройки.
- Удалить точность из shared domain/REST schemas: ослабляет принятую семантику.
- Использовать только existing API multipleOfPrecision: не исправляет клиентскую
  проверку опубликованной схемы.
- Публиковать отдельную совместимую копию: выбран минимальный transport adapter
  при сохранении исходных server constraints.

## Consequences

Обычные десятичные значения больше не отклоняются клиентом из-за дробного
multipleOf опубликованной схемы. Избыточная точность всё ещё отклоняется API;
published descriptions объясняют ограничение. Output и domain contracts не
меняются. Новых services, entities, dependencies или migrations нет.
Диагностика runtime отказов и recovery остаются отдельным непринятым предложением
в плане TASK-0164; этот ADR не утверждает устранение неизвестного historical
execution failure или успешную доставку на staging.

## Verification

- Published schema стандартного валидатора и реальный MCP handler принимают
  0.7/5.1; сервер отклоняет extra precision, bounds и missing estimate confidence.
- Shared schemas не мутируются; integer multipleOf и literal annotations
  сохраняются; опубликованные output schemas не меняются.
- MCP/Nutrition с isolated PostgreSQL сохраняет fractional evidence и menu
  nutrients; повтор того же dedupeKey не создаёт дубль.
- Existing MCP compatibility, API typecheck/build/lint/unit, независимая
  Quality, Architecture Review, affected current Wiki и docs validation.

## Related material

- [Meal correction recovery](20260915-make-meal-correction-recovery-transactional.md).
- [Meal API](../wiki/api/meals.md).
- [План TASK-0164](../../plans/2026/10/2026-10-07-task-0164-mcp-failure-recovery.md).
