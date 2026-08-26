# TASK-0052 — Training и сырые Recovery/Garmin observations

## Статус и разрешение

- Статус: completed.
- Оператор утвердил цельный delivery package командой `го` 2026-08-25.
- Разрешены архитектура, реализация, тесты, independent Quality и affected Wiki.
- Не разрешены database apply, deployment, commit, push, cutover и Sheets writes.

## Цель

Добавить Training и сырые Recovery/Garmin observations в существующий единый
Fitness Tracker importer и закрыть MCP writer coverage без direct dual-write и
без смены источника истины.

## Входит

1. Bounded read-only snapshots `Training` и raw columns `Daily_Log`.
2. Domain adapters с `created|unchanged|conflict|invalid`.
3. Transactional, idempotent apply implementation без его запуска.
4. Stable session/row/metric identities, checksums и provenance.
5. Relational Exercise_ID mapping для imported private exercises.
6. Typed reps/duration/distance для performed sets.
7. Typed Garmin metrics и sleep stages в Recovery observations.
8. Recovery MCP list/record tools и `recovery:write` OAuth scope.
9. Unit, integration, migration, MCP, API и Identity tests.
10. Exact-workbook read-only dry-run после local verification.
11. Independent Quality, Architecture Review и affected Wiki.

## Не входит

- Google Sheets writes или изменение writer workflow.
- Staging/production apply, deployment или recurring scheduler.
- Cutover, writer switch, rollback execution или authority transfer.
- Direct ChatGPT dual-write.
- Import `Program`, Personal Records, readiness/AI или `Load_Risk` projections.
- Создание фиктивных Garmin connection/consent records.
- Commit и push без отдельного разрешения оператора.

## Реализация

1. [x] Восстановить workspace и проверить board/memory/docs/Git.
2. [x] Провести bounded live source inspection и code/schema discovery.
3. [x] Зафиксировать product/analytic scope, ADR и developer plan.
4. [x] Расширить Training и Recovery contracts/schema relationally.
5. [x] Добавить migrations и identifier byte guards.
6. [x] Добавить snapshots, classifiers, target readers и apply services.
7. [x] Подключить domains к общей import command и snapshot-file flow.
8. [x] Добавить Recovery MCP tools и OAuth policy.
9. [x] Добавить unit/integration/MCP/Identity tests.
10. [x] Пройти local gates и bounded exact-workbook read-only inspection;
    target-aware staging dry-run оставить отдельной операцией после deployment.
11. [x] Провести independent Quality и Architecture Review.
12. [x] Обновить affected Wiki и перенести план в `completed`.

## Критерии приёмки

1. Одна команда поддерживает `weight|body|nutrition|training|recovery`.
2. Dry-run не имеет write capability и публикует только safe report.
3. Повторный run не создаёт duplicate и не перезаписывает факты.
4. Training группируется только по stable `Session_ID`.
5. Exercise_ID mapping typed, relational и не угадывается по имени.
6. Strength, timed hold и run evidence сохраняются без encoding hacks.
7. Malformed meal row в Training остаётся local `invalid`.
8. Все известные raw Garmin fields получают typed Recovery representation.
9. Narrative/missing/out-of-range values не превращаются в synthetic facts.
10. Derived readiness/AI/Load_Risk projections не импортируются.
11. Recovery Sheets provenance не выдаётся за direct device ingestion.
12. MCP покрывает list/record Recovery и расширенный WorkoutSession.
13. OAuth scope granular и release-managed predefined client его разрешает.
14. Apply implementation transactional и сохраняет import audit.
15. Clean/every-prefix migrations и 63-byte identifier gate проходят.
16. Google Sheets во время задачи используется только для чтения.

## План проверки

- `node scripts/validate-docs.mjs`, `git diff --check`, identifier byte audit.
- Contracts/API/Identity lint, typecheck, build и unit tests.
- PostgreSQL integration tests для Training/Recovery apply, retry, conflicts,
  mappings и Person isolation.
- Clean/every-prefix migration suite.
- MCP discovery/auth/write regression.
- Exact workbook read-only dry-run с safe counts; без database apply.

## Architecture Review checklist

- Один modular API, одна database и один importer lifecycle.
- Новых deployable boundaries и premature microservices нет.
- Domain facts отделены от source evidence и derived projections.
- Unknown остаётся unknown; unsupported rows становятся invalid.
- Known source structure хранится relationally, не generic JSON.
- Wiki описывает current state и не копирует историю ADR/плана.

## Результат

- Единая команда теперь поддерживает
  `weight|body|nutrition|training|recovery`; отдельных одноразовых миграторов
  не создано.
- Training сохраняет stable `Session_ID`, exact row identity, relational
  `Exercise_ID` mapping и typed reps/duration/distance. Некорректная meal row
  остаётся локальным `invalid`.
- Recovery сохраняет только известные raw Garmin-derived observations и sleep
  stages; derived projections исключены, direct device consent не выдумывается.
- Добавлены transactional partial apply, target readers, relational audit,
  date-only precision, Recovery MCP list/record и `recovery:write` policy.
- Quality принял все 16 критериев. Прошли 92 API unit, 39 Identity unit,
  focused importer/migration integration tests, lint, build, migration gates,
  docs validation и diff check.
- Bounded live inspection использовала Google Sheets только для чтения и
  обнаружила восемь валидных Training sessions, одну invalid meal row и raw
  Recovery candidates. Новый код не развёрнут, поэтому target-aware staging
  dry-run и apply не выполнялись; это следующий отдельно разрешаемый шаг.
- Sheets остаётся operational authority, ChatGPT продолжает писать только в
  Sheets; cutover, deployment, database apply, commit и push не выполнялись.

## Architecture Review — итог

- Сохранены один modular API, одна database, одна команда и один importer
  lifecycle; новых deployable boundaries и premature microservices нет.
- Domain adapters разделяют source parsing, reconciliation и persistence без
  отдельных миграторов и без cross-service SQL.
- Domain facts, source evidence и derived projections не смешиваются;
  неизвестные значения не превращаются в synthetic facts.
- Известная структура хранится relationally, а не в generic JSON mirror.
- Wiki описывает current state и ссылается на ADR, не дублируя историю плана.
- Существенно упростить решение без потери temporal truth, provenance,
  idempotency или typed MCP coverage нельзя.
