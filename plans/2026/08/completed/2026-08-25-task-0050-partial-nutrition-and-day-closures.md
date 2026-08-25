# TASK-0050 — Partial Nutrition и импорт закрытых дней

## Статус и разрешение

- Статус: completed.
- Оператор утвердил реализацию командой `го` 2026-08-25.
- Работа выполняется одним delivery package с кодом, тестами и только
  необходимыми current-state Wiki updates; отдельные docs-only итерации не
  требуются.

## Цель

Импортировать всю доступную историческую Nutrition evidence и решения о
закрытии дней без ручного восстановления и без выдумывания отсутствующих
значений, сохранив один общий Fitness Tracker importer.

## Входит

1. Dependency-scoped reconciliation внутри единого Nutrition adapter.
2. Partial historical Meal с nullable nutrient components и completeness.
3. Complete-only public HTTP/MCP writes при partial-capable reads.
4. Typed preservation raw meal kind, Photo marker и source Food_ID.
5. Typed final evidence для неполного catalog без требования ручного ремонта.
6. Bounded read `Daily_Log` и импорт `DayStatus=Closed` после same-date facts.
7. Training-optional closure rule.
8. Idempotency, provenance, relational audit и no-overwrite semantics.
9. Migration, unit, integration, API/MCP/day/progress regression tests.
10. Real exact-workbook read-only dry-run после local verification.
11. Independent Quality, Architecture Review и affected Wiki.

## Не входит

- Google Sheets writes, включая backfill отсутствующего `Meal_ID`.
- Ручное восстановление nutrients, quantities, Meals или прошлых дней.
- Direct dual-write, recurring scheduler, staging apply или production apply.
- Cutover, writer switch, authority transfer или rollback execution.
- Photo download или создание Media entities.
- Training, Garmin/Recovery adapter implementation.
- Commit и push без отдельного разрешения оператора.

## Реализация

1. [x] Подтвердить live anomalies и невозможность честного residual recovery.
2. [x] Зафиксировать product/analytic scope и accepted ADR.
3. [x] Расширить relational schema и typed Nutrition/closure audit.
4. [x] Добавить partial Meal persistence и honest read projections.
5. [x] Перевести classifier/apply на identity-scoped dependency handling.
6. [x] Сохранять raw kind, Photo marker и unresolved Food evidence.
7. [x] Добавить `Daily_Log` к bounded snapshot и импорт `Closed` lifecycle.
8. [x] Добавить unit, integration, migration и regression tests.
9. [x] Пройти workspace gates и real read-only dry-run.
10. [x] Провести Quality и Architecture Review.
11. [x] Обновить affected Wiki и перенести план в `completed`.

## Критерии приёмки

1. Одна команда и один Nutrition adapter обрабатывают весь scope.
2. Независимый valid Meal создаётся даже при incomplete catalog row.
3. Missing nutrient остаётся `null`; importer никогда не подставляет ноль.
4. Partial Meal виден в day history с explicit completeness.
5. Public create/correct Meal по-прежнему требует полный nutrient snapshot.
6. Legacy meal labels отображаются детерминированно, raw value сохраняется.
7. Photo marker и unresolved Food_ID сохраняются и не блокируют Meal.
8. Incomplete catalog сохраняется как typed source evidence без manual queue.
9. Closed source day создаёт idempotent source-authoritative DayClosure.
10. Отсутствие Workout не влияет на закрытие дня.
11. Повторный run не создаёт duplicate и не перезаписывает факты.
12. Structural missing/duplicate ID остаётся локальным `invalid`.
13. Safe reports не раскрывают personal values.
14. Clean/every-prefix migrations и identifier byte gate проходят.
15. Google Sheets во время задачи используется только для чтения.

## План проверки

- `node scripts/validate-docs.mjs`, `git diff --check`, identifier byte audit.
- Contracts/API lint, typecheck, build и unit tests.
- PostgreSQL integration tests для partial Meal, daily totals, closure,
  dependency-scoped apply, retry и Person isolation.
- Clean/every-prefix migration suite.
- API/MCP/day/progress regression для complete и partial Nutrition.
- Private connector snapshot и staging dry-run только после local acceptance.

## Architecture Review checklist

- Один modular API, одна database и один importer lifecycle.
- Новых deployable boundaries и premature microservices нет.
- Partial означает unknown, не synthetic zero и не mutable draft.
- Domain facts, source evidence и closure coordination не смешиваются.
- Known source structure хранится relationally, не generic JSON mirror.
- Wiki описывает current state и не дублирует ADR/план.

## Результат

- Один Nutrition adapter теперь независимо применяет валидные source identities
  при локальных `conflict/invalid`, сохраняя одну transaction и общий lifecycle.
- Historical Meal хранит unknown nutrients как `NULL`; API/day/progress не
  превращают их в ноль или ложный точный итог.
- Raw meal kind, Photo, source Food ID и известные поля incomplete catalog rows
  сохраняются в typed relational audit без ручной remediation queue.
- `Daily_Log.Closed` создаёт idempotent `google_sheets` DayClosure после Meals;
  отсутствие Training не является blocker.
- Real read-only staging dry-run: `created=149`, `unchanged=0`, `conflict=12`,
  `invalid=36`. В `created` вошли 110 Meals, 36 closures и 3 Brands. Две live
  Meal rows без `Meal_ID` остались локальными `invalid`; apply не выполнялся.
- Private snapshot удалён, SSH tunnel закрыт, Google Sheets и staging
  PostgreSQL не изменялись.
- Gates: 90 unit и 58 sequential integration tests, clean/every-prefix
  migrations, lint, typecheck, build, docs validation и diff check прошли.

## Architecture Review — итог

- Сохранены один modular API, одна database, одна команда и один importer
  lifecycle; новых deployable boundaries нет.
- Identity-scoped apply проще продуктового процесса, чем глобальный blocker:
  он исключает ручной хвост, не ослабляя no-overwrite и durable identity.
- Partial является immutable historical evidence, а не mutable draft; public
  writer contract остаётся complete-only.
- DayClosure остаётся coordination artifact и не владеет Nutrition/Training;
  snapshot собирается после same-run facts и включает typed references.
- Известная source structure хранится relationally; generic JSON fact mirror не
  добавлен. Existing DayClosure snapshot JSON остаётся утверждённым coordination
  representation, а не заменой source/domain model.
- Преждевременных microservices и cross-service SQL нет. Существенно упростить
  решение без потери unknown semantics, provenance или atomic ordering нельзя.
