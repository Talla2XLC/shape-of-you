---
title: Временный deployment на общей VM
status: active
created: 2026-07-28
updated: 2026-07-29
related_roadmap_items: []
related_board_items:
  - TASK-0002
---

# Временный deployment на общей VM

## Цель

Реализовать утверждённый throwaway staging Shape of You на VM
`2.58.15.24`: собирать immutable images в GitHub Actions, запускать их
отдельным Compose project, публиковать web и API через собственный nginx на
port `3001` и изолировать данные API внутри существующего PostgreSQL cluster.

Этот план не разрешает работу с реальными пользовательскими данными и не
является production security acceptance.

## Архитектурная позиция

- Runtime остаётся одним deployable API; bounded contexts не становятся
  microservices.
- Собственный nginx — deployment adapter без business logic и database.
- Существующий PostgreSQL используется только как временный физический
  cluster. API владеет database `shape_of_you_api`, role, credentials,
  migrations и backup/restore lifecycle.
- Межсервисный SQL, общие schemas, credentials и migrations запрещены.
- GitHub Actions собирает artifacts; VM только выполняет pull, migrate, start,
  health verification и rollback.
- Kubernetes portability достигается runtime contracts, а не преждевременными
  Helm charts или Kubernetes manifests.

## Scope

### В объёме

- Read-only повторная фиксация текущих ports, Docker networks, bind addresses,
  ресурсов VM и версии PostgreSQL перед изменениями.
- Production-oriented Docker image API, запускающийся без build toolchain и
  без автоматического запуска migrations каждой репликой.
- Отдельный immutable nginx image/config для маршрутов `/` и `/api/`,
  request-size limits, timeouts, security headers и rate limit.
- Production Compose project с private network, healthchecks, restart policy,
  resource limits и единственным published port `3001`.
- GitHub Actions для lint, typecheck, tests, image build, GHCR publish и
  provenance по commit SHA/digest.
- Подготовка отдельной PostgreSQL database, login role и минимальных grants.
- One-shot migration step, smoke checks и проверяемый rollback на предыдущий
  image digest.
- SSH-tunnel guide для IDE без публичного PostgreSQL port.
- Минимальные runbooks deploy, rollback, logs, backup и restore verification.
- Обновление только затронутых Wiki, ADR и руководств.

### Вне объёма

- Domain, DNS, TLS certificates, authentication и authorization.
- Реальные пользовательские данные и production credentials пользователей.
- Изменение чужого nginx, чужого Compose или business containers.
- Второй PostgreSQL cluster на VM.
- Web application, mobile application и новые API capabilities.
- Kubernetes, Helm, autoscaling, service mesh и managed cloud.
- Новые deployable domain services или event infrastructure.
- Git commit, push, release и фактический deployment без отдельных approvals.

## Предварительные gates

1. Получить явное approval на production access и изменения VM.
2. Проверить, что backup существующего PostgreSQL и restore procedure
   согласованы с владельцем cluster; repository не навязывает общую backup
   policy.
3. Выбрать подключение API к PostgreSQL после проверки:
   - доступ через host gateway и loopback/private bind;
   - либо отдельная согласованная Docker network без зависимости от
     service/container name чужого Compose.
4. Убедиться, что PostgreSQL не публикуется в Internet и firewall сохраняет
   SSH-доступ оператора.
5. Подтвердить, что staging содержит только синтетические данные.
6. Получить отдельные approvals на GitHub secrets, GHCR login, migrations,
   firewall и deployment.

По результатам operator clarification 2026-07-29 выбран основной вариант
подключения: существующий PostgreSQL 17.4 опубликован соседним container на
host port `5431`, а API использует
`host.docker.internal:5431/shape_of_you_api`. Для throwaway staging SSL
отключён. Перед deployment доступность маршрута из container всё равно
проверяется read-only.

Runtime `DATABASE_URL` хранится в GitHub Environment secret
`STAGING_DATABASE_URL` и доставляется в root-owned
`/etc/shape-of-you/staging/api.env`. Административный PostgreSQL credential
используется только для разового provisioning и не становится runtime secret.

## Этапы

### 1. Инфраструктурная инвентаризация

- Зафиксировать `docker compose ls`, containers, networks, published ports,
  bind addresses, свободную память/disk/swap и PostgreSQL version.
- Не читать чужие secrets, environment values, dumps или production rows.
- Выбрать наименее связанный вариант database connectivity и описать rollback
  сетевого изменения.

### 2. Delivery artifacts

- Отделить migrations от обычного старта API.
- Проверить non-root runtime, graceful shutdown, health/readiness и отсутствие
  devDependencies в API image.
- Спроектировать nginx config и container image как stateless deployment
  adapter.
- Создать отдельный production Compose file; локальный Compose не превращать
  в скрытый production contract.
- Хранить secrets вне Git и не встраивать их в images или workflow logs.

### 3. CI и registry

- Добавить GitHub Actions workflow с минимальными permissions.
- Выполнять install по lockfile, lint, typecheck, unit/integration tests и
  image build.
- Публиковать GHCR images только после quality gates с SHA tag и digest.
- Не использовать mutable `latest` как deployment authority.
- Определить manual approval boundary между publish и deployment.

### 4. Database isolation

- Создать `shape_of_you_api` и отдельную login role с минимальными privileges.
- Проверить отсутствие grants к чужим databases и schemas.
- Перед migration выполнить согласованный backup step.
- Запустить migrations one-shot job и проверить migration journal, `/ready`
  и read/write synthetic smoke.
- Проверить backup и restore на отдельной test database до real-data gate.

### 5. Запуск и edge

- Запустить Compose project под отдельным project name.
- Опубликовать только `3001:80`; API и database оставить private.
- Проверить ожидаемый staging response на `/`, а также `/api/health`,
  `/api/ready` и `/api/openapi.json`.
- Проверить request-size limit, rate limit, proxy timeouts и отсутствие
  disclosure внутренних headers.
- Проверить с внешней сети и телефона, что доступен только утверждённый
  endpoint.

### 6. Operations и rollback

- Документировать pull по digest, migration, start, smoke, logs и rollback.
- Зафиксировать предыдущий working image digest до каждого deployment.
- Проверить rollback приложения. Для destructive migrations требовать
  отдельный expand/migrate/contract plan; автоматический down migration не
  считать безопасным rollback.
- Добавить мониторинг disk, memory, swap, container restarts и health.
- Проверять условия выхода из временной topology при каждом крупном изменении.

### 7. Quality и Architecture Review

- Независимо проверить workflow permissions, image contents, Compose
  isolation, grants, migration/rollback и отсутствие secrets в Git/logs.
- Выполнить tests, documentation validator и внешний smoke.
- Сверить результат с ADR и canonical Wiki.
- Выполнить Architecture Review перед завершением и только после этого
  переносить план в `completed/`.

## Критерии готовности

- GitHub Actions воспроизводимо строит проверенный API image и публикует SHA
  tag с известным digest.
- VM не содержит build context и не собирает application images.
- Shape of You запускается отдельным Compose project и не изменяет чужой
  Compose/nginx.
- Снаружи опубликован только `http://2.58.15.24:3001/`.
- API использует отдельные database, role и credentials; grants к чужим
  databases отсутствуют.
- Migrations запускаются отдельным one-shot step и проверены на чистой/test
  database.
- Deployment и application rollback по immutable digest проверены.
- PostgreSQL доступен разработчику только через SSH tunnel.
- В staging нет реальных пользовательских данных.
- Runbooks deploy, rollback, logs и restore verification актуальны.
- Validation и Architecture Review пройдены; непроверенные действия явно
  отмечены как blockers.

## Риски и восстановление

- Общий PostgreSQL cluster остаётся общей failure domain. Восстановление —
  остановить API, не затрагивая чужой stack, и при необходимости перенести
  `shape_of_you_api` в отдельный cluster.
- Публичный HTTP без authentication допускает чтение, запись и abuse API.
  Компенсация ограничена синтетическими данными и edge limits; это не
  security solution.
- Ошибка firewall или Docker networking может лишить доступа либо открыть
  PostgreSQL. Все изменения предваряются read-only checks и отдельным
  approval, а SSH session сохраняется до проверки нового подключения.
- Schema migration может быть несовместима с предыдущим image. Для таких
  изменений нужен expand/contract rollout и отдельный rollback plan.
- Mutable tags и ручное редактирование Compose на VM создают drift. Authority
  — Git-tracked configuration и immutable image digest.

## Architecture Review до реализации

1. **Избыточная сложность:** выбран минимальный временный набор — один API,
   один лёгкий edge adapter и существующий PostgreSQL cluster. Отдельный
   orchestrator, Kubernetes и второй cluster не добавляются.
2. **Преждевременная микросервисность:** новых domain services нет. Nginx
   решает только routing и edge limits; пять bounded contexts остаются
   логическими границами одного backend.
3. **Domain-Driven Design:** deployment topology не меняет domain model,
   aggregates или ownership business rules. API продолжает владеть своей
   database и migrations.
4. **Дублирование:** ADR хранит решение и компромиссы, Wiki — краткое
   утверждённое текущее направление, этот план — последовательность
   реализации и проверки. Runbooks будут содержать только операционные шаги.
5. **Упрощение:** использование чужого nginx уменьшило бы число containers,
   но создало бы более дорогую lifecycle dependency. Собственный PostgreSQL
   дал бы лучшую failure isolation, но сейчас не оправдан ресурсами. Выбранный
   компромисс обратим и содержит явные exit conditions.

Architecture Review не выявил более простого варианта, который одновременно
сохраняет независимость от чужого nginx, единую точку входа для web/API,
владение данными и возможность последующего переноса.

## Состояние реализации

Локально подготовлены:

- API image с отдельным server entrypoint без автоматической migration;
- one-shot migration services в local и staging Compose;
- production Compose с единственным published port `3001`;
- non-root nginx image с `/api/` routing, request limit и rate limit;
- scripts VM preflight, deployment, smoke и application rollback;
- reusable quality, GHCR publication и manual Environment-gated deployment
  workflows GitHub Actions;
- canonical operational runbooks.

До отдельных approvals не выполнены:

- root-owned installation deployment wrapper/assets и отдельный SSH key для
  `shape-deploy`;
- фактические migrations и deployment;
- фактические VM smoke, rollback и restore verification.

Выполнены с отдельными approvals: read-only VM inventory, disposable
container probe маршрута `host.docker.internal:5431`, создание
`shape_of_you_api` database/login role, GitHub Environment variables/secrets и
публикация immutable images. Личная учётная запись оператора исключается из
delivery path отдельным планом
`plans/2026/07/2026-07-29-dedicated-staging-deployment-identity.md`.

## Связанные материалы

- [ADR о временном deployment](../../../docs/adr/20260728-use-temporary-vm-deployment-with-shared-postgresql.md)
- [Deployment topology](../../../docs/wiki/architecture/deployment.md)
- [Владение данными](../../../docs/wiki/architecture/data-ownership.md)
- [Backend migration notes](../../../docs/wiki/data/backend-migrations.md)
