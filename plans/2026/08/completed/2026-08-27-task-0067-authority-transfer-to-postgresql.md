# TASK-0067 — Перенос authority Fitness Tracker на PostgreSQL

## Статус и разрешение

- Статус: completed; оператор явно разрешил: `разрешаю authority transfer на
  PostgreSQL`.
- Разрешены: последний fail-closed READY pin, изменение authority wording в
  существующем ChatGPT-проекте `Фитнес-трекер`, принятие текущего PostgreSQL
  state как operational authority и post-transfer read-only verification.
- Не разрешены: новые fitness facts, Google Sheets writes, изменение workbook
  permissions, archive/delete workbook, production, secrets, commit и push.

## Архитектурная форма transfer

Existing ADR не вводит database flag или persistent `CutoverSession`.
Authority transfer — это явное operator decision плюс изменение единственного
writer/read contract:

- PostgreSQL через Shape of You Staging MCP становится operational authority;
- Google Sheets перестаёт быть authority и остаётся frozen read-only legacy
  snapshot/reference для pre-checkpoint history;
- все новые reads/writes и corrections используют typed MCP contracts;
- один TASK-0065 synthetic `DailyContextNote` принимается как часть
  authoritative PostgreSQL state;
- rollback по-прежнему требует остановить MCP и отдельно разрешить replay либо
  synthetic-canary exception до возобновления Sheets writer.

## План выполнения

1. [x] Зафиксировать TASK-0067, operator approval и точные non-goals.
2. [x] Повторить immediate READY pin: 23 tools, existing synthetic read-back,
   MCP-only config и workbook modified time без post-checkpoint drift.
3. [x] Изменить инструкции того же проекта `Фитнес-трекер`: PostgreSQL/MCP —
   authority; Sheets — non-authoritative frozen legacy reference; fallback и
   Sheets writes запрещены.
4. [x] После reload подтвердить сохранённый authority contract и единственный
   Shape of You Staging writer.
5. [x] Выполнить read-only MCP/read-back и Drive pin после transfer; не создавать
   новый факт и не менять workbook.
6. [x] Провести independent Quality и Architecture Review; после acceptance
   обновить affected canonical Markdown и завершить TASK-0067.

## Fail-closed и rollback

- Если READY pin не проходит, transfer не выполняется, существующий MCP-only
  writer сохраняется, Google Sheets остаётся authority.
- После успешного transfer Sheets writer не может быть возобновлён без нового
  explicit rollback approval и решения по post-checkpoint facts.
- Workbook archive/read-only permissions остаются отдельным operator gate.

## Критерии приёмки

1. Immediate READY pin проходит без drift или новых необозначенных facts.
2. После reload проект однозначно называет PostgreSQL/Shape of You MCP
   operational authority и Google Sheets — non-authoritative legacy snapshot.
3. В каждый момент остаётся один writer; Sheets writes/fallback запрещены.
4. Existing synthetic note читается как часть authoritative PostgreSQL state;
   новые факты не создаются.
5. Workbook values/modified time не меняются; permissions не изменяются.
6. Canonical Wiki различает completed authority transfer и отдельно pending
   workbook disposition/rollback operations.

## Architecture Review checklist

- Existing authority/cutover ADR исполняется без нового ADR, schema, service,
  migration, scheduler или persistent transfer entity.
- Typed facts, Person isolation, provenance, idempotency и append-only
  corrections сохраняются.
- Google Sheets больше не описывается как текущая authority после acceptance.
- Rollback не трактуется как автоматическая reverse sync.

## Operational evidence

- Immediate pre-transfer pin: ровно 23 Shape of You Staging tools; одна
  существующая TASK-0065 synthetic `DailyContextNote`; projection `open`,
  `isStale=false`; workbook `modifiedTime=2026-08-27T06:18:09.958Z`, без drift
  после switch-time checkpoint.
- Existing ADR и repository search подтвердили отсутствие database authority
  flag, schema/migration или persistent `CutoverSession`; transfer реализуется
  operator decision и single-writer/read configuration contract.
- В том же проекте `Фитнес-трекер` сохранены инструкции: PostgreSQL через
  Shape of You Staging MCP — operational authority; MCP — единственный writer;
  Google Sheets больше не authority и остаётся frozen read-only legacy
  snapshot/reference; Sheets writes, permissions changes, fallback и reverse
  sync запрещены.
- После полного reload сохранение подтверждено по всем authority invariants,
  включая принятие существующей synthetic note как части authoritative
  PostgreSQL state.
- Post-transfer pin повторно вернул 23 tools, одну synthetic note, projection
  `open`/`isStale=false` и тот же workbook `modifiedTime`; новых facts или
  Google Sheets mutations не было.
- Authority transfer зафиксирован 2026-08-27T13:12:47Z. Workbook permissions,
  archive/delete, production, secrets, commit и push не выполнялись.
- Temporary browser tab закрыта; private evidence на диск не сохранялось.
- Independent Quality и Architecture Review: `ACCEPT`; transfer исполняет
  существующие ADR, новый ADR не нужен. Authority явно ограничена staging.
- Root `AGENTS.md` и affected current-state Wiki синхронизированы: PostgreSQL
  authority, Sheets non-authoritative legacy, dynamic rollback scope и отдельно
  gated workbook disposition.
- Documentation validator прошёл `53 Wiki / 62 ADR / 115 ID`; `git diff
  --check` и board validation прошли.
