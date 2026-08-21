# TASK-0044 — Контролируемый импорт Google Sheets и Weight dry-run

## Статус и граница разрешения

- Статус: completed 2026-08-21 после accepted Quality, Architecture Review и
  post-acceptance Wiki alignment.
- Текущий owner: отсутствует; TASK-0044 завершена.
- Утверждение разрешает source-code patches и тесты только в описанном Weight
  dry-run scope. Schema migrations, live secret access и внешние state changes
  остаются запрещены без отдельного разрешения.
- Google Sheets остаётся read-only для backend и authority для operational
  fitness data.

## Исходный запрос

Начать DEV-024 с общего механизма импорта и сверки, используя Weight как первый
vertical slice. Активный ChatGPT-проект «Фитнес-трекер» продолжает писать
operational data, включая Garmin/Recovery, только в Google Sheets до cutover.
Прямой dual-write запрещён; backend выполняет pull import и reconciliation.

## Цель

Спроектировать расширяемый typed import kernel и реализовать Weight dry-run,
который читает `Weight` и `Daily_Log`, сравнивает их с текущим PostgreSQL,
возвращает `created / unchanged / conflict / invalid` и гарантированно ничего
не записывает ни в Google Sheets, ни в PostgreSQL.

## Утверждаемая архитектура

- Accepted ADR:
  [`docs/adr/20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md`](../../../../docs/adr/20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md).
- Import capability остаётся module/one-shot command существующего `apps/api`.
- Common kernel оркестрирует typed domain adapters, но не владеет facts и не
  содержит universal JSON payload или polymorphic fact link.
- TASK-0044 поддерживает только `dry_run`; persisted `ImportBatch`, apply,
  backfill, scheduler, dual-run automation и cutover идут отдельными задачами.
- Weight source identity использует spreadsheet id + immutable sheet id +
  Person-local date; row/cell coordinate остаётся locator, checksum — evidence.
- Date-only source сохраняет `local_date` temporal precision без искусственного
  `measuredAt`.
- До cutover ChatGPT пишет только в Sheets; после полного MCP coverage и
  отдельного решения переключается только на Shape of You MCP.
- Cutover и rollback используют exclusive writer и immutable checkpoint.

## Scope

### Входит

1. Общие TypeScript contracts для import mode, source manifest, typed source
   identity, safe finding и outcomes.
2. Узкие ports для read-only source snapshot, target comparison и report sink.
3. Typed Weight adapter для `Weight(Date, Weight_kg)` и typed mirror adapter для
   `Daily_Log(Date, Weight)`.
4. Детерминированная нормализация `ru_RU`/`Europe/Moscow`, validation и checksum.
5. Weight authority/mirror reconciliation до PostgreSQL comparison.
6. PostgreSQL read-only comparison с существующими current
   `WeightMeasurement`/`SourceReference` records.
7. CLI/one-shot dry-run с safe stdout summary и явно запрошенным private detail
   report; source values не попадают в обычные logs.
8. Unit, property/golden и PostgreSQL integration tests без real-data fixtures.
9. Документированный MCP coverage/cutover/rollback gate для дальнейшего DEV-024.
10. Independent Quality и Architecture Review после implementation.

### Не входит

- Создание или изменение `WeightMeasurement`, `SourceReference`, import batch
  или других PostgreSQL rows.
- Additive migration для temporal precision или persisted import audit.
- Apply/backfill, scheduler, recurring dual-run, self-healing или corrections.
- Записи, форматирование, permissions или formulas Google Sheets.
- Изменение ChatGPT-проекта, OAuth client, MCP tools или scopes.
- Реализация Body, Nutrition, Training или Recovery import adapters.
- Cutover, authority transfer, rollback execution, deploy, staging/production
  access, secret access, commit или push.

## Затронутые области

| Область | Ожидаемое изменение |
| --- | --- |
| `apps/api/src/import/` или эквивалентный module path | Common kernel, Weight adapter, report contracts и one-shot command |
| `apps/api/src/domain/weight-source-reconciliation.ts` | Расширение typed findings без создания фактов |
| `apps/api/src/storage/weight-measurement-repository.ts` | Только read-only comparison port/query; create semantics не переиспользуются для classification |
| `packages/contracts/` | Только если import report является поддерживаемым operator contract; public HTTP API не добавляется |
| `apps/api/test/` | Golden/unit/property/integration tests и no-write assertions |
| `docs/adr/`, `docs/wiki/` | Accepted architecture и current operational authority/writer workflow |

## Technical impact checklist

| Область | Impact | Комментарий |
| --- | --- | --- |
| Affected files/modules | yes | Новый internal import module и команда |
| Data model | proposed, not in TASK-0044 | Future apply требует typed import rows и Weight temporal precision |
| API/contracts | internal yes, public no | Dry-run — operator CLI, не новый HTTP endpoint |
| External integration | yes | Read-only Google Sheets adapter и credential boundary |
| Migration risk | no in this task | PostgreSQL schema не меняется |
| Backward compatibility | yes | Existing Weight API, Intake и MCP semantics не меняются |
| Security/secrets | yes | Dedicated read-only Sheets credential; no values or credentials in logs/reports/repo |
| Test surface | yes | Source normalization, reconciliation, PostgreSQL comparison, no-write proof |
| Rollback/recovery | yes | Dry-run не меняет state; cutover rollback проектируется, но не выполняется |
| Documentation | yes | Proposed ADR и ограниченные current-state Wiki updates |

## Требования к реализации

1. Common kernel не должен импортировать domain repositories напрямую через
   generic dispatch. Weight adapter получает typed read port и возвращает typed
   comparison result.
2. `dry_run` не должен иметь writer dependency. PostgreSQL queries выполняются
   в read-only transaction; test должен доказать отсутствие mutations даже при
   ошибке и concurrent retry.
3. Sheets reader использует точный spreadsheet id
   `1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik`, metadata-derived numeric
   sheet ids и bounded ranges. Title search и guessed tab names запрещены.
4. Sheets adapter использует отдельную API-owned Google service identity с
   read-only доступом только к точному workbook. Secret доставляется существующим
   runtime-механизмом, не хранится в Git и не раскрывается в logs/reports.
5. Source identity и checksum являются разными полями. Weight dedupe identity
   не включает weight value или row number.
6. Duplicate authoritative date, missing/orphan mirror, mirror mismatch,
   source value/date change и target-only row дают typed conflicts и никогда не
   разрешаются last-write-wins.
7. Existing target по тому же identity считается `unchanged` только после
   сравнения всех нормализованных domain/provenance полей. Совпадение одного
   dedupe key недостаточно.
8. Invalid source не преобразуется частично. Missing time остаётся explicit
   `local_date` precision и не превращается в midnight instant.
9. Safe stdout содержит run metadata, counts, finding codes и bounded locators,
   но не raw source text, weights, health metrics или персональные значения.
10. Optional detail report создаётся только по explicit path, получает private
    permissions, не индексируется и не коммитится; его retention остаётся
    operator-controlled.
11. Результат стабильно сортируется по outcome, source key и locator, поэтому
    повторный запуск над одним snapshot даёт byte-stable safe report.
12. Import code не использует IntakeRequest/IntakeItem как migration state и не
    добавляет service, broker, scheduler или новую database boundary.
13. MCP coverage matrix для дальнейшего cutover перечисляет реальные writer
    types; current absence Recovery/Garmin tools фиксируется как blocker, а не
    скрывается под generic tool.

## Этапы после утверждения

1. [x] Зафиксировать operator approval ADR, плана и read-only backend credential
   strategy; TASK-0044 переведён в `developer` 2026-08-21.
2. [x] Согласовать exact live source ranges/headers через metadata-first
   read-only inspection без копирования personal values в task/docs.
3. [x] Добавить common import contracts и pure deterministic classifier.
4. [x] Реализовать typed Weight/`Daily_Log.Weight` normalization и source
   reconciliation поверх существующей policy.
5. [x] Реализовать target comparison port, который отличает semantic equality
   от dedupe collision и работает только в read-only transaction.
6. [x] Реализовать read-only Sheets adapter и one-shot `dry_run` command без
   обращения к live secret; runtime secret access остаётся отдельным gate.
7. [x] Добавить safe summary/detail report boundaries и no-sensitive-log tests.
8. [x] Добавить golden/property/unit tests для всех outcome и source-change
   сценариев.
9. [x] Добавить PostgreSQL integration tests для read-only comparison и zero
   writes; проверить clean migration chain без изменения schema. `unchanged`
   проверяется на typed adapter: текущая schema хранит только `instant` и по
   утверждённому ADR не может притвориться равной `local_date` source fact.
10. [x] Выполнить lint, typecheck, build, unit/integration, docs validator,
    identifier audit where applicable и `git diff --check`.
11. [x] Провести independent Quality и отдельный Architecture Review.
12. [x] После accepted Quality получить разрешение и выполнить current-state
    Wiki/changelog alignment. Apply/backfill и cutover остаются новыми задачами.

## Критерии приёмки

1. Exact workbook metadata и bounded Weight/Daily_Log ranges читаются только
   read-only adapter через approved credential.
2. Dry-run над одним snapshot детерминирован и даёт только
   `created / unchanged / conflict / invalid` с documented subcodes.
3. `Weight` остаётся единственным import authority; `Daily_Log.Weight` никогда
   не создаёт второй candidate/fact.
4. Repeated dates, mirror gaps/mismatches, malformed date/weight, changed
   source row и target-only facts покрыты тестами и не приводят к mutation.
5. Row movement не меняет source identity; row number не используется как
   dedupe identity.
6. Date-only Weight остаётся `local_date` precision; никакой искусственный
   timestamp не появляется в candidate, report или comparison.
7. Existing dedupe identity с отличающимся payload классифицируется как
   `conflict`, а не `unchanged`.
8. Unit/integration evidence доказывает ноль PostgreSQL writes, ноль Sheets
   writes и отсутствие persisted dry-run run state.
9. Logs и safe report не раскрывают personal values, raw source rows,
   credentials или health data.
10. Architecture остаётся расширяемой typed adapters для Body/Nutrition/
    Training/Recovery без generic JSON fact model.
11. Current Weight API, Intake, MCP и migration journal проходят regression
    tests без contract/schema change.
12. Cutover documentation явно блокирует transfer до полного MCP coverage,
    включая Garmin/Recovery, exclusive writer checkpoint и rehearsed rollback.

## План проверки

- Unit/golden: normalization, date/decimal locale, source identity/checksum,
  stable sorting и outcome matrix.
- Weight reconciliation: equal mirror, duplicate authority, missing/orphan
  mirror, multiple mirror values и mismatch.
- PostgreSQL integration: current/target-only reads, Person isolation,
  read-only enforcement и zero-write counts. Equal/differing typed target
  classification проверяется unit-тестами до появления утверждённого
  relational `local_date` contract.
- Failure injection: Sheets pagination/read failure, inconsistent snapshot,
  report sink failure и retry не создают state.
- Security: credentials/raw values отсутствуют в logs, errors, snapshots и
  committed fixtures.
- Regression: API lint/typecheck/build/unit, Weight/Physical State/Intake tests,
  migration-prefix suite при доступном Docker.
- Documentation: `node scripts/validate-docs.mjs`, board validate и
  `git diff --check`.

## Architecture Review checklist

1. Complexity: common kernel содержит только повторяемый lifecycle; domain
   mapping остаётся typed adapter.
2. Deployables: новый service/database/broker/scheduler отсутствует.
3. DDD: Physical State владеет Weight facts; import только сравнивает и позднее
   вызывает owning command.
4. Duplication: ADR хранит decision, Wiki — current state, plan — execution;
   Intake и import не дублируют lifecycle друг друга.
5. Simplification: Weight dry-run проверяет kernel до persisted backfill и не
   тащит cutover/MCP implementation в первый slice.

## Blocking questions

1. До apply-задачи отдельно утвердить exact relational temporal-precision
   contract и persisted import audit schema.

## Решение об утверждении

Оператор 2026-08-21 утвердил ADR, этот план и credential strategy: отдельная
API-owned Google service identity с read-only доступом только к точному workbook,
secret delivery через существующий runtime-механизм и отсутствие secret в Git.
Разрешён implementation только Weight dry-run. Google Sheets writes, live secret
access, PostgreSQL writes/migration, cutover, deploy, commit и push не разрешены.
