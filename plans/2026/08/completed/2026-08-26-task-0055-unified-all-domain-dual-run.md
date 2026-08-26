# TASK-0055 — Единый all-domain dual-run Fitness Tracker

## Статус и разрешение

- Статус: completed.
- Оператор утвердил цельный пакет командой `го` 2026-08-26.
- Разрешены analytic → developer, реализация, тесты, independent Quality,
  bounded read-only Google Sheets capture и названный staging dual-run/apply.
- Commit, push, cutover, смена authority и Google Sheets writes не разрешены.

## Цель

Добавить один локальный запуск поверх существующего единого typed importer,
который последовательно сверяет все пять доменов, применяет только доказуемые
факты через существующие domain lifecycle и выдаёт общую безопасную сводку.

## Входит

1. `--domain all` с отдельными typed private snapshots для Weight, Body,
   Nutrition, Training и Recovery.
2. Детерминированный порядок, per-domain isolation и общие counts.
3. Совместимость существующих однодоменных запусков.
4. Unit/integration coverage dry-run, apply, повторной сверки и ошибок.
5. Автоматическая проверка полного MCP writer operation matrix, включая
   Garmin/Recovery observations.
6. Один bounded connector capture, staging dry-run, apply доказуемых фактов и
   повторный dry-run с удалением временных snapshots.
7. Independent Quality, Architecture Review и affected Wiki после приёмки.

## Не входит

- Полный generic workbook snapshot или второй migrator.
- Google Cloud, service identity, backend Google credentials или scheduler.
- Ручная правка source rows и синтез отсутствующих значений.
- Cutover, writer switch, authority transfer или rollback execution.
- Commit и push без отдельного разрешения.

## План реализации

1. [x] Восстановить workspace, проверить board/memory/docs/Git и оформить
   implementation-ready TASK-0055.
2. [x] Выделить общий однодоменный runner из текущей CLI без изменения domain
   classifiers и apply services.
3. [x] Добавить `all` orchestration с явным snapshot path для каждого домена,
   deterministic result и aggregate counts.
4. [x] Добавить unit и PostgreSQL integration tests, включая независимость
   доменов и повторную идемпотентную сверку.
5. [x] Дополнить автоматическую MCP writer matrix проверку.
6. [x] Пройти typecheck, build, unit, focused integration и docs validation.
7. [x] Выполнить разрешённый bounded live dual-run без Sheets writes.
8. [x] Провести independent Quality и Architecture Review.
9. [x] После Quality обновить affected Wiki и перенести план в `completed`.

## Критерии приёмки

1. Одна CLI invocation координирует все пять доменов.
2. Каждый домен использует отдельный versioned typed snapshot.
3. Dry-run не создаёт writer и не пишет в PostgreSQL.
4. Apply вызывает существующий transactional domain lifecycle независимо;
   blockers одного домена не подавляют безопасные факты другого.
5. Результат содержит per-domain и aggregate
   `created|unchanged|conflict|invalid`.
6. Существующий one-domain CLI контракт не меняется.
7. Повторный запуск не создаёт дубли и не перезаписывает факты.
8. MCP tests покрывают все текущие writer fact types, включая Recovery.
9. Live run сохраняет только безопасные counts, удаляет snapshots и не меняет
   Google Sheets.
10. Cutover readiness явно отделён от самого cutover.

## План проверки

- `pnpm --filter @shape-of-you/api typecheck`
- `pnpm --filter @shape-of-you/api build`
- `pnpm --filter @shape-of-you/api test:unit`
- focused PostgreSQL integration tests при доступном Docker
- MCP contract tests без интерактивного браузера
- `node scripts/validate-docs.mjs`
- `git diff --check` и review unrelated changes

## Architecture Review checklist

- Сохраняются один modular API, одна database и один importer lifecycle.
- `all` является orchestration, а не новым migrator или deployable boundary.
- Domain transactions и blockers остаются изолированными.
- Source snapshots остаются typed, bounded, ephemeral и не заменяют relational
  model.
- Не добавляются unattended runtime, credentials или hidden dual-write.
- Cutover/rollback gates не ослабляются.

## Результат

- Единый запуск реализован как orchestration над существующими typed domain
  lifecycle, без второго мигратора и без общей workbook-модели.
- Approved staging apply создал два независимых отсутствовавших факта. Финальный
  read-only all-domain dry-run: `created=0`, `unchanged=418`, `conflict=15`,
  `invalid=41`, failures отсутствуют.
- Двенадцать конфликтов — неразрешённые ссылки Food в composition rows. Ещё три
  — обнаруженный historical provenance drift Brands: сохранён numeric sheet ID
  Foods вместо Brands. Повторный запуск блокирует дубли и не исправляет
  provenance автоматически.
- Quality проверил отсутствие скрытого dual-write, сохранение domain boundaries,
  typed relational model и отдельного cutover gate. Новых deployable boundaries
  и преждевременных сервисов не появилось.
- Google Sheets не изменялся, cutover и authority transfer не выполнялись.
