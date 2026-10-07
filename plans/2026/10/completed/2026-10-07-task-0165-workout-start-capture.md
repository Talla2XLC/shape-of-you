# TASK-0165 — восстановить временные факты для сопоставления тренировок

## Статус и объём

Оператор отклонил date-only matching: у provider есть время, сообщение о
начале/завершении должно сохранять соответствующие временные факты.
Предыдущее date-only предложение отклонено и не реализовано. Конкретные ADR
и implementation plan после диагностики одобрены сообщением «го».
Локальная реализация принята независимой Quality; staging delivery ещё не
выполнялась. Commit/push/deploy и персональные записи требуют своих разрешений.

Отклонённая альтернатива: [rejected ADR](../../../../docs/adr/20261007-link-unique-date-only-strength-recordings.md).
Только Training association; не менять прогрессию веса, программу, Nutrition
или внешние provider contracts.

## Выполненная диагностика

1. Проверить current session и predecessor history: был ли сохранён старт,
   не потерян ли occurredAt при correction/завершении.
2. Сверить provider начало и audit createdAt; не объявлять audit временем
   фактического начала. Конец тренировки не заменяет начало.
3. Проверить доступный Coach контракт capture/correction и представление
   схемы реальному клиенту; server schema tests не доказывают client usability.
4. Для проверки исходного сообщения нужны его timestamp и фактический tool
   request/response; отсутствие в БД не доказывает отсутствие сообщения в чате.
5. Подготовить доказанный remedial scope и при необходимости отдельное ADR
   для now-report temporal evidence, сохраняя его provenance и precision.

## Критерий приёмки

Сообщённое время старта сохраняется и переживает постепенные уточнения и
завершение; imported время доступно для сопоставления. End-only report не
превращается в invented start. Источник now-report и его provenance определены принятым ADR; реальное
client projection и conversational canary проверяются после отдельной доставки.

## Одобренный implementation plan после диагностики

[Accepted ADR](../../../../docs/adr/20261007-capture-reported-workout-start-time.md).
После диагностики оператор отдельно одобрил конкретные ADR и implementation
plan сообщением «го». Разрешена реализация этого объёма с независимой Quality;
commit/push/deploy и live writes требуют отдельных разрешений.

1. V2 MCP publication adapter сохраняет common properties без root temporal
   и nested measurement unions; normalization validates original schemas.
   Проверить реальное client projection, не только server tools/list.
2. MCP-only startReportedNow при прямом немедленном начале создаёт in_progress
   со временем injectable server clock и manual mcp_start_report:v1 provenance.
   При явном времени сохраняется оно. Никаких новых DB entities/migrations.
3. Уточнить create/correction descriptions и per-result guidance: начало,
   постепенные sets, completion с прежним стартом, honest end-only report.
   SourceReference и старт сохраняются при сборке full replacement.
4. Boundary tests + isolated PostgreSQL: clock rollover, duplicate retry,
   completed current/history, actual matching с late/provider-first импортом,
   invalid input/provenance и conflicting/ambiguous evidence.
5. Relevant checks, independent Quality, Architecture Review; после acceptance
   обновить affected canonical Training Wiki, docs validator. Перенести
   завершённый план в completed только после принятой реализации.
6. Отдельные commit/push/deploy и conversational canary. Не менять вчерашнюю
   персональную сессию автоматически и не записывать synthetic live workout.

## Новые доказательства 2026-10-07

Synthetic MCP probe /private/tmp/shape-task0165-temporal-probe.mjs:
explicit start и completion dispatch сохраняют timestamp; note-only Started now
не создаёт timestamp. Это stub dispatch, не DB history test.
Доступная connector декларация create скрывает common fields, correction sets
скрывают остальные measured properties. Exact historical причина неизвестна.
Provider normalizer сохраняет start_date: defect investigated in chat capture.

## Приёмка локальной реализации

- Developer: task-0165-start-capture-implementation-20261007.
- Independent Quality: task-0165-start-capture-quality-20261007, accepted.
- Architecture Review: task-0165-architecture-review-20261007; существующие
  domain ownership, service boundaries и matching policy сохранены.
- API: typecheck/build/scoped lint; 392 unit. Relevant PostgreSQL: 24 проверки
  (5 нового MCP пути, 3 V2 capture, 16 Training), включая canonical retry,
  completion history, оба порядка импорта и отказ при далёком времени.
- Canonical API Wiki обновлена после acceptance; docs validator обязателен.

## Отдельная доставка и проверка живого клиента

Изменения ещё не committed/pushed/deployed. После отдельно одобренной доставки
проверить exact workflow migrations/readiness/smoke, обновлённую декларацию
реального клиента с common fields и combined set measurements, затем живой
start → sets → completion → provider сценарий. Локальная tools/list проверка
не является доказательством regenerated client projection. Персональная
историческая сессия автоматически не менялась. PostgreSQL migration не нужна.
