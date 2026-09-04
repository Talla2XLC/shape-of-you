---
id: use-independent-typed-recovery-erasure-journal
kind: adr
title: "Хранить принятые и завершённые удаления Recovery в независимом типизированном журнале"
status: accepted
date: 2026-09-04
supersedes: []
superseded_by: null
tags:
  - architecture
  - privacy
  - recovery
  - restore
  - sqlite
---

# Хранить принятые и завершённые удаления Recovery в независимом типизированном журнале

## Context

ADR `20260903-enforce-recovery-retention-and-authenticated-connection-erasure`
требует не допускать возврата удалённых Recovery-данных после восстановления
старого PostgreSQL backup. TASK-0094 добавила checksummed manifest export/apply и
интеграционный drill, но manifest строится из `recovery_erasure_requests` в той
же API database. Если database потеряна после удаления, но до следующего
экспорта, независимо сохранённого marker может не существовать. Текущий drill
также передаёт manifest в памяти и восстанавливает backup внутри тестового
container, поэтому не доказывает операционную независимость журнала или
восстановление отдельной PostgreSQL instance.

Общий PostgreSQL cluster, порт `5431`, compose, containers и сервисы
`talking-to-ai` нельзя изменять. Общая backup policy остаётся у владельца
cluster. Реальные Garmin data и credentials не входят в решение. Для небольшого
числа privacy markers не нужен новый deployable или отдельная сетевая database,
но обычный JSON-файл не должен становиться основной моделью журнала.

Одного журнала только завершённых операций недостаточно для crash safety. Если
данные уже физически удалены, а completion event ещё не записан независимо,
потеря основной database снова оставит старый backup без suppression marker.
Поэтому restore authority должна возникать до физического удаления.

## Decision

Recovery использует отдельный typed append-only SQLite journal. Его schema
содержит нормальные строго типизированные таблицы и constraints для двух
событий одного `RecoveryErasureRequest`:

1. `accepted` фиксирует `requestId`, `personId`, `connectionId`, reason и
   acceptance time до разрешения физического удаления;
2. `completed` ссылается на тот же request и фиксирует completion time после
   успешного удаления dependency graph.

Никакие health values, provider record ids, labels, Garmin credentials,
authentication proofs или raw payloads в журнал не входят. Идентификаторы и
enum-like значения проверяются при записи и чтении. Таблицы запрещают update и
delete; повторная запись того же события идемпотентна. Последовательность имеет
детерминированную integrity chain и проверяемый completeness checkpoint. Эта
цепочка обнаруживает повреждение, но не заменяет owner-controlled access,
immutable storage или independent copies.

Физическое удаление выполняется только после durable acknowledgement события
`accepted`. Если journal недоступен, connection остаётся quarantined, а worker
не завершает deletion. После удаления событие `completed` может быть безопасно
дозаписано повтором. Restore replay использует все применимые `accepted`
events, даже если соответствующий `completed` event отсутствует: privacy-safe
повторное удаление важнее сохранения данных из старого backup. Completion event
служит доказательством того, что live deletion дошло до конца, но не создаёт
restore authority.

SQLite journal хранится в owner-approved location вне PostgreSQL snapshots,
release directories и restorable API database boundary. Файл на том же host без
подтверждённой independent durable copy не удовлетворяет решению. Владелец
cluster определяет maximum backup/PITR lifetime, safety margin, storage,
encryption, access, immutable copy/checkpoint procedure и удаление истёкших
markers. Retention журнала превышает максимальную жизнь любого restorable
backup на согласованный запас.

Операционная команда синхронизирует accepted/completed state между API database
и journal идемпотентно. Она использует один постоянный typed configuration
contract или явные CLI arguments; одноразовые env-переменные не создаются.
Существующий JSON manifest может остаться только versioned interchange artifact
для совместимости, но не является первичным journal authority.

Restore drill поднимает отдельный временный PostgreSQL 17 cluster в temporary
directory, доступный только через private Unix socket или автоматически
выбранный не-`5431` port. В него выполняется настоящий `pg_restore` старого
logical backup. До readiness команда проверяет journal schema, integrity и
completeness cutoff, повторяет accepted erasures, а затем доказывает отсутствие
connection-derived raw и derived data и сохранность unrelated manual data.
Missing, unreadable, modified или incomplete journal оставляет restore
fail-closed. Общий cluster и его backup policy drill не изменяет.

## Considered alternatives

- **Оставить cumulative immutable JSON manifests основной authority.** Это
  требует минимальных изменений, но между удалением и экспортом остаётся gap;
  snapshot сложнее доказать полным, а JSON хуже выражает append-only relational
  invariants.
- **Создать отдельную PostgreSQL database.** Typed constraints и querying
  удобны, но database в общем cluster не независима от его failure/restore
  boundary. Отдельная instance добавляет credentials, availability, backup и
  сетевую эксплуатацию ради очень малого журнала.
- **Записывать события прямо в WORM object storage.** Даёт сильную fault-domain
  isolation и retention enforcement, но вводит внешний service contract,
  credentials, SDK и object serialization. Это допустимое дальнейшее усиление
  или место для immutable SQLite checkpoints.
- **Хранить только completion events.** Проще, но оставляет crash window между
  physical deletion и независимой записью. Поэтому rejected.
- **Хранить SQLite только на application host.** Не защищает от потери host или
  общего restore/rollback boundary и не считается независимым хранением.

## Consequences

- Старый backup подавляется по independently durable accepted intent даже при
  сбое до completion event.
- Journal имеет небольшую typed model без нового deployable, network port или
  общей service database.
- Недоступность journal не возвращает данные в reads: quarantine сохраняется,
  но physical deletion и restore readiness останавливаются fail-closed.
- Понадобится API migration для явного journal acknowledgement/state и строгой
  worker gating. Migration file можно подготовить в implementation, но нельзя
  применять без отдельного подтверждения.
- Потребуются lifecycle tests для crash points, append-only/integrity checks и
  отдельный local PostgreSQL restore harness без Docker.
- До owner-approved storage, retention и реального restore evidence прямой
  Garmin ingestion остаётся заблокирован.

## Verification

- Unit tests проверяют SQLite schema, typed constraints, idempotency,
  append-only запреты, integrity chain, permissions и corruption detection.
- Integration tests доказывают порядок `accepted -> physical deletion ->
  completed` и fail-closed поведение при каждом crash point.
- Worker не claim/complete request без durable journal acknowledgement.
- Реальный drill создаёт pre-erasure logical backup, завершает удаление,
  восстанавливает backup в отдельный local PostgreSQL cluster, применяет journal
  и проверяет raw/derived absence и сохранность unrelated manual observation.
- Негативные drill cases отклоняют missing, incomplete и modified journal до
  readiness.
- Проверяется, что temporary cluster не слушает `5431`, не использует Docker и
  не подключается к shared PostgreSQL.
- API tests, migration-prefix/identifier checks, docs validation, independent
  Quality и Architecture Review проходят до completion.

## Related material

- [Recovery retention and authenticated erasure](20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)
- [Recovery and Readiness](../wiki/domain/recovery-and-readiness.md)
- [Staging PostgreSQL backup and restore](../wiki/operations/postgresql-backup-and-restore.md)
- [Data ownership](../wiki/architecture/data-ownership.md)

