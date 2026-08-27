# TASK-0066 — Наблюдение MCP-only writer и готовность authority transfer

## Статус и разрешение

- Статус: completed; оператор командой `го` разрешил следующий описанный
  этап после TASK-0065 — bounded observation.
- Разрешены только read-only проверки ChatGPT project configuration, текущего
  Shape of You Staging MCP surface/read-back и точного `Fitness Tracker`
  workbook.
- Не разрешены: новые synthetic или operational writes, Google Sheets writes,
  authority transfer, изменение workbook permissions, production, secret
  access/disclosure, commit и push.

## Цель

Подтвердить, что после exclusive-writer switch конфигурация остаётся MCP-only,
единственный post-checkpoint synthetic факт читается, Google Sheets не дрейфует,
и подготовить чёткий go/no-go результат для отдельного решения об authority
transfer.

## План выполнения

1. [x] Зафиксировать TASK-0066 и bounded read-only scope.
2. [x] Проверить после reload, что проект `Фитнес-трекер` по-прежнему запрещает
   Google Sheets writes/fallback и использует один Shape of You Staging writer.
3. [x] Проверить доступность всех 23 MCP tools и прочитать bounded synthetic
   `DailyContextNote`/daily projection без новых записей.
4. [x] Прочитать metadata и те же девять bounded workbook ranges дважды,
   сравнить counts/checksums и доказать отсутствие наблюдаемого drift.
5. [x] Зафиксировать authority-transfer readiness и rollback constraint:
   synthetic note требует отдельного решения, authority ещё не переносится.
6. [x] Пройти independent Quality и Architecture Review, обновить только
   затронутую canonical Wiki при acceptance и завершить TASK-0066.

## Fail-closed

- Любая потеря MCP surface, read-back, MCP-only configuration или workbook
  drift означает `NO-GO`; writer configuration и authority не изменяются.
- Observation не создаёт новый факт и не удаляет TASK-0065 synthetic canary.
- Replay/exception synthetic note, authority transfer и workbook disposition
  требуют отдельных явных approvals.

## Критерии приёмки

1. Конфигурация проекта после reload остаётся MCP-only и запрещает Sheets.
2. Все 23 tools доступны; existing synthetic canary читается без записи.
3. Два bounded workbook capture совпадают и не содержат наблюдаемого drift.
4. Результат однозначно сообщает `READY` или `NO-GO` для отдельного authority
   decision, не выполняя сам transfer.
5. Private observation evidence удалено после независимой проверки.

## Architecture Review checklist

- Не создаются сервис, база, migration, scheduler или persistent observation
  entity.
- Writer location и data authority остаются разными понятиями переходного
  состояния согласно существующему cutover ADR.
- Один active writer, Person isolation и fail-closed rollback сохраняются.

## Operational evidence

- После нового reload проект `Фитнес-трекер` сохранил MCP-only инструкции:
  один `Shape of You Staging` writer, запрет Sheets/Drive writes, запрет
  fallback и fail-closed поведение при недоступном MCP.
- Текущий connector surface содержит ровно 23 Shape of You Staging tools.
- Read-only проверка даты `2000-01-02` вернула ровно одну TASK-0065 synthetic
  `DailyContextNote`; projection остаётся `open`, `isStale=false`, context note
  присутствует. Новые факты не создавались.
- Metadata точного workbook подтверждает прежние numeric sheet IDs. Два
  последовательных bounded capture девяти импортируемых ranges совпали
  полностью (`frozen=true`) по значениям и checksums.
- Drive metadata/revision history показывает последний `modifiedTime`
  `2026-08-27T06:18:09.958Z`, то есть до switch-time checkpoint
  `2026-08-27T12:43:50.768Z`. Наблюдаемого post-cutover Sheets drift нет.
- Первичное сравнение display row counts с прежним импортным summary выглядело
  как drift; read-only revision evidence и даты уже импортированных PostgreSQL
  facts доказали, что это различие способов подсчёта, а не post-cutover write.
- Результат observation: `READY` для отдельного authority-transfer decision.
  Сам transfer, workbook permissions/disposition, replay/exception synthetic
  note, production, commit и push не выполнялись.
- Private evidence на диск не сохранялось; временная browser tab закрыта.
- Independent Quality и Architecture Review: `ACCEPT`; `READY` относится
  только к отдельному operator authority-transfer decision и истекает при
  Sheets drift, потере MCP surface/read-back или новом необозначенном fact.
- Canonical Wiki синхронизирована; documentation validator, `git diff --check`
  и board validation прошли.
