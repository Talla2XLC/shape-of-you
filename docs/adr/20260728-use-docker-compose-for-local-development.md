---
id: "decisions-20260728-use-docker-compose-for-local-development"
kind: adr
title: "Docker Compose для локальной разработки"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "development"
  - "infrastructure"
---

# Docker Compose для локальной разработки

## Контекст

В будущем локальной разработке понадобится воспроизводимая координация приложения и инфраструктурных зависимостей без преждевременного определения production topology.

## Решение

Использовать Docker Compose только для оркестрации локальной разработки после появления утверждённых runtime components.

Это решение не выбирает production orchestration и не разрешает создавать пустой инфраструктурный каркас. На текущем baseline Compose-файл не создаётся.

## Рассмотренные альтернативы

- Устанавливать зависимости непосредственно на host: проще вначале, но хуже воспроизводится между окружениями.
- Использовать локальный Kubernetes: ближе к некоторым production topologies, но создаёт неоправданную сложность до появления требований к deployment.

## Последствия

Создание Compose-конфигурации отложено до появления утверждённых runtime components. Production hosting и orchestration пока не определены.

## Проверка

- Решение явно принято оператором 2026-07-28.
- Docker Compose-файлы в рамках baseline не создаются.

## Связанные материалы

- `../wiki/architecture/repository-and-runtime.md`
- `../wiki/architecture/quality-attributes.md`
