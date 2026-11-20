---
id: preserve-cutover-bounds-in-erasure-journal-v2
kind: adr
title: "Сохранять границы перехода в совместимом префиксе erasure journal v2"
status: accepted
date: 2026-11-20
supersedes: []
superseded_by: null
tags:
  - architecture
  - recovery
  - privacy
  - integrations
---

# Сохранять границы перехода в совместимом префиксе erasure journal v2

## Context

TASK-0181 требует сохранить import bounds после connection erasure и restore
старой PostgreSQL backup. Существующий SQLite journal v1 имеет закрытые
record kinds, immutable hashchain и metadata; extension field отсутствует.
По одному erased connection ID невозможно восстановить `D/T` перехода,
если backup сделана ещё до создания cutover. Простое расширение текущего
writer или изменение SQLite файла оператора нарушило бы формат и старые seals.

Это уточнение обнаружено при детализации после утверждения cutover ADR.
Оператор отдельно утвердил локальное расширение 2026-11-20 ответом
«Да, реализуй v2 локально». Изменение реального staging journal и его
операционная замена этим не разрешены.

## Decision

Принят format 2 того же API-owned erasure journal, с сохранением
идентичности и проверяемого префикса format 1:

1. Добавить один typed record kind `cutover` и bounded canonical snapshot
   только конфигурации запрета/ownership: local Person/provider references,
   state/version, `D/Z/T`, drain deadline и erasure tombstones. Не включать
   key, credential, health values, raw provider payload, external IDs.
2. Существующие `accepted/completed/checkpoint` records сохраняют прежний
   hash preimage и `schemaVersion = 1`, в том числе при новых append в v2.
   Только новый kind использует version 2 и snapshot в hash preimage.
   Один stream/sequence/previous-hash, без второго журнала authority.
3. V2 reader проверяет оба вида records и original seals/prefix; v1 reader
   отвергает metadata format 2. V1 остаётся доступным для проверки и replay
   прежних backups. V1 writer не пытается записать cutover snapshot.
4. Sync получает policy snapshots и erasure checkpoint в одном repeatable-read
   PostgreSQL cutoff, сначала append policy, затем checkpoint. Replay применяет
   deny-only bounds до connection erasures и до запуска workers. Snapshot не
   создаёт consent/credential и не активирует импорт. Conflicting/non-monotonic
   bounds отвергаются, а не выбираются произвольным last-write-wins.
   Activation дополнительно требует PostgreSQL acknowledgement именно
   immutable policy hash, полученный sync только после durable sealed v2
   checkpoint. Retry с новой границей сбрасывает acknowledgement. Без него
   target не получает права записи; source не выключается в пользу
   неподтверждённого перехода. Это proof durability, не второй authority bounds.
   Hash связывает cutover identity и immutable provider pair/bounds/timezone/
   deadline/capability version/gaps, не mutable state/CAS version/consent rotation.
   Sync acknowledgement условно обновляет только ту же policy identity/hash;
   старый sync не подтверждает новые bounds после retry. Если proof нет в `T`,
   pre-activation failure освобождает provisional source fences и сохраняет
   рабочий source, а не оставляет оба writer заблокированными.
5. Старый v1 journal при наличии cutover policy fail-closed сообщает о нужном
   upgrade. Никакого автоматического ALTER, удаления или переподписывания
   immutable operator journal при старте приложения/sync.
   Legacy `recovery-erasure:manifest` v1 не содержит cutover bounds: export
   отвергается при наличии любой cutover policy в том же PostgreSQL snapshot.
   Старый manifest не является достаточным основанием для restore с переходом;
   перед запуском workers требуется replay sealed journal v2. Backup до
   cutover сама по себе не позволяет определить отсутствие более новой политики.

### Явный offline upgrade

Добавить отдельную управляемую CLI операцию с preview/проверкой входа,
работающую только по явному operator approval. Она создаёт новый SQLite файл
формата 2 с тем же journal ID и копирует все старые seq/record bytes/hashes
без изменений. После проверки обоих файлов и всего старого префикса создаёт
новый sealed checkpoint, сохраняет исходный файл как rollback artifact,
проверяет permissions/fsync и допускает отдельную атомарную замену.
Операция не выполняется внутри schema migration PostgreSQL.

На финальную проверку исходного head и замену остановить/исключительно
заблокировать всех writers. Открытый старый SQLite handle не должен продолжить
append в переименованный v1 inode. Tooling готовит и проверяет новый файл;
операционная замена требует доказанного quiescence. Новая checkpoint не
продвигает `completeThrough` по wall clock: сохраняется прежний доказанный
cutoff до следующего PostgreSQL sync. Сохранённая v1 копия — forensic artifact,
а не безопасный runtime rollback после первой v2 записи.

Локальный объём — codec, writer/reader, upgrade tooling, fixtures и tests.
Реальный upgrade staging journal, изменение sync controller и activation
cutover в окружении требуют отдельного operational разрешения и доказательств.
Доставка должна сначала обеспечить v2-ready journal/sync, затем разрешить
schedule; v1 schema mismatch нельзя скрывать за зелёным generic readiness.

## Considered alternatives

- **V2 с тем же ID и неизменённым legacy префиксом (предлагается).** Сохраняет
  старые checkpoints и одну authority. Цена — dual-format reader и явный
  offline upgrade immutable storage.
- **Новый journal ID с carry-forward anchor.** Не меняет старый файл, но
  требует ещё одного trust contract и проверки связанных chains при каждой
  старой backup. Сложнее нужного для одного нового typed kind.
- **Сохранить v1 и блокировать restore/import при неизвестных bounds.**
  Безопаснее молчаливого расширения доступа, но автоматическое восстановление
  cutover authority из старой backup невозможно. Потребуется ручное
  восстановление политики; не выполняет полный approved restore сценарий.
- **Скрыть snapshot в reason/string payload или отдельном sidecar.** Меняет
  смысл существующих records либо создаёт несогласованный второй источник
  restore authority. Отклонено.

## Consequences

Отдельного сервиса и deployable boundary нет. API сохраняет journal ownership;
синхронизация и replay меняют формат явно. Upgrade не отзывается автоматически
rollback старого API image: старый writer обязан отказать на v2. Перед delivery
нужны совместимая версия reader/writer/sync controller и runbook rollback.

## Verification

- V1 fixtures/seals/hashchain до и после переноса совпадают byte-for-byte;
  старые checkpoints принимаются новым reader как prefix.
- V2 snapshot roundtrip, неизвестные keys, secrets/health/external fields,
  oversized JSON, hash tampering и stale version отвергаются.
- Upgrade interruption сохраняет исходный journal; никаких runtime mutations
  существующего operator файла и никаких секретов в диагностике.
- Restore backup до cutover + journal после erasure восстанавливает denial
  bounds и не выдаёт consent/credential/import rights. Повторный replay
  идемпотентен; contradictory policies fail closed.
- Независимые Quality/Architecture Review и canonical docs validation;
  реальное применение upgrade отдельно от authored/tested tooling.

## Related material

- [Принятый cutover contract](20261120-switch-intervals-to-garmin-with-date-boundary.md)
- [План TASK-0181](../../plans/2026/11/completed/2026-11-20-task-0181-intervals-garmin-cutover.md)
- [Recovery](../wiki/domain/recovery-and-readiness.md)
