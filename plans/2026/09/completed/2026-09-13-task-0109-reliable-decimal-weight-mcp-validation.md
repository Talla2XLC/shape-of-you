# TASK-0109 — Надёжная MCP-валидация десятичного веса

## Проблема

`record_weight_measurement` и `correct_weight_measurement` публикуют общий
`weightKg` schema с `multipleOf: 0.001`. Для корректного JSON number `77.1`
обычный client-side AJV отклоняет значение из-за floating-point остатка, хотя
API-owned AJV с `multipleOfPrecision: 6` принимает его и сохраняет с доменной
точностью `numeric(6,3)`.

## Варианты

1. Убрать `multipleOf` из общего HTTP/domain schema — проще, но ослабляет
   обычный API contract; отклонено.
2. Оставить опубликованную schema без изменений и полагаться на tolerant
   validator клиента — не даёт совместимой гарантии; отклонено.
3. Публиковать для двух Weight writer tools connector schema без `multipleOf`,
   сохранив `type: number`, `minimum: 0.5` и `maximum: 700`, затем после
   нормализации проверять исходный строгий command schema внутри MCP adapter;
   выбран как минимальный вариант.
4. Принимать вес строкой или передавать целые граммы — меняет публичную форму
   данных и нарушает заданные ограничения; отклонено.

## План реализации

1. Добавить локальные connector-facing schemas для create/correct Weight,
   отличающиеся от строгих command schemas только отсутствием `multipleOf` у
   `weightKg`.
2. Перед вызовом `WeightMeasurementService` валидировать нормализованный input
   исходными `CreateWeightMeasurementSchema` / `CorrectWeightMeasurementSchema`.
3. Закрепить в MCP unit tests, что публичная schema принимает `77.1`, не
   принимает строки и значения вне диапазона, а handler вызывает обычный
   доменный service и возвращает обязательную read-back инструкцию.
4. Расширить Weight HTTP integration test: POST с `77.1`, затем GET и точная
   проверка сохранённого значения; добавить отказ для строки, лишней точности и
   значений ниже/выше диапазона.
5. Запустить targeted MCP unit и Weight PostgreSQL integration tests, затем
   API lint/typecheck/build, полный API test suite, docs validation,
   `git diff --check` и `4dt-board validate`.
6. Без паузы передать реализацию независимому Quality review; после него
   провести Architecture Review и проверить необходимость точечного Wiki
   update.

## Архитектурная оценка

Новый ADR не нужен: service/database/domain boundaries, HTTP contract и модель
данных не меняются. Решение является точечным применением принятого ADR
`20260902-evolve-mcp-tool-schemas-backward-compatibly.md`: connector schema
может быть шире, но строгая domain validation остаётся обязательной до writer
service.

## Ограничения

- Никаких migrations, dependencies, secrets, env changes или новых services.
- Не принимать numeric strings и не менять диапазон `0.5..700` kg.
- Не commit, push, deploy или staging/production actions без отдельного
  разрешения.

## Статус

Завершено 2026-09-13 после независимых Quality Review и Architecture Review.
