---
id: skip-unchanged-identity-delivery-and-bound-readiness-probes
kind: adr
title: "Пропускать неизменённый Identity и ограничить readiness-пробы"
status: accepted
date: 2026-09-21
supersedes: []
superseded_by: null
tags:
  - architecture
  - deployment
  - identity
  - staging
---

# Пропускать неизменённый Identity и ограничить readiness-пробы

## Context

Staging работает на общей VM с 2 GiB RAM и полностью занятой swap. Увеличить
память или ограничить соседнюю нагрузку сейчас нельзя. PostgreSQL и соседнее
приложение не имеют cgroup memory limits, а PostgreSQL обслуживает десятки
процессов. Поэтому дополнительная transient-нагрузка deployment иногда делает
даже `select 1` недостаточно отзывчивым.

Текущий pipeline пересобирает и разворачивает API, Identity, edge и Certbot для
любого non-documentation push. TASK-0122 изменил только API и документацию, но
pipeline создал новый Identity digest, запустил Identity migration и упал в
`readiness_started`. Аналогичный Identity timeout уже происходил 2026-09-17.

Identity readiness использует тот же 240-секундный PostgreSQL
`statement_timeout`, что и настоящая migration session. Поэтому одна зависшая
проверка поглощает почти весь внешний 300-секундный migration budget, а
объявленные 12 попыток фактически не выполняются.

## Decision

1. Automatic `main` delivery классифицирует изменение по точному закрытому
   списку Identity build inputs: `.dockerignore`, `apps/identity/**`, `package.json`,
   `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json` и
   `deploy/staging/compose.identity.yaml`.
2. Неизвестная base revision, initial push и manual workflow dispatch всегда
   выбирают полный Identity path. Классификация fail-safe: сомнение означает
   `deploy_identity=true`.
3. Reusable staging workflow получает обязательный boolean `deploy_identity`.
   При `true` сохраняется полный существующий Identity publish/deploy path.
4. При `false` workflow не публикует новый Identity image. Root-owned
   deployment controller читает только текущий root-owned release manifest,
   проверяет ровно один валидный Identity image, digest и compatibility flags и
   переносит coordinate в новый immutable release manifest. Отсутствующий,
   неоднозначный или невалидный current coordinate останавливает deployment.
   Исторические compatibility flags проверяются как часть целостности current
   manifest, но новый no-op Identity transition записывает оба флага как `true`:
   digest, schema и predefined client policy не изменились.
   Reuse дополнительно требует совпадения SHA-256 текущего root-owned
   `identity.env` с non-secret hash из current manifest и точного image digest
   единственного запущенного Compose Identity container. Это отклоняет reuse
   после failed full deployment, который успел изменить runtime state, но не
   переключил `current`.
5. Новый release остаётся атомарным набором четырёх точных coordinates, но
   Identity coordinate может быть явно унаследован от current release.
6. `IDENTITY_UPDATE_REQUIRED=false` сохраняет Identity в Compose topology и
   smoke verification, но исключает Identity pull, configuration probe,
   migration, predefined OAuth reconciliation и runtime replacement. Финальный
   edge update использует `--no-deps`, чтобы Compose не запускал косвенный
   Identity reconciliation. API migration и API/edge deployment продолжаются.
7. Manual dispatch по умолчанию устанавливает `deploy_identity=true`, поэтому
   операционный full retry и изменение protected configuration не зависят от
   path classifier.
8. Readiness и migration используют разные database sessions. Каждая readiness
   attempt создаёт fresh pool с 1-секундным connection timeout и 3-секундным
   statement timeout, выполняет `select 1` и закрывает pool. Выполняется до 12
   попыток с существующей bounded delay.
9. Только после успешной readiness-пробы создаётся migration pool с прежними
   `lock_timeout=30s` и `statement_timeout=240s`. Эти значения остаются
   code-owned и не становятся environment configuration.
10. Решение не меняет VM, PostgreSQL, соседние workloads, schema, application
    contracts, credentials или production. Оно не выполняет deployment,
    migration или restart само по себе.

## Considered alternatives

### Только повторять failed deployment

Повтор может пройти при более удачной нагрузке, но оставляет необязательный
Identity path и не устраняет ложные retries. Отклонено как основное решение.

### Увеличить migration timeout

Маскирует неотзывчивость и увеличивает время блокировки pipeline. Readiness
остаётся неспособной перейти ко второй попытке. Отклонено.

### Останавливать API и Identity перед migrations

Освобождает часть памяти, но создаёт ранний downtime и усложняет восстановление
при failure. Отклонено.

### Перенести или ограничить соседний workload либо увеличить RAM

Это прямое инфраструктурное решение, но оно недоступно по operator constraint.
Не входит в текущий scope.

### Component-aware Identity reuse плюс bounded readiness

Убирает ненужную работу для большинства API-only releases и сохраняет
fail-closed полный path, когда Identity действительно изменён. Выбрано.

## Consequences

- API-only release больше не зависит от необязательной Identity migration.
- Новый release manifest всё равно полностью воспроизводим: inherited Identity
  digest и truthful no-op compatibility declarations сохраняются явно.
- Path list становится deployment contract и защищается tests. Изменение
  Identity build inputs требует обновлять classifier.
- Первый release этого решения изменяет Identity readiness code и поэтому
  проходит полный Identity path; последующие API-only releases используют reuse.
- Failed full Identity deployment может оставить runtime state новее `current`.
  Reuse сравнивает manifest с runtime env и live container и fail closed при
  любом расхождении.
- Краткие fresh readiness attempts повышают вероятность пережить transient
  pressure и быстрее дают честный failure при длительной недоступности.
- Решение снижает, но не устраняет общий memory pressure общей VM.

## Verification

- Shell tests проверяют API-only, Identity, shared-input, initial/unknown-base и
  manual/full classification.
- Deployment contract tests проверяют conditional Identity publish, новый
  workflow input, bounded request allowlist и fail-closed current-manifest reuse.
- Deploy-script tests подтверждают, что reuse сохраняет Identity smoke, но не
  вызывает Identity pull, migration, reconciliation или replacement.
- Identity state contract проверяет успешное точное совпадение и отказ при
  stale runtime env или live digest.
- Identity unit/integration tests подтверждают fresh readiness pools, 3-second
  statement timeout, retries и прежние migration session limits.
- Выполняются shell contract suites, Identity tests, root lint/typecheck/build,
  canonical documentation validation, independent Quality и Architecture Review.

## Related material

- [Deployment topology](../wiki/architecture/deployment.md)
- [Temporary VM deployment](../wiki/operations/temporary-vm-deployment.md)
- [End-to-end migration bounds](./20260917-make-staging-migration-bounds-end-to-end.md)
- [TASK-0123 plan](../../plans/2026/09/completed/2026-09-21-task-0123-component-aware-identity-delivery.md)
- TASK-0123
