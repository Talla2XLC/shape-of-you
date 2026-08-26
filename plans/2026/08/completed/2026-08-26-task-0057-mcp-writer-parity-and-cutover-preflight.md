# TASK-0057 — Полный MCP writer и cutover preflight

## Статус и разрешение

- Статус: completed.
- Оператор утвердил рекомендуемую архитектуру командой
  `ок го дальше по твоим рекомендациям` 2026-08-26.
- Разрешены ADR, единый план, реализация, tests, independent Quality,
  Architecture Review и affected Wiki в основном рабочем дереве.
- Не разрешены deployment, migration apply на staging/production, cutover,
  изменение ChatGPT-проекта, Google Sheets writes, authority transfer, commit
  или push.

## Цель

Покрыть типизированными Shape of You MCP tools весь фактически используемый
writer workflow проекта «Фитнес-трекер» и реализовать воспроизводимый локальный
preflight для будущего exclusive-writer cutover без выполнения самого cutover.

## Входит

1. Writer matrix: Weight, Body, Meal, WorkoutSession, RecoveryObservation,
   DailyContextNote и DayClosure.
2. Append-only MCP corrections для всех корректируемых фактов.
3. Day projection/history, close и reopen через MCP.
4. Read-only active Training program/exercise reference lookup.
5. Relational `DailyContextNote` contract, persistence, API/MCP и inclusion в
   immutable DayClosure snapshot.
6. Granular OAuth scopes и predefined-client consent policy.
7. Local executable cutover preflight с private immutable manifest, phased
   checkpoint verification, MCP matrix/canary evidence и rollback rehearsal.
8. Unit, integration, migration, MCP и Identity tests.
9. Independent Quality, Architecture Review и affected Wiki.

## Не входит

- Generic `submit_intake` и расширение Intake parser beyond Weight.
- Persistent `CutoverSession`, отдельный service/database/broker или scheduler.
- Nutrition catalog или Training program authoring через MCP.
- Derived readiness/AI/coaching values как raw facts.
- Direct dual-write или automatic reverse sync.
- Реальный cutover, replay, Sheets permission change или Sheets write.
- Deployment, database apply, secret access, commit и push.

## Реализация

1. [x] Восстановить workspace, проверить board/docs/Git и live writer matrix.
2. [x] Сравнить архитектурные варианты и получить operator approval.
3. [x] Зафиксировать ADR и implementation plan.
4. [x] Добавить relational `DailyContextNote`, migration и contracts.
5. [x] Подключить notes к daily projection/closure fingerprint и API.
6. [x] Расширить MCP lifecycle, correction и Training reference tools.
7. [x] Добавить OAuth scopes и predefined-client policy.
8. [x] Реализовать phased local cutover preflight и safe manifest.
9. [x] Добавить unit/integration/migration/MCP/Identity tests.
10. [x] Пройти local gates и independent Quality.
11. [x] Провести Architecture Review и обновить affected Wiki по принятому коду.
12. [x] Перенести план в `completed`; deployment оставить отдельным approval.

## Критерии приёмки

1. MCP discovery покрывает каждую строку approved writer matrix.
2. Write tools используют granular scopes и Person owner/editor authorization.
3. Повтор command idempotent и не создаёт duplicate.
4. Corrections append-only, требуют reason и не перезаписывают исходный факт.
5. `DailyContextNote` relational, typed и не становится broad `JournalDay`.
6. Закрытый день нельзя скрыто изменить; reopen/correct/reclose явны.
7. Late note/correction делает closure stale через typed references/fingerprint.
8. Training tool получает exact active program/exercise version references без
   угадывания UUID по label.
9. Все raw Garmin metrics записываются без synthetic values; partial retry
   безопасен и read-back выявляет missing observations.
10. Published OAuth policy включает новые scopes и refresh-token compatibility
    не регрессирует.
11. Preflight manifest имеет mode `0600`, canonical checksums и не содержит
    token, credential или unbounded workbook dump.
12. `verify-frozen` отклоняет любое изменение bounded Sheets snapshots после
    checkpoint.
13. `verify-writer` отклоняет неполный tool/scope/canary matrix.
14. `rehearse-rollback` строит typed plan для post-checkpoint facts и ничего не
    пишет в Sheets.
15. Clean/every-prefix migrations и 63-byte identifier gate проходят.
16. Google Sheets остаётся read-only, authority не меняется и cutover не
    выполняется.

## План проверки

- `node scripts/validate-docs.mjs`, `git diff --check`, identifier byte audit.
- Contracts/API/Identity lint, typecheck, build и unit tests.
- PostgreSQL integration tests для DailyContextNote, corrections, closure stale
  behavior, Person isolation и migrations.
- MCP discovery/auth/write/read-back regression для всей matrix.
- Synthetic cutover manifests: checkpoint equality/drift, incomplete scopes,
  missing canary, post-checkpoint facts и zero-write rehearsal.
- Architecture Review по checklist корневого `AGENTS.md`.

## Architecture Review checklist

- Один modular API и одна database; новых deployable boundaries нет.
- Domain ownership и append-only correction invariants сохранены.
- DailyContextNote не владеет чужими facts и не расширяет DayClosure aggregate.
- Known structures relational; generic fact JSON не используется.
- Cutover operational evidence не становится постоянной domain сущностью.
- Wiki описывает current state и ссылается на ADR без копирования плана.

## Результат

- Реализована и Quality-accepted полная repository-side MCP matrix из 23 tools.
- Добавлен узкий реляционный `DailyContextNote` с append-only corrections,
  provenance и участием в DayClosure staleness/fingerprint.
- Добавлен локальный phased cutover preflight с private immutable manifest,
  frozen-snapshot/canary verification и Person-isolated zero-write rollback
  rehearsal.
- Architecture Review не обнаружил лишних deployable boundaries, generic fact
  storage, дублирования authority или persistent cutover state.
- Пройдены root typecheck/build/lint, 249 full-suite tests, focused MCP rework
  test, 12 migration tests, identifier byte gate и docs validation.
- Deployment, connector consent/canaries, staging migration, cutover, Sheets
  writes, authority transfer, commit и push не выполнялись.
