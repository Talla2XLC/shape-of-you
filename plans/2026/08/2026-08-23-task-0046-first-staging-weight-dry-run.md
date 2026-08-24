# TASK-0046 — Первый локально управляемый staging Weight dry-run

## Статус и разрешение

- Статус: revised и approved 2026-08-23, implementation in progress.
- Текущий owner: `developer`.
- Оператор уточнил, что migration/reconciliation runs являются ограниченными
  ручными операциями, и утвердил local operator-run вместо server runtime.
- Предыдущее staging credential решение superseded до создания credentials или
  live run; dormant wiring удаляется.
- Google Sheets остаётся read-only authority. Реальный snapshot read, staging
  connection и live dry-run разрешены; `apply`, cutover и Sheets writes нет.

## Цель

Использовать установленный Google connector для bounded read точного workbook,
передать эфемерный private snapshot существующему единому importer и локально
получить первый Weight dry-run baseline против staging PostgreSQL без Google
Cloud/service identity и без записи в обе системы.

## Входит

1. Versioned typed snapshot-file contract для существующего Weight adapter.
2. `--snapshot-file` в общей importer command без второго lifecycle.
3. Валидация exact workbook metadata, sheet ids/titles, headers, scalar cells,
   checksum, размера, regular-file/no-symlink и mode `0600`.
4. Удаление неиспользованного staging credential/trigger/Compose plumbing.
5. Unit/integration/deployment regression tests.
6. Codex connector read только metadata и bounded Weight/Daily_Log ranges.
7. Private temporary snapshot вне Git, локальный dry-run и гарантированный
   cleanup после отдельно проверенного staging connection.
8. Safe counts/status, Quality, Architecture Review и Wiki/changelog.

## Не входит

- Извлечение или передача OAuth token Codex connector.
- Google Cloud service identity, key или workbook sharing change.
- Второй migrator, agent-side classification или XLSX whole-workbook export.
- Google Sheets writes, PostgreSQL apply или автоматический conflict repair.
- Scheduler, unattended recurring run, Body/Nutrition/Training/Recovery
  adapters, cutover, rollback execution или authority transfer.
- Commit/push без отдельного разрешения.

## Реализация

1. [x] Утвердить superseding ADR и revised plan.
2. [x] Добавить validated private snapshot reader и versioned contract.
3. [x] Подключить `--snapshot-file` к общей command без Google credentials.
4. [x] Покрыть schema, checksum, metadata, permission/symlink/size и CLI source
   selection tests.
5. [x] Удалить dormant staging workflow/controller/Compose credential path и
   обновить deployment contracts.
6. [x] Выполнить lint, typecheck, build, unit, доступные staging contracts,
   docs validator и `git diff --check`; зафиксировать недоступность локального
   Docker-backed integration runtime.
7. [x] Провести independent Quality и Architecture Review, обновить Wiki и
   changelog.
8. [x] После accepted implementation прочитать exact metadata и bounded ranges
   через Google connector, создать private snapshot `0600` вне repository.
9. [x] Установить подтверждённый read-only доступ к staging PostgreSQL,
   выполнить тем же classifier один Weight dry-run и удалить snapshot.
10. [x] Зафиксировать только safe counts/status и решить следующий manual
    reconciliation run; не переходить к `apply` автоматически.

## Критерии приёмки

1. Используется существующий единый importer и Weight adapter.
2. `--snapshot-file` не требует и не читает Google credentials.
3. Snapshot exact/versioned/bounded, checksum-protected, regular, не symlink,
   mode `0600`, ограничен по размеру и удаляется после operation.
4. JSON остаётся только ephemeral raw evidence и не попадает в PostgreSQL как
   замена relational model.
5. Connector читает точный workbook в пределах максимумов
   `Weight!A1:B5000` и `Daily_Log!A1:AZ5000`, обрезанных до metadata grid
   bounds; Sheets writes отсутствуют.
6. Staging runtime больше не принимает и не хранит importer credentials и не
   содержит importer trigger/service.
7. Dry-run выполняет PostgreSQL comparison read-only, не создаёт batch/facts и
   выводит только safe report.
8. Raw cells, Weight/date values, connector token, database URL и credentials
   не попадают в Git, logs, artifacts, board, Wiki или chat.
9. `apply`, recurring automation и cutover остаются отдельными gates.

## План проверки

- Unit: valid snapshot, deterministic checksum, invalid version/metadata,
  unknown fields, bad scalar/locator, oversized row sets, symlink, permissive
  mode, oversized file и checksum mismatch.
- CLI: snapshot selection, no Google credential requirement, mutually exclusive
  source configuration и safe output.
- Integration: существующий real PostgreSQL read-only Weight dry-run и zero
  mutations.
- Deployment: automatic staging path без importer fields/service/env.
- Operational: connector metadata/range bounds, private file mode, exact
  command, safe counts и cleanup.

## Operational evidence

- Exact workbook metadata подтверждены: `Fitness Tracker`, `ru_RU`,
  `Europe/Moscow`, numeric sheet ids `Weight=830411075`, `Daily_Log=0`.
- Фактические grid bounds дали read-only ranges `Weight!A1:B1000` и
  `Daily_Log!A1:AJ1000`; получено 22 и 35 range rows соответственно, пустые
  промежуточные строки нормализованы так же, как live reader.
- Staging PostgreSQL прочитан официальным target reader через локальный SSH
  tunnel `talla2xlc@2.58.15.24`; runtime secret использован только в памяти
  процесса и не выводился/не сохранялся.
- Accepted safe dry-run counts: `created=20`, `unchanged=0`, `conflict=0`,
  `invalid=0`.
- Private mode-`0600` snapshot удалён после запуска. Sheets и PostgreSQL не
  изменялись.
- `lint`, `typecheck`, `build`, 78 unit tests, docs validation и статические
  staging contracts прошли. Docker-backed integration/runtime tests не
  запускались, потому что локальный Docker daemon недоступен; PostgreSQL
  lifecycle code в этом изменении не менялся.

## Решение об утверждении

Оператор утвердил переход к local operator-run командой `ок го` 2026-08-23.
Live operation ограничена Weight `dry-run`; дальнейшие writes и cutover не
разрешены.
