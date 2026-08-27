---
id: "decisions-20260827-correct-inverted-fitness-tracker-catalog-sheet-identities"
kind: adr
title: "Исправить инвертированные numeric sheet identities Brands и Foods"
status: accepted
date: 2026-08-27
supersedes: ["decisions-20260826-remediate-nutrition-provenance-and-terminal-catalog-evidence"]
superseded_by: null
tags:
  - "nutrition"
  - "data-migration"
  - "google-sheets"
  - "provenance"
---

# Исправить инвертированные numeric sheet identities Brands и Foods

## Context

Read-only checkpoint TASK-0061 повторно прочитал metadata точного workbook
`1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik` и установил фактические
numeric identities: `Foods = 2000000006`, `Brands = 2000000008`.

TASK-0056 приняла обратное соответствие. Её forward-only migration переместила
текущие Brand versions с правильного Brands source `2000000008` на ошибочный
`2000000006`, а семь созданных Food versions получили ошибочный Foods source
`2000000008`. Старые source records не удалялись, поэтому факты и исходное
evidence сохранились, но текущий target reader правильно возвращает десять
`source_identity_mismatch` conflicts.

Committed migration нельзя переписывать: это изменило бы hash уже применённой
истории и сделало upgrade path невоспроизводимым. Google Sheets остаётся
read-only operational authority, а cutover checkpoint требует точных numeric
sheet identities и нулевых conflicts.

## Decision

Добавить новую forward-only идемпотентную data migration, узко привязанную к
exact workbook и двум известным source kinds:

- current private Brand versions с source
  `fitness_tracker:<workbook>:2000000006:brand` получают source
  `fitness_tracker:<workbook>:2000000008:brand`;
- current private Food versions с source
  `fitness_tracker:<workbook>:2000000008:food` получают source
  `fitness_tracker:<workbook>:2000000006:food`.

Migration создаёт или переиспользует correct `CatalogSource` и
`CatalogSourceRecord`, копирует exact external id, capture time, checksum,
parser version, status и raw snapshot, затем перенаправляет только current
version. Domain fields, root identity и version number не меняются. Все
wrong-source records и historical versions сохраняются как audit evidence.

Если под correct source уже существует record с тем же external id, но другим
checksum или parser version, migration завершается ошибкой до correction.
Generic correction по title, row position или semantic similarity не
добавляется.

После migration выполнить одобренный controlled staging all-domain lifecycle:
fresh bounded snapshot, dry-run, apply только target-absent facts, повторный
dry-run и executable `prepare`. Затем повторно прочитать те же bounded ranges и
выполнить `verify-frozen`. Это не останавливает Sheets writer, не переключает
ChatGPT и не передаёт authority PostgreSQL.

## Considered alternatives

- **Изменить committed TASK-0056 migration:** отклонено, потому что нарушает
  hashes и every-prefix reproducibility уже применённой migration chain.
- **Выполнить ad-hoc SQL на staging:** отклонено как неповторяемая и
  непроверяемая коррекция без clean-upgrade покрытия.
- **Игнорировать source identity mismatch:** отклонено, потому что manifest
  зафиксировал бы ложную provenance и cutover gate потерял бы смысл.
- **Исправлять любые catalog identities внутри importer apply:** отклонено как
  слишком широкое self-healing поведение. Разрешён только exact known defect.
- **Новая узкая forward-only migration:** выбрана как минимальный
  воспроизводимый вариант, сохраняющий факты и audit trail.

## Consequences

- Три current Brand versions и семь current Food versions снова соответствуют
  фактическим numeric sheet identities.
- Ошибочные и исходные records остаются доступны для аудита; facts не
  дублируются и их business fields не меняются.
- Новые source records могут появиться только при отсутствии уже сохранённого
  exact evidence.
- Staging migration и импорт новых target-absent facts являются отдельными
  PostgreSQL writes, явно разрешёнными оператором для TASK-0062.
- Google Sheets остаётся read-only; MCP writes, writer switch, cutover и
  authority transfer не разрешаются этим решением.

## Verification

- Migration integration проходит clean и every-prefix upgrade, повторный run,
  exact Brand/Food repointing, audit preservation и fail-closed conflict case.
- PostgreSQL identifier audit отклоняет имена длиннее 63 UTF-8 bytes.
- Controlled staging после migration и apply возвращает `created=0`,
  `conflict=0`, `failures=0` при повторном all-domain dry-run.
- `prepare` создаёт private mode-0600 manifest только из conflict-free state;
  fresh recapture проходит `verify-frozen`.
- В evidence попадают только safe aggregate counts и результаты gates.

## Related material

- [Superseded Nutrition remediation](20260826-remediate-nutrition-provenance-and-terminal-catalog-evidence.md)
- [Executable cutover preflight](20260826-complete-typed-mcp-writer-parity-and-use-executable-cutover-preflight.md)
- [Migration strategy](../wiki/architecture/migration-strategy.md)
- [TASK-0062 plan](../../plans/2026/08/completed/2026-08-27-task-0062-correct-fitness-tracker-catalog-sheet-identities.md)
