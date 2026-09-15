# TASK-0114 — Надёжные естественные Meal corrections

## Статус

Завершено 2026-09-15 после Developer, независимого Quality, Architecture
Review и Wiki review. Commit, push, deployment и staging data writes требуют
отдельного разрешения.

## Пользовательский результат

Пользователь коротко исправляет продукт, массу или nutrition facts. Coach сам
находит текущий Meal, сохраняет полную новую версию и подтверждает исправление.
Пользователь не знает про ids, full replacement, read-back или conflicts и не
повторяет уже сообщённые данные.

## Архитектура

Решение закреплено в ADR
`20260915-make-meal-correction-recovery-transactional`.

- стабильные `list_meals` и `correct_meal` сохраняются;
- перед correction обязателен current-day read;
- модель накладывает уточнение на полный canonical Meal;
- backend строго валидирует и append-only сохраняет replacement;
- returned Meal является transactional typed verification;
- invalid, stale/not-found и retryable failures получают разные recovery states;
- неподтверждённая correction не становится authority.

## Реализация

1. Разделить presentation для Meal create и Meal correction.
2. Зафиксировать current-read-before-correction в operational и result policy.
3. Добавить typed structured failure result для correction recovery, не меняя
   публичную input schema.
4. Классифицировать connector validation, stale/not-found и прочие execution
   failures; разрешить только безопасный bounded retry.
5. Считать returned canonical Meal достаточным подтверждением успешной команды.
6. Добавить regression coverage для frozen schema/scope, success, каждого
   failure state, отсутствия prompt-only authority и routine create.
7. Пройти Developer → независимый Quality → Architecture Review → Wiki.

## Не входит

- partial-patch или новый MCP tool;
- автоматический backend merge естественного языка;
- изменение Meal schema, NutritionService/repository semantics или migrations;
- новый scope, сервис, queue, scheduler, LLM dependency или env variable;
- автоматическая правка уже существующих staging Meals;
- commit, push или deployment без отдельного разрешения.

## Приёмка

1. В том же обычном conversation естественное уточнение запускает current Meal
   read и полную correction без повторного вопроса пользователю.
2. Успешный `correct_meal` однозначно означает, что returned Meal сохранён.
3. Invalid payload приводит к re-read/rebuild/retry, а не к memory-only итогам.
4. Stale/not-found target приводит к re-read текущей версии и безопасному retry.
5. Временная execution failure допускает один idempotent retry.
6. Ни один failure result не разрешает считать несохранённые данные текущими.
7. Tool schemas, scopes, append-only history и `record_meal` не регрессируют.

## Проверки

- focused MCP unit tests;
- полный API unit suite и релевантные Nutrition integration tests;
- API/root lint, typecheck и build;
- `node scripts/validate-docs.mjs`;
- `git diff --check` и `4dt-board validate`;
- независимый Quality, Architecture Review и Wiki review;
- post-deploy same-conversation canary после отдельного разрешения.
