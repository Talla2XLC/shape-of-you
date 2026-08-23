# TASK-0045 — Единый Fitness Tracker importer с Weight apply

## Статус и разрешение

- Статус: completed 2026-08-23 после принятия Quality.
- Текущий owner: `done`.
- Оператор явно запросил единый importer без дальнейшего искусственного
  дробления Weight на отдельные механизмы.
- До утверждения конкретного ADR schema/code implementation запрещена корневым
  `AGENTS.md`. После утверждения весь scope ниже выполняется одним delivery
  циклом без дополнительных архитектурных пауз.

## Цель

Превратить TASK-0044 dry-run в одну расширяемую команду импорта с режимами
`dry-run` и `apply`, завершить Weight как первый записывающий adapter и доказать
идемпотентность, provenance, relational audit и отсутствие частичных фактов.

## Входит

1. Одна CLI `fitness-tracker:import --domain weight --mode dry-run|apply` и
   совместимый alias старой Weight dry-run команды.
2. Common lifecycle/contracts для чтения snapshot, classification, apply и
   safe/private reports; writer существует только в apply path.
3. `import_batches` и typed `weight_import_records` без generic JSON payload.
4. Foreign key от `source_references.import_batch_id` к batch.
5. `WeightMeasurement` temporal precision `instant|local_date`, nullable
   `measured_at` только для `local_date`, обновлённая serialization/ordering.
6. Atomic all-or-nothing Weight apply: blockers создают audit, но ноль facts;
   чистый batch создаёт только missing facts.
7. Exact retry и concurrent apply без дублирования facts или audit snapshot.
8. Clean/every-prefix migrations, unit/integration/regression/security tests.
9. Independent Quality, Architecture Review и post-acceptance Wiki/changelog.

## Не входит

- Реальные Body/Nutrition/Training/Recovery adapters; они используют это ядро в
  следующих задачах, а не получают отдельные migrators.
- Google Sheets writes, direct ChatGPT dual-write или reverse sync.
- Live service-account secret access или real-data apply.
- Scheduler, recurring dual-run, cutover, authority transfer или rollback run.
- Deploy, staging/production migration, commit или push.

## Реализация

1. [x] Утвердить ADR с relational batch audit и Weight temporal precision.
2. [x] Создать additive API migration и обновить Drizzle schema/contracts.
3. [x] Сохранить existing rows как `instant`; обновить Weight serialization,
   ordering, cursor и internal date-only create command.
4. [x] Обобщить command/lifecycle из dry-run в единый importer.
5. [x] Реализовать transactional Weight apply, advisory lock, target re-read,
   blocked/completed audit и provenance batch link.
6. [x] Реализовать exact retry/concurrency/atomic failure behavior.
7. [x] Добавить unit, integration, migration-prefix и API/MCP regression tests.
8. [x] Выполнить lint, typecheck, build, unit/integration, docs validator,
   identifier audit и `git diff --check`.
9. [x] Провести independent Quality и Architecture Review.
10. [x] После accepted Quality запросить/использовать одобренный Wiki gate,
    обновить current-state docs/changelog и перенести план в `completed`.

## Критерии приёмки

1. Существует одна importer command/lifecycle; Weight не имеет отдельного
   одноразового механизма.
2. `dry-run` остаётся byte-stable для одинакового snapshot и делает ноль
   PostgreSQL/Sheets writes.
3. `apply` использует ту же classification и не пишет в Google Sheets.
4. Successful apply атомарно создаёт batch, typed audit, provenance и только
   отсутствующие Weight facts с `local_date` precision.
5. Conflict/invalid блокирует весь domain batch: audit сохраняется, Weight facts
   не создаются и существующие facts не меняются.
6. Exact и concurrent retries не создают duplicate batches для одинакового
   comparison snapshot и никогда не дублируют facts.
7. Source identity не зависит от row/value; checksum не входит в dedupe key;
   `source_references.import_batch_id` указывает на owning batch.
8. Existing Weight rows остаются `instant` byte-for-byte по фактическим данным;
   imported date-only rows имеют `measuredAt=null`, а не synthetic midnight.
9. API/MCP create/correct продолжает принимать exact instant; public reads явно
   возвращают temporal precision и стабильно сортируют оба вида фактов.
10. Audit schema типизирована relational columns/constraints/FKs; JSON не
    заменяет известные структуры.
11. Safe reports/logs не раскрывают weight/date/raw cells/credentials; private
    report остаётся explicit `0600`/no-overwrite.
12. Body/Nutrition/Training/Recovery могут подключаться typed adapters к тому же
    kernel без нового deployable, database, scheduler или migration framework.

## План проверки

- Migration: clean chain, every committed prefix, existing-row upgrade,
  temporal checks и identifier byte limits.
- Unit: both modes, outcome gate, source/target checksum, dedupe, reports и
  dry-run without writer.
- Integration: created, unchanged, blocked conflict/invalid, retry, concurrency,
  injected rollback, Person isolation и exact audit/provenance rows.
- Regression: Weight HTTP/MCP, progress overview, day closure, OpenAPI,
  workspace build/lint/typecheck/unit и API integration.
- Security: only Sheets read scope/GET, no secrets/raw values in safe output,
  no Sheets writer dependency.

## Решение об утверждении

Оператор утвердил ADR и этот план командой `go` 2026-08-21. Implementation
выполняется полностью до Quality gate без создания новых Weight-specific задач.
Real-data apply и внешние state changes остаются отдельными явными разрешениями.
