# TASK-0046 — Первый контролируемый staging Weight dry-run

## Статус и разрешение

- Статус: implementation accepted 2026-08-23; ожидает commit и отдельных
  operational approvals.
- Текущий owner: `release`.
- Оператор одобрил начало TASK-0046 и ранее утвердил credential strategy:
  отдельная API-owned Google service identity, read-only доступ только к точному
  workbook, secret через существующий runtime-механизм, без хранения в Git.
- Оператор явно утвердил ADR и план командой `го` 2026-08-23.
- Реальные credentials, изменение workbook sharing, staging deploy и live
  dry-run остаются отдельными явными operational gates.

## Цель

Подготовить воспроизводимый least-privilege staging runtime для уже
реализованного единого Fitness Tracker importer и после отдельного допуска
выполнить первый Weight dry-run против точного workbook и staging PostgreSQL,
получив безопасные `created / unchanged / conflict / invalid` counts без записи
в обе системы.

## Входит

1. Один dedicated one-shot Compose service/profile на существующем API image.
2. Отдельный root-owned importer environment file mode `0600`, не подключённый
   к обычному API и migration container.
3. Optional complete credential delivery через существующий staging deployment
   controller и manual boolean trigger, default `false`.
4. Fail-closed validation для missing/partial configuration.
5. Exact Weight dry-run command и только safe aggregate output.
6. Deployment/Compose/security tests и operator instructions без secret values.
7. После отдельного разрешения: конфигурация runtime values и один live dry-run.
8. Independent Quality, Architecture Review и post-acceptance Wiki/changelog.

## Не входит

- Новый Weight-specific или второй migration framework.
- Google Sheets writes, PostgreSQL apply или автоматическое исправление фактов.
- Body/Nutrition/Training/Recovery adapters.
- Scheduler, recurring dual-run, cutover, rollback execution или authority
  transfer.
- Создание, чтение или раскрытие secret до отдельного разрешения.
- Staging deploy, commit или push без соответствующего явного разрешения.

## Реализация

1. [x] Утвердить dedicated one-shot staging runtime ADR и этот план.
2. [x] Добавить manual workflow trigger и optional importer inputs/secret refs;
   автоматический publish path оставляет trigger `false`.
3. [x] Расширить deployment controller complete-set validation и атомарной
   записью отдельного `fitness-tracker-import.env` mode `0600`.
4. [x] Добавить one-shot Compose service без ports и browser secrets, с
   минимальным network/filesystem access и exact importer command.
5. [x] Запускать dry-run только при явном trigger; не создавать private artifact
   и печатать только safe report.
6. [x] Покрыть deployment contract: no-credentials automatic deploy, complete
   manual run, partial config rejection, no secret logging и command failure.
7. [x] Выполнить lint, typecheck, build, unit/integration tests, Compose config,
   docs validator и `git diff --check`.
8. [x] Провести independent Quality и Architecture Review; после принятия
   обновить только затронутые current-state Wiki/changelog.
9. [ ] Отдельно запросить operational approval на service identity/workbook
   read-only sharing, GitHub Environment configuration и staging deploy.
10. [ ] После отдельного live-run approval выполнить один Weight dry-run,
    сохранить только безопасные counts/status и проверить отсутствие mutations.
11. [ ] Представить результат и отдельно решить дальнейший dual-run; никогда не
    переходить к `apply` или cutover автоматически.

## Критерии приёмки

1. Используется существующий единый importer; второго migrator нет.
2. Обычный API, frontend и migration container не получают Google credentials.
3. Автоматический staging deploy работает без importer configuration и никогда
   не запускает dry-run.
4. Manual trigger без полного набора параметров завершается до importer run.
5. Dedicated environment file создаётся атомарно, принадлежит root, имеет mode
   `0600` и не выводится в logs.
6. One-shot service не публикует ports, не получает browser secrets и выполняет
   только `--domain weight --mode dry-run`.
7. Safe output содержит counts/status, но не credentials, raw cells,
   Weight/date values или private report.
8. Dry-run не пишет в Google Sheets и PostgreSQL и не меняет authority.
9. Exact workbook ID и read-only Sheets scope остаются статически ограничены
   существующим reader contract.
10. Будущие typed adapters используют тот же runtime без нового deployment
    механизма.
11. Live run не начинается без отдельных credential, workbook, deploy и
    execution approvals.

## План проверки

- Unit/contract: envelope parsing, complete-set validation, boolean trigger,
  redaction и exact command.
- Deployment: automatic path without secrets, manual fail-closed paths,
  atomic `0600` environment file handling.
- Compose: resolved service config, no ports/browser env, database connectivity,
  read-only filesystem где применимо.
- Repository: lint, typecheck, build, tests, docs validator и diff check.
- Live gate: safe counts/status, importer exit code и before/after proof нулевых
  mutations без публикации private facts.

## Решение об утверждении

Оператор утвердил ADR и этот план командой `го` 2026-08-23. Implementation
выполняется одним delivery циклом в TASK-0046; operational live-run gates не
считаются утверждёнными автоматически.
