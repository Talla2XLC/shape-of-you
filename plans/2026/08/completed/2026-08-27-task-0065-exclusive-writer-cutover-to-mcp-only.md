# TASK-0065 — Exclusive-writer cutover Fitness Tracker на ChatGPT MCP-only

## Статус и разрешение

- Статус: completed; оператор явно разрешил следующий описанный этап командой
  `ок го` 2026-08-27 в текущем чате.
- Разрешены: остановка legacy ChatGPT Sheets writer, bounded switch-time capture,
  final staging reconciliation, проверка frozen checkpoint, переключение
  ChatGPT-проекта `Fitness Tracker` на единственный Shape of You Staging MCP
  writer и bounded typed write/read-back verification.
- Не разрешены: Google Sheets writes, одновременный dual-write, перенос
  PostgreSQL authority, изменение Sheets permissions, production, secret
  disclosure, commit и push.

## Цель

Без split-brain остановить legacy Google Sheets writer и переключить
операционные записи ChatGPT-проекта `Fitness Tracker` на единственный
Shape of You Staging MCP writer, сохранив проверяемый checkpoint и rollback
boundary. Google Sheets остаётся authority до отдельного решения оператора.

## План выполнения

1. [x] Зафиксировать TASK-0065, исходное состояние ChatGPT-проекта и rollback
   boundary без раскрытия приватных данных.
2. [x] Изменить инструкции legacy проекта на safe paused state, запрещающий
   новые Google Sheets и MCP writes во время switch-time checkpoint.
3. [x] Снять новые bounded private snapshots точного workbook после паузы и
   выполнить final `prepare`/reconciliation против staging.
4. [x] Выполнить независимый повторный capture и `verify-frozen`, доказав
   отсутствие новых Sheets writes после checkpoint.
5. [x] Повторно принять deployed writer evidence и выполнить zero-write
   rollback rehearsal относительно switch-time manifest.
6. [x] Изменить инструкции проекта на MCP-only: использовать только один
   `Shape of You Staging` connector для typed writes; Sheets writes запретить.
7. [x] Выполнить bounded synthetic typed write/read-back и убедиться, что
   legacy Sheets writer не возобновился.
8. [x] Провести independent Quality и Architecture Review; после acceptance
   обновить affected canonical Markdown и завершить TASK-0065.

## Fail-closed и rollback

- При любом drift, conflict, missing tool/scope, OAuth failure или неуспешном
  read-back проект остаётся в paused state; Sheets writer не возобновляется.
- Если после checkpoint появились PostgreSQL facts, их только перечисляет
  zero-write rollback rehearsal. Replay в Sheets не выполняется без отдельного
  явного разрешения.
- Authority transfer и archive/read-only изменение workbook остаются отдельным
  operator gate после observation window.

## Критерии приёмки

1. После pause два bounded capture имеют одинаковые checksums.
2. Final reconciliation имеет `failures=0`, `created=0`, `conflict=0`;
   terminal historical `invalid` допустим как evidence.
3. В любой момент существует только один разрешённый writer.
4. ChatGPT-проект после switch запрещает Sheets writes и направляет typed writes
   только через существующий Shape of You Staging MCP connector.
5. Bounded MCP write/read-back успешен и не меняет Google Sheets.
6. Rollback scope воспроизводим и Person-isolated; reverse replay не выполняется.
7. Google Sheets остаётся authority; permissions, production, Git commit/push
   не изменяются.

## Architecture Review checklist

- Existing exclusive-writer ADR и local phased preflight используются без
  нового сервиса, базы, migration, dependency или persistent CutoverSession.
- Typed fact ownership, Person isolation, deterministic idempotency и
  append-only correction сохраняются.
- Изменение writer configuration не трактуется как authority transfer.
- Наблюдение и последующий authority transfer остаются отдельными решениями.

## Operational evidence

- Проект `Фитнес-трекер` сначала был переведён в подтверждённый после reload
  no-write pause, запрещающий и Sheets, и MCP writes.
- Paused switch-time `prepare`: `created=0`, `unchanged=434`, `conflict=0`,
  `invalid=48`, `failures=0`.
- Второй независимый bounded capture: `verify-frozen=true`.
- Текущий connector surface содержит все 23 required tools; принятое
  TASK-0063 evidence повторно прошло `verify-writer=true` для 14 canaries.
- До switch rollback rehearsal вернул `requiresReplay=false` и ноль facts.
- После checkpoint проект сохранён как MCP-only после reload; инструкции явно
  запрещают Sheets writes и называют один Shape of You Staging writer.
- Bounded synthetic `daily_context_note` на дате `2000-01-02` записан через
  MCP и успешно прочитан обратно.
- Третий bounded capture после MCP write прошёл `verify-frozen=true`, то есть
  Google Sheets не изменился.
- Post-switch rollback rehearsal перечисляет ровно один synthetic
  `daily_context_note`; reverse replay в Sheets не выполнялся.
- Authority transfer, permissions, production, commit и push не выполнялись.
- Architecture Review принят: выполнена существующая exclusive-writer ADR без
  нового сервиса, базы, migration, persistent cutover entity или нового ADR.
- Canonical Wiki синхронизирована с переходным состоянием: MCP — единственный
  writer, Google Sheets остаётся authority, а synthetic note — rollback scope.
- Focused preflight unit suite прошёл `5/5`; documentation validator прошёл
  `53 Wiki / 62 ADR / 115 ID`; `git diff --check` и board validation прошли.
- Временный SSH tunnel закрыт и проверен как недоступный; только точные
  TASK-0065 private snapshots, manifest, Person-id evidence и helper scripts
  удалены из `/private/tmp` без вывода их содержимого.
