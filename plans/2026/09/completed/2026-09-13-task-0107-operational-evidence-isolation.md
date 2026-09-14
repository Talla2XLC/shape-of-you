# TASK-0107 — Изоляция operational evidence от контекста Person

## Статус и разрешение

- Статус: completed locally; release gates remain pending.
- Оператор одобрил internal evidence purpose, additive migration и полный
  локальный цикл Developer → Quality → Architecture Review → Wiki.
- Commit, push, deployment и применение migration не разрешены.

## Цель

Сохранить append-only TASK-0063 canary evidence для аудита, но исключить его из
provider-neutral покрытия, readiness и recommendation context пользователя.

## План

1. [x] Зафиксировать решение в новом ADR.
2. [x] Добавить internal `source_references.evidence_purpose` с безопасным
   default `person_context`.
3. [x] Создать forward-only fail-closed backfill для полного exact набора
   TASK-0063 SourceReference.
4. [x] Сохранить public SourceReference contracts без нового поля.
5. [x] Применить person-context predicate в module-owned coverage reads Weight,
   Nutrition, Training и Recovery.
6. [x] Добавить migration, repository, contract/security и regression tests.
7. [x] Проверить bounded query count, индексируемые query paths, migration chain, identifier length,
   lint, typecheck, build, API/Web tests и docs validation.
8. [x] Передать замороженный diff независимому Quality.
9. [x] Выполнить Architecture Review и post-acceptance Wiki update.

## Критерии приёмки

1. Operational evidence не влияет на historical bounds, coverage или readiness.
2. Person-context evidence из любых providers и channels продолжает учитываться.
3. Public commands не принимают и не публикуют `evidencePurpose`.
4. TASK-0063 facts, correction chains и SourceReference не удаляются и не
   переносятся между Person.
5. Backfill меняет только полный exact canary set и падает до update при
   неоднозначном наборе.
6. Training продолжает объединять manual sessions и imported activities.
7. Coverage execution остаётся bounded и использует подходящие indexes/plans.
8. Canonical ADR/Wiki отражают только принятое текущее поведение.

## Architecture Review checklist

- Не создаются новый service, database, deployable или generic fact aggregate.
- Purpose принадлежит provenance и не дублируется во всех fact tables.
- Provider-neutral и Person ownership boundaries сохраняются.
- Operational naming convention отсутствует в runtime coverage policy.
- Решение можно расширить на будущие recommendation projections без второго
  источника истины.

## Ограничения

- Live staging migration, deployment и новые canary требуют отдельных
  operator approvals.
- Выделенный staging Person не создаётся в этом локальном implementation cycle;
  текущий scope фиксирует fail-closed operational requirement и data boundary.
