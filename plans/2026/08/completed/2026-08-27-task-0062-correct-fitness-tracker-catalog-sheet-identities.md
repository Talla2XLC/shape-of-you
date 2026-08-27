# TASK-0062 — Исправить numeric sheet identities Brands и Foods

## Статус и разрешение

- Статус: completed.
- Оператор утвердил recommended plan командой `го` 2026-08-27.
- Разрешены ADR, forward-only migration, tests, controlled staging migration,
  all-domain apply шести target-absent facts, повторный checkpoint,
  independent Quality и affected Wiki.
- Не разрешены Google Sheets writes, MCP writes/canaries, deployment, writer
  shutdown, cutover, authority transfer, production, commit и push.

## Цель

Исправить инвертированную provenance текущих Brand/Food versions, сохранить
полную migration/audit history, импортировать только новые source facts и
получить проверяемый frozen checkpoint без conflicts.

## План реализации

1. [x] Зафиксировать authoritative metadata и root cause в TASK-0061.
2. [x] Сравнить варианты, получить operator approval и принять superseding ADR.
3. [x] Добавить exact idempotent migration для current Brand/Food versions с
   сохранением wrong-source records.
4. [x] Добавить migration tests для exact identities, idempotency,
   fail-closed conflict, every-prefix upgrade и identifier length.
5. [x] Пройти API lint, typecheck, build, unit, focused integration и docs
   validation.
6. [x] Выполнить approved staging migration через operator-workstation tunnel.
7. [x] Снять fresh bounded snapshots, выполнить dry-run/apply/recheck и
   подтвердить `created=0`, `conflict=0`, `failures=0`.
8. [x] Выполнить `prepare`, повторно прочитать exact ranges и пройти
   `verify-frozen`.
9. [x] Удалить private snapshots/helper, закрыть tunnel и провести independent
   Quality с Architecture Review.
10. [x] После Quality обновить только affected canonical Wiki и перенести план
    в `completed`.

## Результаты выполнения

- Migration исправила current provenance: 3 Brands используют sheet
  `2000000008`, 7 Foods используют sheet `2000000006`; prior records сохранены.
- Pre-apply dry-run: `created=6`, `unchanged=428`, `conflict=0`, `invalid=48`,
  `failures=0`.
- Post-apply dry-run: `created=0`, `unchanged=434`, `conflict=0`, `invalid=48`,
  `failures=0`.
- `prepare` создал private mode-0600 manifest; fresh exact recapture прошёл
  `verify-frozen`.
- Google Sheets не изменялась; MCP writes, writer switch, cutover и authority
  transfer не выполнялись.

## Критерии приёмки

1. Authoritative mapping закреплён как Foods `2000000006`, Brands
   `2000000008`.
2. Current Brand/Food versions используют correct source identity без изменения
   root ids, version ids или domain fields.
3. Все prior source records и historical versions сохранены.
4. Migration повторяема и fail-closed при несовместимом correct evidence.
5. Clean/every-prefix migrations и 63-byte identifier gate проходят.
6. Staging repeated dry-run имеет `created=0`, `conflict=0`, `failures=0`;
   terminal invalid evidence не маскируется.
7. `prepare` и fresh `verify-frozen` проходят с private mode-0600 artifacts.
8. Sheets/MCP/cutover/authority остаются неизменными.

## Проверка

- `pnpm --filter @shape-of-you/api lint`
- `pnpm --filter @shape-of-you/api typecheck`
- `pnpm --filter @shape-of-you/api build`
- `pnpm --filter @shape-of-you/api test:unit`
- focused Nutrition и migration integration tests
- `node scripts/validate-docs.mjs`
- `git diff --check`
- controlled staging migration, dry-run/apply/recheck, prepare/verify-frozen

## Architecture Review checklist

- Новые service/database/runtime boundaries отсутствуют.
- Correction узко ограничена exact workbook, sheet IDs и source kinds.
- Committed migration history не переписывается.
- Facts и historical evidence не дублируются и не удаляются.
- Generic self-healing или manual source repair не добавляются.
- Google Sheets authority и exclusive-writer gates не ослабляются.
