---
id: "decisions-20260728-deployable-service-autonomy"
kind: adr
title: "Автономность каждого deployable service"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "architecture"
  - "service-boundaries"
---

# Автономность каждого deployable service

## Контекст

Совместное размещение в монорепозитории не должно размывать владение сервисом, направление зависимостей и операционную изоляцию.

## Решение

Каждый deployable service должен иметь собственные `Dockerfile`, `package.json`, `AGENTS.md`, границу базы данных, схемы Drizzle, миграции, seed-данные, credentials и integration tests.

Deployable service не должен импортировать другой сервис через пакет или workspace dependency. Общие зависимости допускаются только через явно выделенные shared packages.

Это обязательные ограничения при создании сервисов, но они не требуют создавать сервисы до завершения анализа bounded contexts.

## Рассмотренные альтернативы

- Общие build- и persistence-настройки сократили бы начальный объём файлов, но скрыли бы границы владения и затруднили независимую поставку.
- Прямые package dependencies между сервисами упростили бы повторное использование кода, но превратили бы сервисные границы в формальность.

## Последствия

Каждый deployable можно собирать, настраивать, мигрировать, тестировать и выпускать в пределах его собственной границы. Полная копия монорепозитория может использоваться как build context в CI, но не является runtime artifact. Runtime artifact содержит только deployable и его транзитивные зависимости.

До создания первого сервиса необходимо отдельно спроектировать шаблон сервиса и обязательные metadata. Конкретный механизм управления credentials также пока не определён.

## Проверка

- Требования явно заданы оператором 2026-07-28.
- Deployable services пока не созданы.

## Связанные материалы

- `../wiki/architecture/overview.md`
- `20260728-modular-monorepo.md`
- `20260728-api-or-event-only-cross-service-communication.md`
