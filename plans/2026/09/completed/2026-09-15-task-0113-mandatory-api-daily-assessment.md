# TASK-0113 — Обязательная API-owned оценка в существующем Coach-чате

## Статус

Завершено 2026-09-15. Developer, независимый Quality, Architecture Review и
post-acceptance Wiki review пройдены; commit, push и deploy не выполнялись.

## Проблема

После TASK-0112 полный Daily Coach сохранил старый prompt-owned маршрут:
`get_daily_projection` и дополнительные typed reads позволяют ChatGPT самому
сформировать статус и следующее действие. Поэтому модель смогла заменить
API-owned результат придуманным статусом, выводом о тренде веса и прогулкой
после медицинской процедуры.

## Решение

1. Сделать `get_daily_assessment` обязательным первым decision-producing read
   для полного Daily Coach ответа.
2. Явно запретить `get_daily_projection`, остальные typed reads и контекст чата
   использовать для создания или изменения статуса, confidence, причин,
   missing data, limitations и следующего действия.
3. Оставить `get_daily_projection` фактическим представлением дня, но его result
   guidance должен направлять полный assessment в `get_daily_assessment` и
   требовать fail-closed поведение, если authoritative result недоступен.
4. Разрешить ChatGPT только естественно объяснять готовый результат без новой
   длительности, интенсивности, тренировки, медицинского обоснования или иного
   embellished action.
5. Не менять routine capture, typed read/write contracts и права MCP.

## Архитектурное решение

Новый ADR не требуется. Исправление приводит MCP orchestration в соответствие
с уже принятым ADR
`20260914-own-daily-assessment-and-next-action-in-api`; domain model, public
tool schema, persistence и service boundaries не меняются.

## Объём изменений

- `apps/api/src/mcp/server.ts`;
- `apps/api/test/mcp-server.unit.test.ts`;
- только при необходимости — точечная корректировка уже существующей Wiki,
  если независимый Quality обнаружит расхождение с фактическим контрактом.

## Не входит

- изменение `daily-assessment-v1` policy или action vocabulary;
- новые MCP tools, scopes, endpoints, migrations или env-переменные;
- frontend и настройка timezone;
- LLM в backend;
- ручной workaround через новый чат;
- commit, push и deploy.

## Критерии приёмки

1. Global MCP instructions требуют `get_daily_assessment` до полного Daily Coach
   ответа и больше не требуют projection-first decision flow.
2. `get_daily_projection` не разрешает формировать следующее действие и
   направляет decision request к API-owned assessment.
3. При недоступном или ошибочном assessment ChatGPT не реконструирует решение
   из projection, отдельных facts или истории разговора.
4. Presentation layer сохраняет API status, reasons, missing data, confidence и
   ровно одно recommended action без добавления прогулки, длительности,
   интенсивности, медицинской причины или придуманного тренда.
5. Routine Meal, Workout, Recovery и factual day-projection flows не регрессируют.
6. MCP authorization и read/write scopes не меняются.
7. Focused и полные доступные проверки проходят; независимый Quality принимает
   каждый критерий.

## Проверки

- focused `mcp-server.unit.test.ts`;
- API unit suite;
- root lint, typecheck и build;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- независимый Quality и Architecture Review;
- post-acceptance Wiki review.

## Порядок после одобрения

1. Developer фиксирует instruction precedence и projection result guidance.
2. Developer добавляет regression-тесты и выполняет проверки.
3. Независимый Quality проверяет все критерии, включая сохранение routine flows.
4. Architecture Review подтверждает отсутствие новой архитектуры и лишней
   сложности.
5. Wiki выполняет post-acceptance review; ожидаемый результат — без изменений,
   если canonical pages уже описывают правильную модель.
