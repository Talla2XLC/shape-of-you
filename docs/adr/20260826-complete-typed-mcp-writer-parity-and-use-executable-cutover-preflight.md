---
id: "decisions-20260826-complete-typed-mcp-writer-parity-and-use-executable-cutover-preflight"
kind: adr
title: "Завершить типизированный MCP writer и использовать исполняемый cutover preflight"
status: accepted
date: 2026-08-26
supersedes: []
superseded_by: null
tags:
  - "cutover"
  - "daily-context-note"
  - "google-sheets"
  - "mcp"
  - "writer"
---

# Завершить типизированный MCP writer и использовать исполняемый cutover preflight

## Context

Pull-based импорт Weight, Body, Nutrition, Training и Recovery уже реализован
одной командой и повторно сверён со staging PostgreSQL. Google Sheets остаётся
operational authority, а отдельный ChatGPT-проект «Фитнес-трекер» продолжает
писать только в workbook до отдельного cutover.

Read-only проверка живого legacy workflow выявила шесть активных операций:
`weight`, `meal`, `training_result`, `garmin_recovery`, `day_note` и
`close_day`. Он также допускает только явные corrections и запрещает скрытое
изменение закрытого дня. Body сейчас не используется, но остаётся поддерживаемым
типом writer.

Текущий MCP покрывает create/list для Weight, Body, Meal и Workout. Repository
также содержит Recovery create/list, но опубликованный connector ещё должен
пройти deployment, consent и end-to-end проверку. Для полного переключения не
хватает:

- daily projection, close, reopen и closure history через MCP;
- append-only correction tools для существующих фактов;
- read-only active Training program/exercise references, без которых
  `record_workout_session` не может надёжно получить `exerciseVersionId`;
- типизированного standalone day note;
- одной воспроизводимой процедуры checkpoint, final reconciliation, switch
  verification и rollback rehearsal.

Существующий Intake пока разбирает только Weight. Расширение его до всех типов
событий превратило бы cutover в отдельный parser/queue проект и дублировало бы
способность ChatGPT разбирать сообщение перед вызовом typed tools.

## Decision

### Typed writer parity

ChatGPT после cutover вызывает отдельные типизированные MCP tools owning
modules. Generic `submit_intake`, generic fact payload и JSON/JSONB как замена
известным структурам не вводятся.

Полная writer matrix включает:

- Weight, Body, Meal, WorkoutSession и RecoveryObservation: list, record и
  append-only correct;
- DayClosure: read projection/history, close и reopen;
- Training reference lookup: read active Person-owned program с точными
  `programVersionId` и `exerciseVersionId`;
- DailyContextNote: list, record и append-only correct.

Каждый write tool использует отдельный granular OAuth scope, существующий
Person binding, deterministic idempotency key, typed provenance и read-back.
Повтор одного и того же command возвращает существующий результат. Correction
создаёт новый факт с `supersedesId` и причиной; overwrite/delete запрещены.

`record_recovery_observation` сохраняет один независимый raw observation за
вызов. Garmin screenshot раскладывается ChatGPT на типизированные наблюдения с
детерминированными dedupe keys. Частичный сбой не маскируется: повтор безопасно
дозаписывает отсутствующие observations, а read-back сверяет ожидаемый набор.
Derived readiness, AI summary и planning значения не становятся raw facts.

### DailyContextNote

`DailyContextNote` — узкий Person-owned append-only факт контекста дня, а не
`JournalDay` aggregate и не владелец других модулей. Он содержит local date,
timezone, непустой text, source reference, dedupe key, confidence и append-only
supersession. Он не хранит числовые Weight, Nutrition, Training или Recovery
значения и не заменяет их typed facts.

DayClosure может ссылаться на актуальные DailyContextNote того же Person-local
дня и включает их в immutable snapshot. Поздняя note/correction делает closure
stale по тем же правилам, что и поздние module-owned facts. Скрытая запись в
закрытый день запрещена writer instruction: сначала требуется явный reopen,
затем новый факт и повторный close.

### Executable cutover preflight

Cutover координируется одной локальной operator command поверх существующего
unified importer, а не persistent `CutoverSession` в PostgreSQL. Команда
создаёт immutable private manifest с:

- точным workbook/spreadsheet id и numeric sheet ids;
- canonical checksums всех пяти bounded domain snapshots;
- importer schema/version и Git commit;
- final reconciliation counts;
- deployed MCP discovery/scopes matrix;
- canary write/read-back results;
- checkpoint time и explicit operator phases.

Manifest — локальный mode `0600` evidence artifact, не domain entity и не
repository fixture. Он не содержит connector token или неограниченный raw
workbook dump. Команда поддерживает отдельные фазы `prepare`, `verify-frozen`,
`verify-writer` и `rehearse-rollback`, чтобы опасные действия не выполнялись
неявно одним запуском.

Cutover остаётся exclusive-writer процедурой:

1. остановить Sheets writer;
2. создать checkpoint и выполнить final import/reconciliation;
3. повторно прочитать bounded ranges и доказать отсутствие изменений;
4. переключить ChatGPT на Shape of You MCP;
5. выполнить typed canary/read-back matrix;
6. отдельным approval передать authority PostgreSQL.

Rollback сначала останавливает MCP writer. Команда детерминированно выявляет
post-checkpoint PostgreSQL facts и строит typed replay plan. Если они есть,
Sheets writer нельзя возобновлять до approved replay/read-back/reconciliation.
Любая запись в Google Sheets требует отдельного явного разрешения; automatic
reverse sync не создаётся.

## Considered alternatives

- **Один generic `submit_intake` MCP tool.** Упростил бы интерфейс ChatGPT и
  сохранял raw message, но потребовал бы расширить Weight-only Intake parser,
  queue и confirmation lifecycle на все domains. Это отдельный большой продукт
  и дублирование typed tool orchestration перед cutover.
- **Persistent `CutoverSession` state machine.** Дал бы централизованный аудит,
  но добавил бы долгоживущую database/domain сущность ради редкой операторской
  процедуры и новый rollback surface. Immutable local manifest достаточен.
- **Не переносить `day_note`.** Упростило бы schema, но потеряло бы реально
  используемый operational fact и нарушило требование полного writer parity.
- **Хранить day note внутри DayClosure или generic JSON.** Смешало бы mutable
  ежедневный контекст с immutable lifecycle snapshot и создало бы широкий
  `JournalDay` aggregate. Узкий самостоятельный факт сохраняет ownership.
- **Автоматически batch-write все Garmin observations.** Дало бы атомарность
  одного screenshot, но связало бы независимые raw facts и усложнило retry.
  Typed single-observation calls с deterministic keys и set read-back сохраняют
  частичную правду без дубликатов.
- **Ручной checklist без executable evidence.** Дешевле, но не доказывает
  checkpoint, отсутствие post-checkpoint Sheets writes и полноту MCP matrix.

## Consequences

- Появится одна новая relational сущность `DailyContextNote` внутри modular API,
  но не новый service, database или broad day aggregate.
- MCP surface расширится lifecycle, correction и reference read tools; OAuth
  consent policy должна явно разрешить новые granular scopes.
- Existing HTTP/domain correction contracts переиспользуются; hidden overwrite
  не возникает.
- Cutover остаётся отдельно разрешаемой операцией. Принятие этого ADR не
  разрешает writer switch, Sheets permission change, replay или authority
  transfer.
- Google Sheets используется только для чтения до отдельного rollback/cutover
  разрешения.

## Verification

- Contract/unit tests проверяют tool discovery, JSON schemas, annotations,
  granular scopes, authorization и deterministic idempotency.
- Integration tests проверяют DailyContextNote create/retry/correction,
  Person isolation, closed-day coordination и stale closure.
- MCP E2E проверяет record/list/correct/read-back для каждой writer matrix row,
  active Training reference lookup и close/reopen lifecycle.
- Deployed connector discovery обязан показать полный tool/scope matrix после
  deployment и нового consent.
- Cutover preflight tests используют synthetic manifests и доказывают checksum
  drift detection, zero-conflict final reconciliation, incomplete canary
  rejection и typed post-checkpoint rollback plan.
- PostgreSQL identifier audit отклоняет имена длиннее 63 UTF-8 bytes.
- Architecture Review подтверждает отсутствие generic facts, persistent
  cutover state, premature service boundary и дублирования authority.

## Related material

- [Pull-based import and exclusive writer cutover](20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Versioned Person-local day closures](20260811-model-versioned-person-local-day-closures.md)
- [Typed provenance and append-only supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [Migration strategy](../wiki/architecture/migration-strategy.md)
- [Integrity and lifecycle](../wiki/data/integrity-and-lifecycle.md)
- [TASK-0057 plan](../../plans/2026/08/completed/2026-08-26-task-0057-mcp-writer-parity-and-cutover-preflight.md)
