# TASK-0162 — прибавка после одной явно лёгкой тренировки

## Статус

Конкретный ADR, порог и план одобрены оператором «го» 2026-10-07.
Implementation разрешён; commit/push/deploy остаются отдельными gates.

## Решение и область

Рекомендуется [accepted ADR](../../../../docs/adr/20261006-allow-single-session-high-reserve-progression.md).
Обычный путь двух тренировок сохраняется. Дополнительный путь: одна последняя
точная сессия, все назначенные sets на верхней границе reps и текущем весе,
RIR каждого не ниже `max(3, targetRir + 2)` при явном targetRir. Это выбранная
продуктовая эвристика. Шаг, Recovery gates и подтверждение остаются прежними.

## Этапы реализации

1. Зафиксировать одобрение ADR и плана через managed timeline.
2. Проверить все consumers общего progression evaluator и contract enum;
   добавить single-session predicate и точную evidence semantics.
3. Обновить объяснение MCP и повторные проверки candidate/confirm без обхода
   текущего Recovery, version lock и пользовательского подтверждения.
4. Проверить meaningful unit boundaries и isolated PostgreSQL integration
   для projection/confirm, повторных чтений и stale evidence.
5. Провести независимую Quality и пятичастный Architecture Review; после
   принятия обновить только affected canonical Training/Coaching Wiki.
6. Typecheck/build/targeted lint, contracts checks, docs validator, diff check.
   Завершённый план перенести в completed; дать Conventional Commit message.

## Приёмка

Одна полностью подтверждённая сессия с большим запасом предлагает только
программную прибавку с новой точной причиной; один неподходящий set блокирует
исключение. Нет invented sets/RIR, фактов из Garmin summary или автоматической
смены программы. Обычный двухсессионный путь сохраняется. Live Coach canary,
персональные записи, commit/push и доставка требуют отдельных разрешений.

## Принятое уточнение audit

Оператор одобрил [audit amendment](../../../../docs/adr/20261007-allow-single-session-working-weight-audit.md)
и полный delivery 2026-10-07: nullable second FK, proposal 1–2 unique IDs,
повторный расчёт под lock, сохранение CHECK/FKs и existing audit rows.
Migration `20261007211330_single_session_weight_audit.sql` authored и verified
в isolated PostgreSQL; предположение «без миграций» уточнено принятым ADR.

## Результат и проверки

Implementation принят независимой Quality `task-0162-quality-acceptance-20261007`.
402 unit и 205 PostgreSQL integration tests прошли в полном локальном union,
включая 78 migration checks и все 60 upgrade prefixes; один Docker startup
timeout устранён повтором isolated suite. Независимо проверены 29 unit и
107 PostgreSQL tests. Contracts build, API typecheck/build, scoped lint,
static identifier limit 63 UTF-8 bytes, docs validator и diffcheck прошли.

Architecture Review `task-0162-architecture-review-20261007` проверил пять
обязательных пунктов: сложность, deployable boundaries, DDD/ownership,
duplication и упрощение. Новых entities, services и authority copies нет.
После acceptance обновлены affected current Training/Coaching Wiki и ADR
supersession. Commit/push/exact staging promotion одобрены оператором,
фактический delivery фиксируется отдельно managed release timeline.
Живой диалог модели и персональная программа этим implementation не изменялись.
