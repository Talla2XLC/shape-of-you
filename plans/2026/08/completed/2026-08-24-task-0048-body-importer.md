# TASK-0048 — Body adapter единого Fitness Tracker importer

## Статус и разрешение

- Статус: completed.
- Оператор утвердил recommended architecture командой `ok go` 2026-08-24.
- Scope выполняется одним delivery package: ADR, schema, code, tests, real
  read-only dry-run и post-acceptance Wiki без промежуточных doc-only commits.

## Цель

Подключить Body как второй typed adapter к существующему единому importer,
честно сохранить date-only precision и доказать безопасную reconciliation/apply
семантику без изменения Google Sheets или authority.

## Входит

1. `fitness-tracker:import --domain body --mode dry-run|apply` в общей команде.
2. Расширяемый private workbook snapshot с v1 Weight compatibility и v2 Body.
3. Explicit Body temporal precision `instant|local_date` и nullable
   `measuredAt` только для date-only imported sessions.
4. Identity из spreadsheet ID, numeric sheet ID и `Measurement_ID`.
5. Typed normalization пяти metric columns, Notes и Source; Photo blocker.
6. Relational `body_import_records` и `body_import_record_values` без JSON.
7. Общий atomic apply, retry, conflict/invalid gate и provenance batch link.
8. Migration, unit, integration, API/MCP/day/progress и identifier tests.
9. Реальный connector read и dry-run без Sheets writes.
10. Independent Quality, Architecture Review и post-acceptance Wiki update.

## Не входит

- Google Sheets writes, direct dual-write, scheduler или recurring dual-run.
- Body photo/media transfer или создание synthetic `photo_media_id`.
- Nutrition, Training или Recovery/Garmin adapters.
- Cutover, writer switch, authority transfer или rollback execution.
- Staging apply, deployment, commit или push.

## Реализация

1. [x] Утвердить temporal precision, identity, Photo blocker и audit shape.
2. [x] Зафиксировать решение в accepted ADR и плане.
3. [x] Добавить schema migration и обновить contracts/domain serialization.
4. [x] Обобщить snapshot/source selection для domain-specific typed views.
5. [x] Реализовать Body classifier, target reader и apply adapter.
6. [x] Добавить typed relational audit persistence.
7. [x] Добавить unit/integration/migration/regression tests.
8. [x] Выполнить workspace checks и реальный read-only Body dry-run.
9. [x] Провести independent Quality и Architecture Review.
10. [x] Обновить affected current-state Wiki и перенести план в `completed`.

## Критерии приёмки

1. Body использует существующую importer command и shared apply lifecycle.
2. Date-only source не получает synthetic timestamp; existing sessions остаются
   exact `instant`.
3. `Measurement_ID` является обязательным стабильным source key; row number не
   используется для dedupe.
4. Re-run классифицирует semantic match как `unchanged` и не создаёт duplicate
   session, values, provenance, batch или audit.
5. Invalid/conflict блокирует весь apply и не меняет существующие facts.
6. Непустой Photo блокирует import безопасным finding вместо потери данных.
7. Partial metric session допустима при хотя бы одном валидном metric; любое
   непустое невалидное известное значение делает row invalid.
8. Notes и source text не раскрываются в safe reports; raw/private values не
   сохраняются в generic JSON.
9. Body audit типизирован реляционными session/value tables с ownership FKs.
10. Public reads явно возвращают temporal precision и nullable measuredAt, а
    public create/correct продолжают требовать exact instant.
11. Snapshot bounded, exact-source validated, no-symlink/0600 и совместим с
    существующим Weight workflow.
12. Live Body dry-run читает exact workbook read-only и даёт доказуемые counts;
    пустой source не требует apply.

## План проверки

- `node scripts/validate-docs.mjs` и PostgreSQL identifier byte audit.
- Contracts/API typecheck, build и unit tests.
- Importer unit tests для snapshot v1/v2 и всех outcomes.
- PostgreSQL integration tests для Body apply/retry/blocking/atomicity.
- Clean/every-prefix migration suite и existing-row upgrade pin.
- API/MCP/day/progress regressions для instant/local-date Body sessions.
- Connector-created private snapshot, SSH tunnel к approved staging PostgreSQL
  и `--domain body --mode dry-run`; snapshot затем удалить, tunnel закрыть.

## Architecture Review checklist

- Один modular API и database; новых deployable/service boundaries нет.
- Shared importer lifecycle не дублируется.
- Domain aggregate остаётся session + typed values.
- JSON не заменяет известную relational structure.
- Документация не дублирует полную историю ADR в Wiki.
- Photo capability явно отложен, а не реализован частично.

## Результат

- Independent Quality принял все 12 критериев после одной безопасной доработки:
  Body snapshot и live reader больше не читают Weight/Daily_Log.
- API: 85/85 unit tests и 55/55 integration tests; полный integration-прогон
  подтверждён последовательно после отдельного Docker API 500 при параллельном
  создании контейнеров.
- Workspace: lint, typecheck, build, documentation validator, board validation
  и `git diff --check` прошли.
- Exact connector read запросил только `Body!A1:J1000`; Body содержал заголовки
  и ноль data rows.
- Read-only staging dry-run через Body-only private snapshot вернул
  `created=0`, `unchanged=0`, `conflict=0`, `invalid=0`.
- Private snapshot удалён, SSH tunnel закрыт. Sheets, PostgreSQL schema/data,
  deployment, authority и writer workflow не изменялись.

## Architecture Review result

- Не добавлены отдельный мигратор, deployable, service или database.
- Body повторно использует общий command и atomic lifecycle; duplicated
  migration logic отсутствует.
- DDD aggregate остаётся `BodyMeasurementSession` + typed values, а известная
  audit structure хранится реляционно, не в JSON.
- Domain-minimal snapshot union проще и безопаснее all-workbook envelope:
  каждый adapter читает только необходимые листы.
- Wiki описывает текущее состояние и ссылается на ADR без копирования полной
  истории решения.
