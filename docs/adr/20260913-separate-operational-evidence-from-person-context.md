---
id: "decisions-20260913-separate-operational-evidence-from-person-context"
kind: adr
title: "Отделить operational verification evidence от контекста Person"
status: accepted
date: 2026-09-13
supersedes: []
superseded_by: null
tags:
  - architecture
  - evidence
  - progress
  - staging
---

# Отделить operational verification evidence от контекста Person

## Context

TASK-0107 добавила provider-neutral покрытие профиля. Проверка на staging
показала, что первая дата Training, Weight и Nutrition равна `2000-01-01`.
Это не пользовательская история, а двенадцать append-only SourceReference и
связанных facts из synthetic writer canary TASK-0063. Canary намеренно
использовал тот же authenticated Person, поэтому корректный provider-neutral
запрос не может отличить operational verification от evidence пользователя.

Фильтрация даты, provider или TASK namespace внутри Progress смешала бы
операционную договорённость с доменной семантикой. Удаление или перенос facts
нарушили бы сохранение append-only audit evidence. Один только отдельный
synthetic Person защищает будущие canary, но не исправляет уже сохранённую
историю без destructive remediation.

## Decision

1. SourceReference получает внутреннее обязательное назначение
   `evidence_purpose` со значениями `person_context` и
   `operational_verification`.
2. Безопасный default — `person_context`. Public SourceReference input и output
   не публикуют `evidence_purpose`; пользователь, provider и MCP client не могут
   назначить или изменить его.
3. Facts сохраняют Person ownership, значения, correction chains и provenance.
   `operational_verification` остаётся в PostgreSQL для аудита, но не является
   evidence о состоянии или поведении Person.
4. Profile coverage, readiness и recommendation-context projections учитывают
   только SourceReference с `person_context`. Это правило не зависит от source
   channel, provider, connection или даты.
5. Forward-only migration добавляет enum и column, оставляет все существующие
   references как `person_context` и переводит в
   `operational_verification` только полный точный набор TASK-0063 под
   `external_system = shape-of-you-staging-canary`.
6. Backfill работает fail-closed: для каждого Person допустим либо полный набор
   двенадцати exact external record IDs, либо отсутствие совпадений. Частичный,
   повторный или расширенный набор останавливает migration до изменения строк.
7. Новые end-to-end canary выполняются только через отдельного authenticated
   staging Person. Internal purpose остаётся дополнительной границей и не
   заменяет Person isolation.
8. Новая table, service, database, credential или deployable не создаётся.

## Considered alternatives

### Фильтровать `2000-01-01` или TASK-0063 в Progress

Минимальный patch, но legitimate history может использовать ту же дату, а
provider-neutral module reads узнают об operational naming convention.
Отклонено.

### Удалить synthetic facts

Возвращает чистую пользовательскую проекцию без schema change, но уничтожает
append-only writer/read-back evidence и требует destructive data operation.
Отклонено.

### Перенести существующие facts к synthetic Person

Сохраняет записи, но меняет ownership большого связанного графа
SourceReference, Recovery consent/connection и Training dependencies. Такая
перезапись опаснее явной eligibility classification. Отклонено.

### Использовать только отдельного Person для будущих canary

Обязательно как operational правило, но не исправляет уже сохранённые facts.
Используется вместе с выбранным решением, а не вместо него.

### Ввести internal evidence purpose

Добавляет один enum, column и bounded join/filter в module-owned reads, зато
сохраняет аудит, не меняет facts и отделяет назначение evidence от транспорта.
Выбрано.

## Consequences

- Progress больше не показывает operational canary как историю Person.
- Provider-neutral контракт TASK-0107 сохраняется: фильтр использует назначение
  evidence, а не источник данных.
- Public commands остаются fail-closed и не позволяют скрывать пользовательские
  facts через присвоение operational purpose.
- Weight, Nutrition, Training и Recovery coverage queries должны применять
  единый predicate и сохранять bounded query count.
- Добавленные joins требуют PostgreSQL integration и query-plan проверки.
- Точный staging backfill применяется только после отдельного разрешения на
  migration/deployment.

## Verification

- Migration tests проверяют clean install, every-prefix upgrade, полный exact
  backfill, zero-match и fail-closed partial/extra sets.
- Contract tests подтверждают отсутствие `evidencePurpose` в public input и
  output schemas и отклонение дополнительного input property.
- Repository tests доказывают, что operational evidence не влияет на bounds,
  28/90 coverage или readiness, а person-context evidence продолжает работать.
- Training сохраняет union manual sessions и ExternalActivityFact; purpose
  применяется только к facts с SourceReference.
- Query-plan и query-count проверки подтверждают bounded execution без
  per-day fan-out.
- Web regression проверяет прежний provider-neutral интерфейс без специальных
  дат или provider labels.
- Все PostgreSQL identifiers проверяются на лимит 63 UTF-8 bytes.

## Related material

- [Provider-neutral profile coverage](./20260913-show-provider-neutral-profile-data-coverage.md)
- [Typed provenance and append-only supersession](./20260730-use-typed-provenance-and-append-only-supersession.md)
- [MCP writer canary and cutover preflight](./20260826-complete-typed-mcp-writer-parity-and-use-executable-cutover-preflight.md)
- [Data ownership](../wiki/architecture/data-ownership.md)
- TASK-0063
- TASK-0107
