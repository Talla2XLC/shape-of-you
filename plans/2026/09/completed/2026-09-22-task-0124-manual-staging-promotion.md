# TASK-0124 — Manual low-footprint staging promotion

Статус: выполнено локально 2026-09-22; independent Quality Review и
Architecture Review приняты, canonical Wiki обновлена. Commit, push,
deployment, migration и server change не выполнялись.

## Цель

Исключить автоматическую нагрузку на constrained shared VM после каждого push,
оставив автоматическими quality/build/publication и весь безопасный deployment
после явного выбора release candidate оператором.

Архитектура зафиксирована в
[ADR](../../../../docs/adr/20260922-promote-staging-manually-with-immutable-candidates.md).

## Scope

- automatic publication без вызова VM;
- immutable release-candidate artifact с exact SHA и image digests;
- exact deployed base binding для безопасного Identity reuse;
- manual `Promote staging` по одному `release_id`;
- fail-closed provenance и candidate validation;
- вызов существующего reusable staging deploy только после promotion;
- последовательные pulls на VM;
- сохранение Identity component-aware reuse;
- workflow, shell и contract tests;
- canonical deployment Wiki update только после Quality acceptance.

## Out of scope

- увеличение RAM/swap и изменение VM size;
- limits, restart или configuration соседнего workload;
- PostgreSQL configuration или data changes;
- generalized API/edge/Certbot manifest reuse;
- остановка текущих runtime containers перед migration;
- новый service, scheduler, queue, dependency или environment secret;
- deployment, migration, SSH mutation, commit или push.

## Этапы

1. Добавить strict candidate writer/reader и focused contract tests.
2. Заменить automatic deploy job публикации на immutable artifact job.
3. Добавить manual promotion workflow с exact successful-main-run lookup.
4. Передавать validated candidate outputs в существующий reusable deploy.
5. Выполнять Compose pulls последовательно по service.
6. Обновить deployment workflow/shell contracts.
7. Выполнить focused tests и полные repository checks.
8. Провести independent Quality Review.
9. Обновить только affected canonical Wiki pages и changelog.
10. Провести Architecture Review и подготовить release/commit plan без staging.

## Acceptance criteria

1. Успешный push publication не вызывает reusable deploy и не контактирует с
   staging VM.
2. Candidate содержит exact repository, publication run id, release SHA,
   digests, Identity decision и ожидаемый deployed base при reuse без
   secrets/runtime configuration.
3. Promotion принимает только один полный `release_id` и разрешает только
   successful `main` publication того же exact commit, который остаётся
   текущим `main`.
4. Candidate parser отклоняет missing, duplicate, unknown, malformed и
   provenance-mismatched fields без `eval` или source.
5. Validated outputs без ручного копирования digest передаются существующему
   reusable deploy.
6. Deployment concurrency, protected Environment, root bootstrap, migrations,
   reconciliation, smoke, rollback и release pointers сохраняются.
7. Direct manual deploy recovery path сохраняется.
8. VM pulls выполняются по одному; unchanged Identity по-прежнему не pull.
   Identity reuse fail closed, если atomic `current` не равен candidate base.
9. Не добавлены dependency, secret/env contract, service, scheduler, schema,
   application API или server mutation.
10. Tests, docs validation, Quality и Architecture Review проходят.

## Проверки

- release-candidate contract tests;
- staging deployment shell contract suites;
- workflow YAML parse and static contracts;
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- independent Quality Review и Architecture Review.

## Риски

- Artifact retention ограничивает поздний promotion; direct digest-based
  recovery workflow остаётся доступным.
- Неверный run lookup мог бы смешать releases; exact SHA/branch/run/repository
  проверяются повторно внутри candidate.
- Последовательные pulls медленнее, но уменьшают transient pressure.
- Manual promotion может быть забыт; это явная принятая цена отказа от
  continuous staging deployment.

## Отдельные operator gates

- commit;
- push;
- workflow dispatch или rerun;
- staging deployment/migration;
- SSH/server mutation;
- production release.
