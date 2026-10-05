---
id: decisions-20261006-bound-staging-docker-image-retention
kind: adr
title: "Ограничить хранение Docker-образов Shape на общем staging"
status: accepted
date: 2026-10-06
supersedes: []
superseded_by: null
tags:
  - architecture
  - deployment
  - operations
---

# Ограничить хранение Docker-образов Shape на общем staging

## Context

Доставка TASK-0156 остановилась при Docker pull с no space left on device.
Read-only диагностика выявила исчерпание inode при наличии свободных гигабайт,
610 образов Shape из 618. Существующий deploy не ограничивает их хранение.
Общий сервер обслуживает другие приложения; глобальная очистка неприемлема.

## Decision

Оператор одобрил ADR и план перед реализацией. Применяются правила:

1. Удалять только образы четырёх точных repositories Shape: API, Identity,
   edge и Certbot в ghcr.io/talla2xlc. Образы с дополнительными неизвестными
   repository references исключать из удаления.
2. Защищать все существующие контейнеры, current, previous и кандидат
   выполняемой выкладки; дополнительно сохранять три самых свежих образа
   каждого repository. Не удалять volumes, данные PostgreSQL, журналы,
   credentials или образы других приложений. Не использовать force или
   глобальные docker system/image prune.
3. Сначала формировать проверяемый dry-run; отсутствие или неоднозначность
   защищённых координат блокирует удаление. Удалять точные image IDs через
   Docker API, перепроверяя references и защищённые координаты.
4. Штатную очистку выполнять внутри существующей deployment lock, до pull,
   после проверки release metadata. Не добавлять сервис, таймер или отдельную
   deployable boundary. Ошибка очистки останавливает deploy с диагнозом.
5. Проверять свободные bytes и inode перед pull; пороги оформить в согласованном
   плане реализации после проверки размеров слоёв, без выдуманного универсального
   лимита. Эта ADR не разрешает изменение размеров диска или Docker daemon.
6. Разовая очистка выполняется только после одобрения конкретного dry-run
   оператором и повторной проверки current/previous/containers. Затем допускается
   ранее разрешённый штатный Promote exact TASK-0156 SHA.

## Considered alternatives

- Глобальный prune: проще, но затрагивает соседние проекты и rollback; отклонён.
- Увеличение диска без retention: временно отодвигает проблему, не ограничивает
  рост; отдельная инфраструктурная операция.
- Только очистка после успешной выкладки: не помогает следующему pull при
  исчерпании inode; поэтому очистка предлагается перед pull.
- Внешний cron: добавляет второй writer и гонки с deploy; существующая lock
  и controller сохраняют одну точку управления.

## Consequences

Ограничивается локальное накопление образов без потери current/previous и
изоляции соседних приложений. Более старый откат может потребовать повторного
pull точного digest из registry. Shared layers означают, что сумма размеров
образов не равна реально освобождаемым bytes; результат измеряется после удаления.

## Verification

Pin tests: shared host isolation, multiple RepoDigests, containers/current/previous/
candidate protection, missing metadata, lock requirement, dry-run, no force,
проверка inode и partial failure. Независимая Quality, Architecture Review,
каноническая Wiki и docs validator. Live очистка отдельно от isolated tests.

## Related material

- [Staging runbook](../wiki/operations/temporary-vm-deployment.md)
- [План TASK-0157](../../plans/2026/10/completed/2026-10-06-task-0157-staging-image-retention.md)
