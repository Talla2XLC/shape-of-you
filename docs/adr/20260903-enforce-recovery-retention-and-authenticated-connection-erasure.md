---
id: enforce-recovery-retention-and-authenticated-connection-erasure
kind: adr
title: "Исполнять retention и удалять данные Recovery по подключению после свежей аутентификации"
status: accepted
date: 2026-09-03
supersedes: []
superseded_by: null
tags:
  - architecture
  - privacy
  - recovery
  - identity
  - retention
---

# Исполнять retention и удалять данные Recovery по подключению после свежей аутентификации

## Context

Recovery уже хранит Person-owned подключения, устройства, согласия и typed
observations. Согласие поддерживает `indefinite` и `until`, однако срок
`retainUntil` пока не исполняется, а отзыв согласия только прекращает будущий
сбор. Реальные данные wearable запрещены, пока пользователь не может надёжно
удалить сведения, полученные через конкретное подключение.

Удаление одного observation недостаточно. RecoveryAssessment ссылается на
исходные observations, а CoachingRecommendation и решение пользователя могут
зависеть от assessment. Обычная browser session подтверждает, что пользователь
когда-то вошёл, но не доказывает его недавнее осознанное подтверждение
необратимой операции. Одновременное удаление всего графа в HTTP request плохо
переносит повтор запроса, сбой процесса, большие истории и автоматическое
истечение retention.

Удаление только в активной PostgreSQL также не решает восстановление старой
резервной копии. Маркер, находящийся лишь в том же database snapshot, исчезнет
вместе с более новой базой. Поэтому процедура восстановления обязана иметь
независимо восстанавливаемый журнал уже принятых запросов на удаление и
применять его до открытия API-трафика. Точный storage и срок хранения backup
пока определяет владелец общего PostgreSQL cluster; реальные provider данные
нельзя включать, пока этот операционный контракт не реализован и не проверен.

## Decision

API владеет durable lifecycle удаления одного Recovery connection. Новый
typed `RecoveryErasureRequest` является одновременно idempotency boundary,
очередью работы и минимальным audit receipt. Он хранит только непрозрачные
идентификаторы scope, lifecycle timestamps, состояние, attempts и безопасный
код результата; health values, provider credentials, labels, raw payloads и
authentication proof в нём не сохраняются.

Пользователь запускает удаление только из authenticated Web privacy/security
UI. Перед созданием запроса Identity проводит новую passkey ceremony и выдаёт
API короткоживущую, одноразовую, purpose-bound authority. Долгоживущей browser
session и одного CSRF token недостаточно. Identity не читает API database, а
API не читает Identity database: подтверждение передаётся по versioned HTTP
contract, привязывается к account subject, client session, цели
`recovery_connection_erasure` и конкретному connection id, затем атомарно
погашается API. MCP не публикует destructive tool.

В одной API transaction создаётся или возвращается прежний idempotent request,
активные consent отзываются, connection отключается и становится скрытым от
collection и всех Person reads. Эта fail-closed quarantine действует сразу,
даже если физическое удаление продолжится позднее. Любая новая device запись
по connection отклоняется.

API-owned worker внутри существующего deployable забирает request с безопасной
арендой и повторяет идемпотентные шаги. Он удаляет только данные, чьё
происхождение зависит от выбранного connection, в порядке зависимостей:

1. Coaching decisions, recommendations и evidence, зависящие от удаляемых
   Recovery assessments;
2. Recovery assessment evidence и сами assessments, зависящие от удаляемых
   observations;
3. typed detail rows, import bookkeeping и Recovery observations;
4. ставшие непривязанными Person-owned source references;
5. connection-owned devices, consent state и connection.

Shared provider, model, capability и policy definitions не удаляются. Manual
observations без connection, включая факты со screenshot, не входят в этот
scope. Assessment или recommendation удаляется целиком, если хотя бы часть его
evidence зависит от удаляемого connection: после стирания исходного health fact
нельзя оставлять производный вывод, который его раскрывает.

`retainUntil` использует тот же lifecycle: scheduler создаёт тот же
idempotent request, quarantine и worker path. `indefinite` означает хранение до
явного удаления пользователем; произвольный общий предельный срок не вводится.

После завершения остаётся только минимальный receipt и erasure marker. Маркер
хранится дольше максимального срока существования резервной копии с запасом.
Backup boundary должна сохранять append-only erasure manifest независимо от
restorable database snapshot. Любое восстановление выполняется в изоляции,
проверяет полноту manifest, повторно применяет все применимые markers и только
после этого разрешает readiness и внешний трафик. Если manifest недоступен,
неполон или его срок нельзя сопоставить с backup, восстановленный API остаётся
закрытым. Intentional point-in-time recovery на момент до удаления не отменяет
удаление.

TASK-0094 ограничен connection-scoped Recovery erasure. Account-wide deletion,
другие домены, provider credentials и Garmin ingestion остаются отдельными
решениями. Новый deployable, общая service database и cross-service SQL не
создаются.

## Considered alternatives

- **Синхронно удалить весь граф одним HTTP request.** Меньше сущностей, но нет
  устойчивой очереди для expiry, crash recovery и повторов; большой request
  становится операционно хрупким.
- **Шифровать каждый connection отдельным ключом и уничтожать ключ.** Лучше
  сокращает доступность данных в старых backup, но сейчас потребует envelope
  encryption, отдельного key lifecycle, rotation и широкого изменения storage.
  Этот вариант можно принять позже как усиление, не меняя внешний erasure
  contract.
- **Только soft delete или anonymization.** Скрывает данные от обычных reads,
  но продолжает хранить health facts и производные выводы, поэтому не является
  удалением.
- **Разрешить удаление через ChatGPT/MCP.** Удобно, но повышает риск случайного
  необратимого действия и усложняет доказательство fresh user presence.
- **Хранить marker только в API database.** Не защищает от восстановления
  snapshot, сделанного до создания marker.

## Consequences

- Пользователь может независимо остановить сбор и удалить историю конкретного
  wearable connection, не затрагивая manual Recovery facts и shared catalog.
- Retention expiry и явное удаление имеют один тестируемый путь без
  расходящейся бизнес-логики.
- До физического удаления данные fail-closed исключены из collection, reads и
  новых производных расчётов.
- Появляются schema migration, worker/scheduler, Identity/API fresh-auth
  contract, Web privacy control и обязательная dependency-aware deletion.
- Backup owner должен определить максимальный retention, защищённое независимое
  хранение manifest и проверяемую restore procedure. Без этого реальные
  provider данные остаются запрещены.
- Receipt и manifest являются privacy-sensitive operational metadata. Доступ к
  ним ограничивается, а срок хранения обосновывается backup window, а не
  бессрочным аудитом.
- Crypto-shredding не требуется для первой реализации, но остаётся совместимым
  будущим усилением.

## Verification

- Contract tests доказывают, что browser session без свежей purpose-bound
  authority не может создать erasure request, authority одноразовая и не
  применима к другому connection.
- Migration tests проходят clean install и каждый journal prefix; generated
  PostgreSQL identifiers не превышают 63 UTF-8 bytes.
- Integration tests проверяют idempotent create/claim/retry/completion,
  немедленную quarantine, запрет новых writes и dependency-order deletion.
- Tests подтверждают удаление зависимых assessments/recommendations и
  сохранение unrelated manual observations и shared definitions.
- Retention tests создают request ровно один раз после `retainUntil` и не
  трогают `indefinite` consent.
- Restore drill поднимает pre-erasure snapshot в изоляции, применяет независимый
  manifest до readiness и доказывает отсутствие удалённых raw и derived данных;
  missing/incomplete manifest оставляет readiness закрытой.
- Web E2E проверяет fresh passkey confirmation, CSRF/Origin, explicit warning,
  retry/status и отсутствие destructive MCP tool.
- Full API, Identity и Web checks, docs validation, независимые Quality и
  Architecture Reviews проходят до completion.

## Related material

- [Recovery and Readiness](../wiki/domain/recovery-and-readiness.md)
- [Data ownership](../wiki/architecture/data-ownership.md)
- [Identity and external tool access](../wiki/architecture/identity-and-external-tool-access.md)
- [Staging PostgreSQL backup and restore](../wiki/operations/postgresql-backup-and-restore.md)
- [Typed Recovery observations and assessments](20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md)
