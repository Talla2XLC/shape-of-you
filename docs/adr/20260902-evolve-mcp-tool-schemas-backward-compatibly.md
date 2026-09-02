---
id: "decisions-20260902-evolve-mcp-tool-schemas-backward-compatibly"
kind: adr
title: "Развивать MCP tool schemas с обратной совместимостью"
status: accepted
date: 2026-09-02
supersedes: []
superseded_by: null
tags:
  - architecture
  - integrations
  - mcp
---

# Развивать MCP tool schemas с обратной совместимостью

## Context

ChatGPT и другие MCP clients могут удерживать metadata существующего tool в
уже открытом conversation. После TASK-0090 сервер добавил обязательные поля и
сузил enum в schemas `record_meal` и `correct_meal`. Старый client продолжал
формировать прежний payload, а новый сервер отклонял его до выполнения
server-side normalization. В результате безопасное additive изменение
evidence model фактически стало breaking deployment и потребовало от
пользователя переоткрывать chat.

Metadata refresh полезен для разработки и проверки новой schema, но не
является управляемой сервером гарантией пользовательского сценария.

## Decision

Имя опубликованного MCP tool является compatibility identity. Пока имя
сохраняется, его connector-facing input schema развивается только обратно
совместимо:

- новые поля остаются optional;
- существующие поля не удаляются;
- required set не расширяется;
- допустимые enum values не сужаются.

MCP adapter принимает ранее опубликованные формы payload, нормализует их в
актуальную domain command и только затем применяет строгую domain validation.
Совместимость transport contract не разрешает incomplete domain writes. Для
Meal adapter это означает, что отсутствующий `amountKind` выводится из
quantity, unit или другого переданного evidence, а guard после нормализации
по-прежнему требует non-unknown amount evidence и четыре числовых nutrient
значения до вызова Nutrition service.

Каждый существующий tool с эволюционирующей schema получает frozen
compatibility test, который обнаруживает новое required поле, удаление старого
поля или enum narrowing. Если изменение нельзя выразить совместимо, создаётся
новое versioned tool name с явным переходным периодом; существующее имя не
переопределяется несовместимым контрактом.

Client metadata refresh и проверка в новом conversation остаются release/QA
действиями для проверки новой metadata, но не являются prerequisite для
продолжения работы уже открытого пользовательского conversation.

## Considered alternatives

### Принудительно обновлять metadata существующих conversations

Отклонено: Shape of You server не управляет lifecycle metadata внутри клиента,
а ручной refresh не даёт продуктовой гарантии для рядового пользователя.

### Всегда создавать новую версию tool при изменении schema

Отклонено для additive evidence fields: это дублирует каталог и увеличивает
стоимость поддержки без необходимости. Versioned name остаётся правилом для
действительно несовместимых изменений.

### Ослабить domain validation вместе с connector schema

Отклонено: транспортная совместимость не должна создавать неполные или
двусмысленные authoritative записи. Строгая проверка сохраняется после
normalization и до writer service.

## Consequences

- Открытые до deployment conversations продолжают Meal writes без reconnect и
  без переоткрытия chat.
- Новые clients видят актуальные evidence fields и инструкции.
- Connector schema может быть шире актуальной domain command, поэтому adapter
  и post-normalization guard становятся обязательной защитной границей.
- Breaking schema change требует нового tool name и периода совместимости.
- Новых сервисов, баз данных, OAuth clients, migrations и deployable boundaries
  не появляется.

## Verification

- Unit test сравнивает schemas `record_meal` и `correct_meal` с frozen legacy
  compatibility contract.
- MCP handler tests отправляют legacy complete payload без новых evidence
  fields и проверяют успешную normalization для create и correction.
- Неполные nutrients и genuinely unknown amount по-прежнему отклоняются до
  вызова Nutrition service.
- После отдельного разрешения staging E2E использует уже открытый до deployment
  conversation и выполняет typed write с date-scoped read-back.

## Related material

- [Meal amount evidence ADR](20260830-model-unquantified-meal-amount-evidence-and-natural-coach-language.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [Meal API](../wiki/api/meals.md)
- [TASK-0092 plan](../../plans/2026/09/2026-09-02-task-0092-mcp-schema-backward-compatibility.md)
