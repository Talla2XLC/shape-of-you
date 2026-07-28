---
id: "decisions-20260728-use-temporary-vm-deployment-with-shared-postgresql"
kind: adr
title: "Временный deployment на общей VM с изолированной базой API"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "deployment"
  - "infrastructure"
  - "postgresql"
---

# Временный deployment на общей VM с изолированной базой API

## Контекст

Shape of You нужен недорогой временный staging до появления реальных
пользователей и переноса в отдельное облако. Доступна VM `2.58.15.24`, где уже
работают чужие nginx и PostgreSQL. Портами `80` и `443`, жизненным циклом
чужого Compose и его nginx проект не управляет. Ресурсов VM достаточно для
одного API и лёгкого reverse proxy, но запуск второго PostgreSQL создаст
лишнее давление на память.

Доменный backend сейчас один. Его HTTP API не реализует authentication и
authorization, поэтому публикация через обычный HTTP не подходит для реальных
пользовательских данных.

## Решение

До выполнения условий выхода использовать следующую временную topology:

- GitHub Actions проверяет код, собирает immutable OCI images и публикует их в
  GHCR с tag по commit SHA; VM только получает и запускает готовые images.
- Shape of You разворачивается собственным Compose project и не изменяет
  чужой Compose или конфигурацию чужого nginx.
- Собственный nginx Shape of You публикует единственный внешний endpoint
  `http://2.58.15.24:3001/`: `/` зарезервирован для web, `/api/` маршрутизирует
  запросы в API. API и будущий web не публикуют host ports напрямую.
- Собственный nginx является временным deployment adapter без бизнес-логики и
  данных, а не отдельным domain service. Он не создаёт новую service boundary.
- Текущий API использует существующий PostgreSQL cluster, но получает
  отдельную database `shape_of_you_api`, отдельную login role, отдельные
  credentials и собственные migrations. Межсервисный SQL, общие schemas,
  credentials и migrations запрещены.
- Способ подключения контейнера API к существующему PostgreSQL выбирается
  после read-only проверки Docker networks и bind address. Предпочтение
  отдаётся варианту с минимальной связанностью и без публичной публикации
  PostgreSQL. Доступ из IDE выполняется только через SSH tunnel.
- Migrations выполняются как отдельный one-shot deployment step до запуска
  новой версии API. Одновременный запуск migrations каждой репликой не
  является целевой production-схемой.
- Runtime остаётся переносимым: stateless API, конфигурация через environment,
  `/health`, `/ready`, graceful shutdown, stdout/stderr logs, immutable images
  и отсутствие host-path state приложения.
- Kubernetes, Helm и cloud-specific manifests сейчас не создаются. Будущий
  перенос меняет deployment adapter, а не доменную архитектуру или владение
  данными.

До появления HTTPS, authentication и authorization endpoint на `3001`
считается только throwaway staging: разрешены исключительно синтетические
данные и тестовые credentials. Нужны ограничение размера запросов, rate limit
и запрет публикации PostgreSQL. Такая защита уменьшает риск злоупотребления,
но не делает HTTP пригодным для персональных данных.

Условия выхода из временной topology:

- планируется публичная регистрация или появляются реальные внешние
  пользователи;
- нужно хранить персональные или иные чувствительные данные;
- появляются измеримые SLA, RPO/RTO или несколько реплик;
- устойчивое использование памяти превышает `70–75%` либо возникает swap
  pressure;
- создаётся первый независимо выпускаемый сервис;
- зависимость от lifecycle чужого PostgreSQL становится неприемлемой.

Переезд выполняется через проверенный backup/restore либо
`pg_dump`/`pg_restore`, затем migrations, smoke tests и reconciliation.

## Рассмотренные альтернативы

- Использовать чужой nginx и добавить в него routing rules. Это экономит один
  лёгкий контейнер, но связывает release Shape of You с чужим image, Compose и
  правами на конфигурацию.
- Запустить собственные nginx и PostgreSQL на той же VM. Владение было бы
  чище, но второй PostgreSQL неоправданно расходовал бы ограниченную память,
  пока пользователей нет.
- Разместить приложение на VM `46.30.188.217`. Один vCPU и примерно `1 GiB`
  RAM дают слишком маленький запас даже для текущих proxy workloads.
- Сразу перейти в отдельное облако и Kubernetes. Это лучше изолирует runtime,
  но преждевременно добавляет стоимость, cluster operations и manifests без
  подтверждённой нагрузки.
- Публиковать API напрямую на отдельном host port без reverse proxy. Это
  проще, но не даёт единой точки входа для web и API и переносит edge concerns
  в приложение.

## Последствия

Проект получает дешёвый и обратимый staging, не зависит от чужого nginx и не
создаёт преждевременных microservices. Сборка отделена от VM, а artifact
однозначно связан с commit.

Временная topology сохраняет физическую зависимость от чужого PostgreSQL
cluster: его остановка, upgrade или нехватка ресурсов затронут API. Изоляция
database и credentials не является изоляцией отказов. Публичный HTTP endpoint
до появления security baseline допускает только синтетические данные.

Production Compose, workflow GitHub Actions, nginx image/config, secret
delivery, backup/restore runbook и firewall changes создаются только по
утверждённому implementation plan. Этот ADR сам по себе не разрешает
deployment или изменение VM.

## Проверка

- CI собирает image из commit и публикует SHA tag с зафиксированным digest.
- На VM нет build context и сборки application image.
- Снаружи доступен только выбранный HTTP port; API, web и PostgreSQL не
  публикуются отдельно.
- API role не имеет доступа к чужим databases, а migrations работают только
  с `shape_of_you_api`.
- Повторный deployment и rollback выполняются по immutable image reference.
- До real-data gate используются только синтетические данные.
- Условия выхода проверяются при каждом Architecture Review deployment.

## Связанные материалы

- [Deployment topology](../wiki/architecture/deployment.md)
- [Владение данными](../wiki/architecture/data-ownership.md)
- [Репозиторий и runtime](../wiki/architecture/repository-and-runtime.md)
- [Автономность deployable service](20260728-deployable-service-autonomy.md)
- [PostgreSQL с Drizzle](20260728-use-postgresql-with-drizzle-orm-and-kit.md)
