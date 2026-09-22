---
id: "decisions-20260922-promote-staging-manually-with-immutable-candidates"
kind: adr
title: "Продвигать immutable staging-кандидаты вручную и снижать пиковую нагрузку deployment"
status: accepted
date: 2026-09-22
supersedes: "decisions-20260903-bound-automatic-staging-delivery"
superseded_by: null
tags:
  - deployment
  - staging
  - github-actions
  - reliability
---

# Продвигать immutable staging-кандидаты вручную и снижать пиковую нагрузку deployment

## Context

Staging работает на общей VM с 2 GiB RAM. Увеличение памяти и ограничение
соседнего workload исключены оператором. Диагностика failed deployment
`35650608272` показала полностью занятую swap, отсутствие memory limits у
PostgreSQL и соседнего backend и четырёхминутную задержку Identity до первой
database readiness-пробы. Те же Identity-образы при спокойной нагрузке
загружают migration module примерно за три секунды, а `select 1` выполняется
быстро. Значит, автоматический deployment каждого подходящего push создаёт
непредсказуемый transient resource burst на VM.

Предыдущее решение уже исключает неизменённый Identity из API-only delivery,
но первый release этого изменения обязан пройти full Identity path. Сам факт
автоматического запуска после publication не даёт оператору выбрать момент с
низкой нагрузкой и заставляет VM принимать каждый успешный release candidate.

## Decision

Push в `main` по-прежнему автоматически выполняет quality и публикует
immutable GHCR images. Publication больше не вызывает reusable staging deploy
workflow и не открывает SSH-соединение с VM.

Успешная publication создаёт GitHub Actions artifact с точным release
candidate contract: repository, publication run id, полный commit SHA,
API/Identity/edge/Certbot digests, boolean Identity update decision и, при
reuse Identity, exact staging base release. Artifact
не содержит credentials или runtime configuration. Его имя включает полный
release SHA, retention ограничена, а повторное использование требует
успешного publication run того же repository, branch `main` и commit. В
соответствии с существующей root bootstrap boundary продвигаемый commit должен
быть exact текущим `main`, а не только его предком.

Отдельный manual `Promote staging` workflow принимает только полный
`release_id`. Он находит успешный `Publish staging images` run для exact SHA,
проверяет его branch, commit, event и conclusion, загружает только artifact с
ожидаемым именем и fail closed разбирает allowlisted поля без shell evaluation.
После проверки workflow передаёт точные digests и Identity decision в
существующий reusable `Deploy staging`.

При `DEPLOY_IDENTITY=false` candidate связывает reuse с `before` SHA push,
относительно которого был вычислен change set. Root-owned controller до чтения
Identity coordinate требует, чтобы atomic `current` указывал ровно на этот
release. Несовпадение означает, что staging пропустил промежуточный кандидат;
promotion fail closed, а operator вручную публикует current `main`, что создаёт
полный Identity candidate. При `DEPLOY_IDENTITY=true` base release отсутствует.

После явного promotion deployment остаётся полностью автоматизированным:
protected Environment, dedicated SSH identity, root-owned bootstrap,
migrations, Identity client reconciliation, runtime replacement, smoke,
rollback rules и atomic `current`/`previous` pointers не ослабляются. Direct
manual dispatch reusable deploy с полным набором digests сохраняется как
операционный recovery path. Его typed `deploy_identity` default остаётся
`true`; сочетание `false` с обязательным direct-dispatch Identity digest
отклоняется существующей input validation и не создаёт второй reuse path.

На VM image pulls выполняются последовательно по одному service. Неизменённый
Identity по-прежнему наследуется по принятому component-aware contract и не
pull/migrate/reconcile/replace. Generalized reuse API, edge и Certbot отложен:
он потребовал бы расширить root-owned manifest protocol и rollback semantics
сразу для нескольких компонентов.

## Considered alternatives

### Сохранить automatic deploy и повторять failures

Не требует изменений, но каждый push продолжает создавать resource burst и
может снова зависнуть до первой application phase. Отклонено.

### Добавить approval к GitHub Environment

Уменьшает число фактических deployments, но связывает каждый publication run
с ожидающим deployment job и усложняет выбор последнего кандидата. Отложено в
пользу явного release promotion.

### Полностью выполнять deployment вручную через SSH

Снижает частоту, но переносит на оператора выбор digest, migrations, smoke и
release pointers. Это повышает риск рассинхронизации и ослабляет audit trail.
Отклонено.

### Выполнять migrations с GitHub runner через SSH tunnel

Снимает часть Node memory с VM, но расширяет database network/credential
boundary и dedicated SSH privileges. Отклонено.

### Остановить текущий API/Identity перед migrations

Освобождает память, но создаёт ранний downtime и новый recovery path после
частично применённой migration. Не требуется для минимального решения и
отложено.

## Consequences

- Обычный push больше не меняет staging и не создаёт VM resource burst.
- Оператор выбирает момент promotion exact текущего опубликованного `main`, не
  копируя digests вручную.
- Publication и deployment остаются воспроизводимыми по immutable coordinates.
- Один promotion всё ещё может не пройти при длительном resource pressure;
  решение управляет частотой и пиком, но не добавляет отсутствующую RAM.
- Последовательные pulls увеличивают wall-clock duration, но уменьшают
  одновременную распаковку образов и давление на page cache/swap.
- Expired artifact нельзя продвинуть через простой workflow; остаётся direct
  manual deploy recovery path с точными опубликованными digests.
- Если после publication появился documentation-only commit, для нового
  current `main` сначала нужен manual publication run; это сохраняет exact-main
  control boundary без расширения root bootstrap trust.
- Staging больше не является continuous deployment environment: состояние
  может сознательно отставать от `main` до operator promotion.
- Incremental Identity reuse возможен только поверх exact deployed base;
  пропущенная публикация с Identity change не может быть унаследована молча.

## Verification

- Workflow contract tests подтверждают отсутствие automatic deploy job и SSH
  path в publication workflow.
- Release candidate tests проверяют exact fields, SHA/digest/boolean/base formats,
  duplicate, unknown, missing и mismatched provenance values.
- Promotion workflow проверяется на единственный `release_id`, exact successful
  main run и передачу validated outputs в reusable deploy.
- Deployment shell tests подтверждают последовательный pull и сохранение
  Identity reuse/full paths.
- YAML parse, shell syntax, workspace tests, lint, typecheck, build,
  documentation validation и independent reviews проходят локально.

## Related material

- [Bound automatic staging delivery](20260903-bound-automatic-staging-delivery.md)
- [Component-aware Identity delivery](20260921-skip-unchanged-identity-delivery-and-bound-readiness-probes.md)
- [Deployment topology](../wiki/architecture/deployment.md)
- [Temporary VM deployment](../wiki/operations/temporary-vm-deployment.md)
- [TASK-0124 plan](../../plans/2026/09/completed/2026-09-22-task-0124-manual-staging-promotion.md)
- TASK-0124
