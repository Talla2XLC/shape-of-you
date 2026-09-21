# TASK-0123 — Component-aware Identity delivery и bounded readiness

Статус: выполнено локально 2026-09-21; Quality Review и Architecture Review
приняты. Commit, push, deployment, migration и server change не выполнялись.

## Цель

Снизить intermittent staging failures на constrained shared VM: не выполнять
неизменённый Identity path для API-only releases и сделать readiness retries
реальными, короткими и безопасными.

Архитектура зафиксирована в
[ADR](../../../../docs/adr/20260921-skip-unchanged-identity-delivery-and-bound-readiness-probes.md).

## Scope

- точный repository-owned Identity change classifier;
- automatic push classification и full manual dispatch;
- `deploy_identity` в reusable workflow и controller protocol;
- fail-closed reuse текущего Identity coordinate и truthful no-op compatibility;
- `IDENTITY_UPDATE_REQUIRED` в immutable release manifest;
- пропуск Identity pull/migrate/reconcile/replacement при reuse;
- сохранение Identity topology и smoke;
- fresh 3-second readiness sessions перед прежней migration session;
- contract, unit и integration tests;
- affected canonical deployment Wiki pages после Quality acceptance.

## Out of scope

- RAM/swap/VM resize;
- memory limits или изменения соседнего приложения;
- PostgreSQL configuration, data или credentials;
- schema migration;
- изменение application API;
- dependency, service, scheduler или queue;
- server commands, deployment retry, commit или push.

## Этапы

1. Добавить classifier script и fixtures для exact Identity input paths.
2. Добавить workflow detection job; manual dispatch всегда full.
3. Сделать Identity publish conditional и передать `deploy_identity` в reusable
   deployment workflow.
4. Расширить bounded controller input и условную проверку Identity secrets.
5. При reuse прочитать и строго проверить current release manifest, runtime-env
   hash и live Identity digest, перенести coordinate, записать no-op
   compatibility flags и не менять runtime env.
6. Добавить `IDENTITY_UPDATE_REQUIRED` и условные branches в `deploy.sh`.
7. Разделить Identity readiness и migration pools; readiness attempt всегда
   создаёт и закрывает fresh bounded pool.
8. Добавить/обновить shell, workflow, unit и integration tests.
9. Выполнить focused suites, root lint/typecheck/build, docs/diff/board checks.
10. Провести independent Quality и Architecture Review.
11. Обновить только canonical deployment architecture и temporary VM runbook;
    Managed Wiki не использовать.

## Acceptance criteria

1. API-only push классифицирует `deploy_identity=false`.
2. Identity source, shared build input, Identity compose, initial/unknown base и
   manual dispatch выбирают full Identity delivery.
3. При false новый Identity image не публикуется.
4. Controller fail closed переиспользует только валидный current Identity
   coordinate, проверяет исторические compatibility flags и записывает `true`
   для нового no-op Identity transition.
5. Reuse отклоняется, если current manifest, SHA-256 root-owned `identity.env`
   и digest единственного running Identity container не совпадают.
6. Новый release manifest остаётся полным и immutable.
7. Reuse path не выполняет Identity pull, config probe, migration, OAuth
   reconciliation или прямой/косвенный runtime replacement.
8. Reuse path сохраняет Identity compose topology и smoke checks.
9. Full path сохраняет прежнее поведение.
10. Каждая readiness attempt ограничена 1s connect + 3s statement timeout,
   использует fresh pool и корректно retry до 12 раз.
11. Migration pool создаётся только после readiness и сохраняет 30s/240s
   limits.
12. Нет env-configurable timeout, migration, schema/API change, dependency или
   server mutation.
13. Tests, Quality, Architecture Review и canonical docs validation проходят.

## Проверки

- staging deployment shell contract tests;
- Identity unit и migration integration tests;
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- independent Quality Review;
- Architecture Review.

## Риски

- Неполный classifier может ошибочно reuse изменённого Identity. Поэтому список
  закрыт, shared inputs включены, а неизвестная revision выбирает full path.
- Current release manifest может отсутствовать или быть повреждён. Reuse в этом
  случае fail closed, без fallback digest.
- Bounded retries не устраняют длительную PostgreSQL degradation; они только
  предотвращают один бесполезный 240-second readiness wait.
- Первый release изменяет Identity code и должен пройти full Identity path.

## Отдельные operator gates

- commit;
- push;
- workflow rerun;
- staging deployment или migration;
- SSH/server mutation;
- production release.
