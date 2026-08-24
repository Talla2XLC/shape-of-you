# TASK-0049 — Nutrition adapter единого Fitness Tracker importer

## Статус и разрешение

- Статус: completed.
- Оператор утвердил единый Nutrition architecture package командой `го`
  2026-08-24.
- Scope выполняется одним delivery package: ADR, schema, code, tests, real
  read-only dry-run и post-acceptance Wiki без промежуточных docs-only commits.

## Цель

Подключить связанные Nutrition sheets как один typed domain adapter к
существующему importer, сохранить durable identity и date-only precision,
провести полную безопасную сверку и получить первый реальный read-only dry-run
без изменения authority или частичного backfill.

## Входит

1. `fitness-tracker:import --domain nutrition --mode dry-run|apply` в общей
   команде.
2. Один bounded typed snapshot листов `Brands`, `Ingredients`, `Foods`,
   `Food_Ingredients` и `Meals` с source-drift guard.
3. Stable identity по exact sheet IDs и durable source IDs, включая `Meal_ID`.
4. Private catalog mapping и полная referential/composition validation.
5. Legacy Meal mapping в один Meal + один immutable serving snapshot item.
6. Explicit Meal temporal precision `instant|local_date` без synthetic time.
7. Photo, unsupported kind, incomplete nutrients/composition и broken-reference
   blockers без потери source evidence.
8. Пять typed relational Nutrition audit tables без generic JSON payload.
9. Общий atomic apply, retry, reconciliation и provenance batch link.
10. Migration, unit, integration, API/MCP/day/progress и identifier tests.
11. Реальный exact-workbook connector snapshot и staging read-only dry-run.
12. Independent Quality, Architecture Review и affected current-state Wiki.

## Не входит

- Google Sheets writes после выполненного отдельного `Meal_ID` remediation.
- Изменение инструкций отдельного ChatGPT-проекта из Codex; обязательный future
  writer UUID contract фиксируется как внешний pre-cutover action.
- Photo/media transfer, guessing nutrients, quantities, units или meal kinds.
- Shared-catalog promotion или автоматическая correction existing facts.
- Partial apply, staging apply, deployment, scheduler или recurring dual-run.
- Training, Recovery/Garmin, cutover, authority transfer или rollback execution.
- Commit или push без отдельного разрешения оператора.

## Реализация

1. [x] Исследовать live source, canonical ADR/Wiki, code и tests.
2. [x] Добавить и проверить durable `Meal_ID` у существующих Meal rows.
3. [x] Утвердить единый adapter, identity, mapping, blockers и audit shape.
4. [x] Зафиксировать решение в accepted ADR и approved плане.
5. [x] Добавить Meal temporal precision migration и обновить contracts/domain.
6. [x] Добавить пять typed Nutrition audit tables и persistence contracts.
7. [x] Расширить versioned private snapshot и live reader five-sheet subset.
8. [x] Реализовать Nutrition classifier, target reader и apply adapter.
9. [x] Подключить `nutrition` к общей CLI command без нового executable.
10. [x] Добавить unit/integration/migration/regression tests.
11. [x] Выполнить workspace checks и реальный read-only Nutrition dry-run.
12. [x] Провести independent Quality и Architecture Review.
13. [x] Обновить affected Wiki и перенести план в `completed`.

## Критерии приёмки

1. Nutrition использует существующую importer command и shared lifecycle.
2. Snapshot читает только пять утверждённых листов и обнаруживает source drift.
3. Identity использует stable source IDs; row numbers не участвуют в dedupe.
4. Re-run классифицирует semantic match как `unchanged` и не создаёт duplicate.
5. Catalog entities private; shared catalog не изменяется.
6. Broken/incomplete composition не урезается и блокирует apply.
7. Meal date импортируется как `local_date` с `occurredAt = NULL`.
8. Legacy row создаёт ровно один serving snapshot item из source totals.
9. Food link записывается только при exact valid resolution.
10. Photo marker, unsupported kind или invalid nutrients дают safe blocker.
11. Любой conflict/invalid блокирует весь apply и не создаёт domain facts.
12. Audit типизирован реляционно и связан с Person/import batch/target FKs.
13. Safe reports не раскрывают dates, descriptions, notes, nutrients или IDs.
14. Existing Meals остаются exact `instant`; public writes требуют timestamp.
15. Clean/every-prefix migration и 63-byte identifier gates проходят.
16. Live dry-run использует exact workbook read-only и не выполняет apply.

## План проверки

- `node scripts/validate-docs.mjs`, `git diff --check` и identifier byte audit.
- Contracts/API lint, typecheck, build и unit tests.
- Snapshot/classifier tests для five-sheet integrity, source drift и outcomes.
- PostgreSQL integration tests для apply/retry/blocking/atomicity/isolation.
- Clean/every-prefix migration suite и existing Meal upgrade pin.
- API/MCP/day/progress regression для instant/local-date Meals.
- Connector-created private snapshot, approved staging PostgreSQL tunnel и
  `--domain nutrition --mode dry-run`; snapshot затем удалить, tunnel закрыть.

## Architecture Review checklist

- Один modular API и database; новых deployable/service boundaries нет.
- Shared importer lifecycle не дублируется.
- Nutrition catalog и Meal aggregate сохраняют существующие DDD boundaries.
- Пять source sheets обрабатываются одним referentially consistent adapter.
- JSON не заменяет известную relational structure.
- Отсутствующие данные и media не синтезируются.
- Wiki описывает current state и не копирует историю ADR/плана.

## Результат

- Nutrition подключён третьим typed adapter к общей команде и lifecycle.
- Реальный read-only dry-run вернул `created=38`, `unchanged=0`,
  `conflict=81`, `invalid=40`; apply не выполнялся.
- SSH-туннель закрыт, private snapshot и временный runner удалены.
- Quality принял все 16 критериев; 89 unit и 57 integration tests прошли.
- Активный внешний ChatGPT writer обязан добавлять новый immutable UUIDv4
  `Meal_ID` для каждой будущей Meal row до cutover.

## Architecture Review — итог

- Лишней сложности и premature microservices нет: сохранены один modular API,
  одна database и один importer lifecycle.
- Пять связанных листов образуют один referential adapter; отдельные
  sheet-specific migrators и partial apply не созданы.
- DDD boundaries сохранены: private catalog versions, immutable Meal snapshot,
  typed provenance и Person isolation.
- Пять audit tables оправданы известной реляционной структурой и не дублируют
  generic JSON fact model.
- Двойное bounded чтение увеличивает стоимость dry-run, но необходимо для
  обнаружения изменения живого source во время capture.
- Упростить решение без потери identity, atomicity, provenance или честной
  обработки blockers нельзя; изменение архитектуры не требуется.
