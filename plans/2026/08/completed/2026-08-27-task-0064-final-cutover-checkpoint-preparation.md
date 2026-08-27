# TASK-0064 — Подготовка финального cutover checkpoint без переключения writers

## Статус и разрешение

- Статус: completed; оператор одобрил подготовку командой `ок го`
  2026-08-27 в текущем чате.
- Разрешены read-only Google Sheets capture по точному workbook, read-only
  staging reconciliation, private preflight evidence, `verify-frozen`,
  `verify-writer`, zero-write rollback rehearsal, independent Quality и
  последующее обновление affected canonical Markdown.
- Не разрешены Google Sheets writes, остановка или переключение writers,
  изменение ChatGPT configuration, authority transfer, production, secret
  disclosure, commit и push.

## Цель

Подготовить свежий воспроизводимый checkpoint для отдельного будущего cutover
решения: доказать, что bounded Fitness Tracker snapshots не дрейфуют, staging
reconciliation остаётся conflict-free, deployed MCP writer evidence полно и
rollback scope можно определить без записи в Google Sheets.

## План выполнения

1. [x] Восстановить 4DreamTeam workspace и создать TASK-0064.
2. [x] Прочитать live spreadsheet metadata и снять пять bounded private
   snapshots с точными numeric sheet ids.
3. [x] Выполнить `prepare` против staging в read-only dry-run режиме и создать
   private mode-`0600` manifest.
4. [x] Повторно снять bounded snapshots и пройти `verify-frozen`.
5. [x] Повторно проверить TASK-0063 writer evidence через `verify-writer`.
6. [x] Выполнить Person-isolated zero-write `rehearse-rollback`.
7. [x] Удалить private snapshots/manifest/evidence и закрыть временный tunnel.
8. [x] Получить independent Quality и Architecture Review.
9. [x] Обновить affected canonical Wiki/plan по принятому evidence и перенести
   этот план в `completed`.

## Критерии приёмки

1. Snapshot contracts используют exact workbook и утверждённые numeric sheet
   identities для Weight, Body, Nutrition, Training и Recovery.
2. Final reconciliation возвращает `failures=0`, `created=0`, `conflict=0`;
   terminal historical `invalid` остаётся evidence, а не manual repair queue.
3. `verify-frozen` принимает независимый повторный capture.
4. `verify-writer` принимает deployed 23-tool / 14-canary evidence TASK-0063.
5. Rollback rehearsal ничего не пишет и перечисляет только post-checkpoint
   facts текущего Person.
6. Workbook, Sheets writer, ChatGPT configuration, permissions, authority и
   production не изменяются.
7. Canonical Markdown после Quality точно отделяет подготовленный checkpoint
   от ещё не разрешённого writer switch и authority transfer.

## Architecture Review checklist

- Используется существующий local phased preflight; новые сервисы, базы,
  migrations, dependencies и persistent `CutoverSession` не создаются.
- Exclusive-writer и append-only rollback invariants сохраняются.
- Private evidence не становится domain authority и удаляется после проверки.
- Фактический cutover остаётся отдельным явным operator approval.

## Operational evidence

- Exact workbook metadata: `Fitness Tracker`, locale `ru_RU`, timezone
  `Europe/Moscow`; authoritative numeric sheet ids совпали с canonical
  contracts, включая `Foods=2000000006` и `Brands=2000000008`.
- Final read-only reconciliation: `created=0`, `unchanged=434`, `conflict=0`,
  `invalid=48`, `failures=0`.
- Независимый повторный bounded capture: `verify-frozen=true`.
- Deployed TASK-0063 evidence: `verify-writer=true` для 23 tools и 14
  обязательных writer/lifecycle canaries.
- Zero-write rollback rehearsal: `requiresReplay=false`, post-checkpoint facts
  `0` во всех шести fact categories.
- Temporary snapshots, manifest, writer evidence и helper удалены; SSH tunnel
  закрыт. Google Sheets, staging data, writers, ChatGPT configuration,
  permissions и authority не изменялись.
