---
id: "decisions-20260823-run-controlled-sheets-imports-from-operator-workstation"
kind: adr
title: "Запускать контролируемый импорт Sheets с рабочей станции оператора"
status: accepted
date: 2026-08-23
supersedes: ["decisions-20260823-use-dedicated-one-shot-staging-import-runtime"]
superseded_by: null
tags:
  - "credentials"
  - "data-migration"
  - "google-sheets"
  - "operations"
---

# Запускать контролируемый импорт Sheets с рабочей станции оператора

## Context

Единый Fitness Tracker importer принадлежит API modular monolith, но это не
означает, что ограниченные migration/reconciliation runs должны выполняться в
постоянном staging runtime. До cutover операции запускаются вручную и требуют
наблюдения оператора. Unattended scheduler или доказанная recurring automation
пока не нужны.

Предыдущее решение добавило отдельный one-shot staging Compose profile и
API-owned Google service identity. Реальные credentials не создавались,
workbook permissions не менялись, importer не запускался. После уточнения
operational workflow этот runtime признан лишним: он создаёт persistent secret
delivery и server-side credential surface только ради ограниченных ручных
запусков.

Codex уже имеет установленный Google Drive connector с пользовательской
авторизацией. Connector credential принадлежит платформе Codex, не доступен
repository process и не должен извлекаться или передаваться staging backend.
Однако Codex может прочитать точный workbook и подготовить bounded private
snapshot как вход для того же проверенного importer lifecycle.

## Decision

Запускать до cutover контролируемые import/reconciliation operations с основной
рабочей станции оператора. Код importer остаётся внутри API, но процесс
запускается локально и соединяется со staging PostgreSQL через отдельно
одобренный безопасный локальный доступ.

Source acquisition выполняется так:

1. Codex Google connector читает metadata точного workbook
   `1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik` и только bounded ranges с
   максимумами `Weight!A1:B5000` и `Daily_Log!A1:AZ5000`, обрезая запрос до
   фактических metadata grid bounds;
2. connector не изменяет workbook и не раскрывает OAuth token;
3. значения преобразуются в versioned typed snapshot contract с spreadsheet
   id, locale, timezone, numeric sheet ids, headers, row locators и scalar
   cells;
4. snapshot создаётся exclusive-create вне Git с mode `0600`, ограниченным
   размером и checksum; importer отклоняет symlink, permissive permissions,
   неизвестную версию, лишние/невалидные поля и metadata mismatch;
5. после запуска snapshot удаляется, а в task evidence сохраняются только safe
   status и aggregate `created / unchanged / conflict / invalid` counts.

Единая команда получает optional `--snapshot-file`. При его наличии она не
создаёт Google reader и не требует Google credentials. Classification,
PostgreSQL target reader, source identity, provenance checksum, dry-run/apply
gates и safe/private reporting остаются общими. JSON snapshot является
эфемерным raw source evidence и не заменяет relational domain/audit model.

Первый запуск использует только `--domain weight --mode dry-run`. PostgreSQL
comparison остаётся read-only. `apply`, database writes, recurring schedule,
cutover и authority transfer требуют отдельных решений и разрешений.

Повторяемые оператором pull/reconciliation runs составляют controlled dual-run
до тех пор, пока их частота и объём остаются bounded. API-owned service
identity, server runtime и scheduler рассматриваются заново только при явно
утверждённой unattended automation.

Удалить из staging workflow/controller/Compose неиспользованный Google
credential handoff и dry-run trigger. Автодеплой следующего commit безопасно
удалит dormant runtime contract; database schema и facts не меняются.

## Considered alternatives

- **Dedicated one-shot staging runtime с service identity.** Superseded как
  ненужная persistent credential/deployment complexity для ручных bounded runs.
- **Извлечь OAuth token установленного Codex connector.** Отклонено: connector
  credential не является application secret и не должен покидать платформу.
- **Реализовать classification непосредственно в агенте.** Отклонено, потому
  что обходит tested unified importer и создаёт второй migration mechanism.
- **Экспортировать весь workbook в XLSX.** Отклонено: расширяет data scope и
  теряет часть Google metadata/source identity по сравнению с bounded typed
  snapshot.
- **Создать local Google OAuth client.** Не нужен, пока connector безопасно
  выполняет bounded source reads; снова потребовал бы Google Cloud credential
  lifecycle.

## Consequences

- Google Cloud project, service account, key и workbook sharing change для
  текущего этапа не нужны.
- Staging API и host не получают Google credentials или private source files.
- Importer остаётся единым и расширяемым для typed domain adapters.
- Operator/Codex orchestration становится частью ручной процедуры; без активной
  сессии unattended run невозможен, что приемлемо для текущего scope.
- Private snapshot кратковременно содержит operational data на рабочей станции,
  поэтому требуются exclusive create, `0600`, no Git/artifacts/logs и cleanup.
- Если ручные runs станут частыми или ненадёжными, automation потребует нового
  ADR и credential strategy, а не неявного восстановления superseded runtime.

## Verification

- Unit tests проверяют schema/version/metadata/checksum, bounded rows, scalar
  cells, symlink/permission/size rejection и deterministic snapshot read.
- CLI tests доказывают, что `--snapshot-file` исключает Google credential path
  и использует тот же importer lifecycle.
- Existing integration tests доказывают PostgreSQL read-only dry-run и
  отсутствие Google Sheets writes.
- Deployment contracts подтверждают полное удаление importer credentials,
  trigger, environment file и Compose service из staging runtime.
- Operational run проверяет exact workbook metadata/ranges, private temporary
  file, safe report и cleanup без публикации raw facts.
- Architecture Review подтверждает отсутствие второго migrator, persistent
  Google credential, generic JSON database model и premature scheduler.

## Related material

- [Superseded staging runtime ADR](20260823-use-dedicated-one-shot-staging-import-runtime.md)
- [Pull-based import and exclusive writer cutover](20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Relational import batches and Weight temporal precision](20260821-use-relational-import-batches-and-explicit-weight-temporal-precision.md)
- [Migration strategy](../wiki/architecture/migration-strategy.md)
- [TASK-0046 plan](../../plans/2026/08/2026-08-23-task-0046-first-staging-weight-dry-run.md)
