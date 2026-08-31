# TASK-0083 — Человекоподобный Meal-ответ Coach и полезный следующий шаг

## Статус и gate

- Реализация завершена; Quality и Architecture Reviews дали ACCEPT 2026-08-31.
- Оператор одобрил архитектурный вариант B 2026-08-31.
- Реализация выполнена внутри существующего MCP adapter без новых tools,
  сервисов, баз данных, OAuth clients, chat UI или deployable boundaries.
- Не разрешены deployment, staging/production writes, Google Sheets actions,
  secrets, OAuth reconnect, commit и push.

## Проблема и root cause

После успешного Meal write/read-back Coach отвечает как технический интерфейс:
показывает `partial`, рассказывает о проверке записи и не даёт полезного
следующего шага. Причина находится не в модели питания, а в MCP presentation:
generic `successResult` помещает полный domain DTO через `JSON.stringify` в
model-visible `content`, включая внутренние поля. Одновременно важный Coach
response contract находится слишком поздно в длинных server instructions, а
тесты проверяют текст instructions, но не фактический `CallToolResult`.

## Одобренное решение

1. Сохранить существующий typed `structuredContent` без изменений для
   корректного contract chaining.
2. Добавить в существующий MCP adapter tool-specific result presenter для Meal
   write и read tools.
3. Не дублировать сырой DTO в model-facing `content`; вместо него передавать
   короткий handoff для естественного ответа Coach.
4. Поместить критический user-facing response contract в первые 512 символов
   server instructions.
5. После routine capture/correction Coach отвечает на языке пользователя одной
   или двумя естественными фразами: подтверждает понятую еду и, когда факты это
   поддерживают, добавляет одно полезное наблюдение или следующий шаг.
6. Не генерировать рекомендации детерминированно в API и не хардкодить блюда:
   факты остаются typed data, а языковая формулировка и bounded coaching —
   ответственность модели.

## Scope

- Meal write/read result presentation внутри существующего MCP server;
- приоритетные operational instructions и естественные response examples;
- regression tests фактического `content`, неизменного `structuredContent` и
  сценария ужина с лососем, овощами, ягодами, кукурузой и вином;
- affected current-state Wiki после Quality ACCEPT;
- независимые Quality и Architecture Reviews.

## Out of scope

- новый MCP tool или объединённый conversational projection;
- nutrition/recommendation engine и hardcoded food heuristics;
- изменение Meal domain model, PostgreSQL schema или write/read-back lifecycle;
- новый chat, Workspace Agent, собственный chat UI или provider-specific agent;
- deploy, staging E2E, production, commit и push.

## Acceptance criteria

1. Meal `structuredContent` остаётся typed и совместимым с текущим contract.
2. Meal result `content` больше не является JSON serialization domain DTO.
3. Routine final reply contract запрещает internal vocabulary: `partial`,
   `null`, tool/schema/property names, typed/read-back, identifiers, storage,
   staging, API и contract mechanics.
4. Routine final reply естественно подтверждает факты и добавляет одно
   evidence-grounded observation/next step, если факты позволяют это сделать.
5. Для ужина из reported E2E закреплён человекоподобный пример с полезным
   советом без invented calories, macros или portions.
6. Typed write, обязательный owning-domain read-back, PostgreSQL authority,
   OAuth scopes, tool count и no-Sheets-fallback не меняются.
7. Focused/full tests, typecheck, lint, docs validation и diff checks проходят.
8. Quality и Architecture Reviews дают ACCEPT.

## Этапы

1. Ввести optional result presenter в MCP tool definition и handler.
2. Применить presenter только к Meal write/read tools, сохранив generic behavior
   остальных tools.
3. Переставить и усилить core Coach contract в server instructions.
4. Добавить actual-result и dinner-conversation regression tests.
5. Запустить verification gates и устранить regressions.
6. Провести independent Quality Review, обновить affected Wiki и выполнить
   Architecture Review.

## Validation plan

- focused MCP server tests;
- полный API test suite;
- root/API typecheck, lint и build при наличии соответствующих scripts;
- `node scripts/validate-docs.mjs`;
- `git diff --check` и проверка отсутствия неожиданных изменений;
- 4DreamTeam board validation.

## Stop conditions

- Если решение требует менять Meal domain contract или добавлять новый tool,
  task возвращается в analytic и требует нового архитектурного одобрения.
- Если полезный совет требует fabricated precision, Coach ограничивается
  честным observation либо не даёт совет.
- Любой live staging test или deployment требует отдельного разрешения.
