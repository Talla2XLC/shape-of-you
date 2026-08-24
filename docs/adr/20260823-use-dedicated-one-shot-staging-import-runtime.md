---
id: "decisions-20260823-use-dedicated-one-shot-staging-import-runtime"
kind: adr
title: "Использовать отдельный одноразовый staging runtime для Fitness Tracker importer"
status: superseded
date: 2026-08-23
supersedes: []
superseded_by: "decisions-20260823-run-controlled-sheets-imports-from-operator-workstation"
tags:
  - "credentials"
  - "data-migration"
  - "google-sheets"
  - "staging"
---

# Использовать отдельный одноразовый staging runtime для Fitness Tracker importer

## Context

Единый Fitness Tracker importer уже реализован внутри API modular monolith и
поддерживает `weight` в режимах `dry-run` и `apply`. Следующий шаг — выполнить
первый реальный staging Weight dry-run против точного workbook `Fitness
Tracker` и staging PostgreSQL, не изменяя ни один источник.

Текущий staging deployment использует GitHub Actions, фиксированный root
bootstrap и versioned deployment controller. Пример runtime environment уже
называет `FITNESS_TRACKER_PERSON_ID` и Google service-account credentials, но
workflow и controller их не доставляют. Controller также формирует общий
`api.env`, который подключается к постоянно работающему API и migration
container. Добавление Google private key в этот файл неоправданно расширило бы
доступ к workbook.

Google Sheets остаётся operational authority. Одобренная credential strategy
требует отдельную API-owned Google service identity с read-only доступом только
к точному workbook; secret доставляется существующим runtime-механизмом и не
хранится в Git. Реальный secret access, изменение workbook sharing и запуск с
живыми данными требуют отдельных явных разрешений оператора.

## Decision

Использовать существующую staging deployment boundary для доставки параметров,
но запускать importer в отдельном одноразовом Compose service/profile на базе
того же API image. Не создавать новый migrator, deployable service, database
или scheduler.

Для importer создать отдельный root-owned environment file
`/etc/shape-of-you/staging/fitness-tracker-import.env` с mode `0600`. Он содержит
только необходимые one-shot процессу значения: staging `DATABASE_URL`,
`FITNESS_TRACKER_PERSON_ID`, `GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL` и
`GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY`. Этот файл не подключается к
постоянно работающему API, migration container или frontend.

Deployment envelope получает optional complete credential set и отдельный
boolean trigger для Weight dry-run. Обычный автоматический publish/deploy всегда
передаёт trigger `false`, не требует Google credentials и сохраняет текущий
deploy behavior. Ручной одобренный запуск с trigger `true`:

1. принимается только при полном наборе непустых параметров;
2. атомарно создаёт или обновляет dedicated environment file с mode `0600`;
3. запускает exact command
   `node dist/commands/import-fitness-tracker.js --domain weight --mode dry-run`;
4. публикует только safe aggregate report `created / unchanged / conflict /
   invalid` и технический статус;
5. завершает deployment с ошибкой при partial configuration или failed dry-run.

Private key хранится в GitHub Environment secret в однострочном escaped
представлении и восстанавливает переводы строк только внутри importer process.
Secret values, raw cells, Weight/date values и private report не попадают в
workflow output, command line, repository или artifacts.

One-shot service не публикует ports, подключается только к необходимой database
network, не получает API browser secrets и завершается после команды. По
возможности filesystem остаётся read-only с отдельным temporary filesystem для
runtime needs.

Первая поставка меняет только wiring и тестируемый manual trigger. Фактическое
создание service identity, выдача ей read-only доступа к точному workbook,
запись GitHub Environment values и real-data dry-run выполняются позднее как
отдельный operator-approved operational gate в рамках той же TASK-0046.
`apply`, scheduler, cutover и смена authority запрещены.

## Considered alternatives

- **Добавить Google credentials в общий `api.env`.** Проще, но постоянно
  работающий API и migration container получают ненужный private key. Это
  нарушает least privilege.
- **Dedicated one-shot env и Compose service через существующий controller.**
  Выбран: переиспользует проверенную deployment boundary, ограничивает lifetime
  и получателей secret и запускает уже существующий единый importer.
- **Выполнить ad hoc SSH/Docker command.** Быстрее для одного запуска, но хуже
  воспроизводится, расширяет ручную root-операцию и оставляет слабый
  проверяемый deployment contract.
- **Создать отдельный migration service или scheduler.** Отклонено как
  преждевременная deployable и operational complexity до доказанной
  необходимости recurring dual-run.

## Consequences

- Google private key отсутствует в runtime обычного API и доступен только
  bounded one-shot process.
- Обычный staging deploy продолжает работать без Google credentials.
- Dry-run становится воспроизводимым и наблюдаемым через существующий deploy
  path, но live execution по-прежнему требует отдельного разрешения.
- Root-owned host environment file становится дополнительным секретным runtime
  объектом, который controller обязан создавать атомарно и никогда не печатать.
- Следующие typed adapters смогут использовать тот же one-shot service и общий
  importer command без отдельных deployment механизмов.
- Это решение не разрешает PostgreSQL writes, Google Sheets writes, recurring
  schedule, ChatGPT writer cutover или authority transfer.

## Verification

- Deployment contract tests подтверждают, что автоматический deploy не требует
  importer credentials и не запускает dry-run.
- Tests отклоняют partial credential set и trigger без complete configuration.
- Tests подтверждают отдельный file path/mode, отсутствие importer secrets в
  обычном API environment и отсутствие secret values в logs.
- Compose validation подтверждает отсутствие ports и browser secrets у
  one-shot service, корректную database network и exact dry-run command.
- Staging rehearsal без live credentials проверяет fail-closed behavior.
- После отдельного operator gate реальный запуск подтверждает только safe
  outcome counts и нулевые записи в Google Sheets/PostgreSQL.
- Architecture Review проверяет отсутствие второго migrator, нового deployable,
  premature scheduler и расширения credential exposure.

## Related material

- [Pull-based import and exclusive writer cutover](20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Relational import batches and Weight temporal precision](20260821-use-relational-import-batches-and-explicit-weight-temporal-precision.md)
- [Deployment architecture](../wiki/architecture/deployment.md)
- [TASK-0046 plan](../../plans/2026/08/completed/2026-08-23-task-0046-first-staging-weight-dry-run.md)
