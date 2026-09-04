# TASK-0096 — Независимый журнал удалений и безопасный Recovery restore

## Проблема

TASK-0094 реализовала удаление Recovery connection, checksummed manifest и
контейнерный restore test. Однако manifest экспортируется из той же API database
и может не успеть за уже завершённым удалением. Текущий тест не использует
независимо сохранённый журнал и не поднимает отдельный local PostgreSQL cluster.
Поэтому direct Garmin ingestion пока нельзя считать защищённым от resurrection
после восстановления старого backup.

## Цель

Реализовать accepted ADR
`20260904-use-independent-typed-recovery-erasure-journal.md`: до физического
удаления надёжно фиксировать accepted intent в независимом typed SQLite journal,
после удаления фиксировать completion и доказать реальным изолированным
`pg_dump`/`pg_restore` drill, что старый backup не возвращает удалённые raw или
derived Recovery data.

## Принятое решение

1. Использовать strict append-only SQLite schema, а не JSON как primary journal
   model.
2. Хранить отдельные typed `accepted` и `completed` events. Restore authority
   возникает на `accepted`; completion подтверждает завершение live deletion.
3. Не разрешать worker physical deletion до durable acknowledgement accepted
   event. При недоступном journal connection остаётся quarantined.
4. Проверять schema version, typed constraints, deterministic order, integrity
   chain, completeness cutoff и безопасные file permissions.
5. Хранить journal вне PostgreSQL snapshot/release boundary. Same-host файл без
   owner-approved independent immutable copy не считается готовым для Garmin.
6. Поднимать real temporary PostgreSQL 17 без Docker: private Unix socket или
   случайный port, никогда `5431`; использовать temporary data directory.
7. Не изменять shared cluster, compose, containers, `talking-to-ai`, общую
   backup policy или Garmin credentials.

## Этапы реализации

1. **Typed journal library.** Добавить SQLite schema/versioning, typed records,
   append-only triggers, idempotent accepted/completed writes, integrity chain,
   completeness checkpoints и private-file validation с использованием
   доступного в Node.js 24 `node:sqlite`, без новой dependency.
2. **Recovery lifecycle gate.** Добавить явное состояние journal
   acknowledgement в API-owned request model и migration file. Worker может
   физически удалить graph только после accepted acknowledgement. Подготовить
   migration и every-prefix tests, но не применять её ни к одной общей БД.
3. **Operational command.** Заменить primary manifest workflow на идемпотентную
   journal sync/inspect/apply команду. Не создавать набор одноразовых env vars;
   использовать существующий `DATABASE_URL` только для выбранной database и
   явный journal path/cutoff CLI contract. Старый JSON manifest оставить только
   при необходимости обратной совместимости.
4. **Restore readiness.** Перед apply проверять journal permissions, schema,
   integrity и completeness. Replay всех accepted intents выполнять
   идемпотентно; отсутствие completion не отменяет suppression.
5. **Real local restore harness.** Создать temporary PostgreSQL data directory,
   запустить отдельный instance на private socket/случайном не-`5431` port,
   восстановить pre-erasure custom-format backup, применить journal и выполнить
   domain assertions. Harness обязан останавливать instance при success/failure
   и не обращаться к shared cluster.
6. **Crash и negative tests.** Проверить сбои до accepted journal write, после
   accepted до deletion, после deletion до completion, duplicate sync, missing,
   incomplete, modified и permissive journal, а также сохранение manual facts и
   shared definitions.
7. **Owner-backed drill.** После отдельного разрешения получить существующий
   backup через approved IDE/owner mechanism без вывода credentials или данных
   в chat. Выполнить restore только в isolated temporary database и записать
   redacted evidence. Никаких shared-cluster writes.
8. **Quality и Architecture Review.** Провести independent acceptance по каждому
   критерию, проверить отсутствие лишнего deployable/JSON model/cross-service
   SQL и обновить только затронутые canonical docs после acceptance.

## Acceptance criteria

1. Каждый request имеет typed independent accepted event до physical deletion и
   typed completed event после неё; retries не создают конфликтующих записей.
2. Worker не удаляет graph без durable accepted acknowledgement; недоступный
   journal сохраняет quarantine и приводит к безопасному retry/blocked state.
3. Restore применяет accepted events независимо от наличия completed event и не
   открывает readiness при missing/incomplete/modified journal.
4. Journal не содержит health values, provider ids, labels, credentials,
   authentication proofs или raw payloads; основной storage не использует JSON.
5. Append-only constraints запрещают update/delete, integrity chain и
   completeness checkpoint проверяются до replay.
6. Реальный PostgreSQL 17 restore drill восстанавливает pre-erasure backup в
   отдельный temporary cluster и после replay не находит connection-derived raw
   и derived data, сохраняя unrelated manual data и shared definitions.
7. Drill не использует Docker/compose, shared cluster, `talking-to-ai` или порт
   `5431`; temporary instance останавливается даже после ошибки.
8. Maximum backup lifetime, journal retention, storage и immutable copy остаются
   явными owner approvals; без них Garmin ingestion остаётся blocked.
9. Migration file проходит clean/every-prefix и PostgreSQL identifier <=63-byte
   проверки, но migration не исполняется на общей database.
10. Targeted/full API checks, docs validation, independent Quality и
    Architecture Review проходят; изменяется только TASK-0096 scope.

## Проверки

- Typed journal unit tests: schema, constraints, idempotency, append-only,
  checksum/hash chain, permissions и corruption.
- Recovery integration tests: journal gating, crash points, retries и graph
  deletion.
- Restore harness tests с реальными `initdb`, `postgres`, `pg_dump` и
  `pg_restore` PostgreSQL 17 binaries.
- Negative readiness cases для missing/incomplete/modified journal.
- API lint, typecheck, unit и integration suites.
- Clean install, every migration prefix и identifier-length validation.
- `node scripts/validate-docs.mjs` и `git diff --check`.
- Independent Quality review и Architecture Review через 4DreamTeam.

## Действия владельца PostgreSQL

1. Сообщить maximum lifetime всех restorable logical backup и PITR windows.
2. Утвердить journal retention как maximum backup lifetime плюс safety margin.
3. Выделить protected storage вне PostgreSQL/release failure boundary и
   определить immutable independent copy/checkpoint procedure.
4. Предоставить существующий backup или выполнить approved export без передачи
   credentials в chat, task или repository.
5. Подтвердить backup timestamp и journal completeness cutoff для drill.

## Запрещено без отдельного подтверждения

- запуск source implementation до одобрения этого developer plan;
- выполнение migration, shared-cluster write или backup export;
- подключение к database через WebStorm или другой client;
- изменение порта `5431`, compose, containers или `talking-to-ai` services;
- установка dependency, deployment, staging/production operation;
- Garmin connection или хранение provider credentials;
- staging, commit или push.
