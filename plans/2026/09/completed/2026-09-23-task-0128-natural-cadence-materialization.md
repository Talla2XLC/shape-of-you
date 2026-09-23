# TASK-0128 — Материализация cadence после естественного согласия

## Статус

Завершён локально 2026-09-23. Архитектура, реализация, тесты, независимые
Quality Review и Architecture Review, а также canonical Wiki приняты. Commit,
push, release-candidate publication, staging promotion и live data write не
выполнялись и требуют отдельных разрешений.

## Пользовательский результат

После полной публикации программы обычного «да», «го», «подходит» или
«делаем так» достаточно. Coach сам создаёт typed successor legacy-программы,
перечитывает его и сообщает только backend-owned следующий шаг. Пользователь
не повторяет cadence и не знает про версии, tools или schema.

## Архитектура

Решение закреплено в ADR
`20260923-materialize-confirmed-training-program-cadence-atomically`.

- conversation context определяет, к какому полному предложению относится
  согласие;
- Training атомарно клонирует текущую активную immutable version;
- backend добавляет только подтверждённый cadence;
- semantic duplicate остаётся no-op;
- stale state не перезаписывается автоматически;
- после mutation обязательны TrainingContext и DailyAssessment read-back.

## Реализация

1. Добавить строгие contracts input/result для narrow cadence materialization.
2. Реализовать Training repository transaction под существующей Person lock:
   проверить expected active authority, загрузить активную version, проверить
   cadence, клонировать snapshot, активировать successor либо вернуть no-op.
3. Добавить Training service method без нового deployable boundary.
4. Добавить скрытый MCP tool и model-facing orchestration для natural
   acceptance legacy cadence; сохранить ambiguous fail-closed policy.
5. После mutation требовать same-turn `get_training_context` и DailyAssessment
   read-back до concrete-action claim.
6. Добавить domain/service/repository/MCP tests для exact clone, atomicity,
   duplicate, retry, stale и естественных/неоднозначных реплик.
7. Запустить focused и full relevant checks.
8. Передать результат независимому Quality Review и Architecture Review.
9. После Quality acceptance обновить только затронутые canonical Markdown Wiki
   pages и переместить план в `completed/`.

## Не входит

- parsing legacy note или silent backfill;
- изменение упражнений, порядка, нагрузок, RIR или progression;
- generic patch, proposal token или persisted draft;
- новая database migration, service, queue, scheduler, dependency или env;
- Garmin/Intervals.icu import;
- ручное изменение PostgreSQL;
- commit, push, deployment или live program mutation.

## Приёмка

1. Natural acceptance materializes cadence без дополнительного сообщения.
2. Successor отличается от legacy active version только cadence и version
   metadata.
3. Operation атомарна, Person-owned, immutable и stale-safe.
4. Повтор того же cadence не создаёт новую version.
5. Ambiguous или partial conversation не вызывает write.
6. Matching read-back обязателен до active/current claim.
7. DailyAssessment возвращает backend-owned action или typed ambiguity.
8. TASK-0125/0126/0127 guarantees и imports остаются неизменными.

## Проверки

- contracts/API typecheck, lint и build;
- focused Training domain/unit tests;
- focused PostgreSQL Training integration tests;
- MCP natural-language contract and dispatch tests;
- full API unit и relevant integration suites;
- `node scripts/validate-docs.mjs`, `git diff --check`, `4dt-board validate`;
- независимые Quality Review и Architecture Review.

## Результат

- Добавлен узкий contract материализации cadence с exact
  program/version/lock expectation.
- Training атомарно клонирует активную immutable version и меняет только
  cadence; duplicate остаётся no-op, stale/invalid не оставляют записей.
- MCP закрепляет natural acceptance и обязательные same-turn
  `get_training_context` + `get_daily_assessment` read-back.
- PostgreSQL integration покрывает legacy `schedule_unavailable`, successor,
  неизменность старой версии, no-op и rollback.
- Full API suite прошёл: 50 test files, 356 tests.
- Независимые Quality Review и Architecture Review: accepted.
- Обновлены только `docs/wiki/api/training.md` и
  `docs/wiki/domain/coaching-and-decision-support.md`.
