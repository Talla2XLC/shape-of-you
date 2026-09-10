# TASK-0104 — Убрать отдельный флаг включения Intervals.icu

## Цель

Сделать полную OAuth/encryption configuration единственным сигналом готовности
интеграции и исключить успешный deployment с забытым enable flag.

## Объём

1. Удалить `INTERVALS_ICU_ENABLED` и `STAGING_INTERVALS_ICU_ENABLED` из shared
   config, API runtime и staging deployment handoff.
2. Автоматически создавать adapter и worker при наличии всех пяти обязательных
   значений.
3. Разрешить полностью отсутствующую группу для local/test сред и отклонять
   любую частичную группу.
4. Обновить deployment contract test, runtime example, ADR и затронутую Wiki.
5. Выполнить Developer-проверки и независимую Quality-приёмку.

## Не входит

- чтение или изменение реальных credentials;
- применение миграций;
- commit, push, deployment или VM-операции;
- изменение OAuth, Recovery, Training, dedupe, disconnect или erasure logic;
- live Intervals.icu smoke.

## Проверки

- targeted config unit test;
- `sh deploy/staging/scripts/tests/deployment-bootstrap-contract.sh`;
- API unit/integration tests;
- root lint, typecheck, build и test;
- `node scripts/validate-docs.mjs`;
- `git diff --check` и `4dt-board validate`.

## Gate после приёмки

Отдельное подтверждение требуется для commit и push. Следующий push
автоматически доставит полный уже настроенный staging configuration и включит
интеграцию; после deployment отдельно выполняется owner OAuth smoke.

