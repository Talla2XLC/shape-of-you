# TASK-0087 — Стабилизация доставки Meal-оценок

## Статус и gate

- Оператор поручил устранить продолжающиеся Meal-сбои.
- Архитектура и Meal contract не меняются: используется принятый в TASK-0086
  best-effort estimate и существующая append-only correction.
- Commit, push и deployment выполняются только после соответствующего
  подтверждения.

## Подтверждённая причина

Workflow `Publish staging images` для commit `12fb30e` завершился ошибкой:
большой MCP lifecycle unit test превысил стандартный timeout 5000 ms примерно
на 62 ms под CI-нагрузкой. Все publish jobs и `deploy-staging` были пропущены,
поэтому ChatGPT продолжил использовать старое поведение staging API.

## Scope

1. Задать большому lifecycle-тесту явный ограниченный timeout, соответствующий
   количеству криптографических и HTTP-операций внутри сценария.
2. Повторно проверить focused test и полный API suite.
3. После разрешённых commit/push проверить стандартный quality/publish/deploy
   workflow и живой MCP.
4. Восстановление данных выполняется отдельно в TASK-0088 после deployment.

## Acceptance criteria

1. MCP lifecycle test стабильно проходит с явным test-local timeout и не
   ослабляет глобальные test limits.
2. Focused и full API проверки проходят.
3. Production code, Meal contract, schema, migrations, OAuth и topology не
   меняются.
4. Canonical docs остаются валидными; Wiki update не требуется.

## Проверка

- focused MCP unit test не менее трёх последовательных запусков;
- полный API test, typecheck, lint и build;
- documentation validator и `git diff --check`;
- GitHub Actions quality/publish/deploy status;
- независимые Quality и Architecture Reviews.
