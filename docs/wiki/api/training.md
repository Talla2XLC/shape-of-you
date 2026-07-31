---
id: "architecture-api-training"
kind: architecture
title: "API тренировок"
status: draft
tags:
  - "api"
  - "training"
  - "versioning"
---

# API тренировок

## Кратко

API предоставляет общий версионируемый справочник упражнений, персональные
версии программы, неизменяемые факты тренировок с отдельными подходами, личные
рекорды и предложения по увеличению нагрузки.

## Содержание

Справочник упражнений:

- `POST /v1/training/catalog/exercises`;
- `POST /v1/training/catalog/exercises/:id/versions`;
- `GET /v1/training/catalog/exercises/:id`;
- `PUT /v1/training/catalog/exercises/:id/overlay`.

Общие упражнения доступны нескольким людям без копирования. Частные упражнения
и персональные настройки изолированы по `Person`. Изменение упражнения создаёт
новую версию и не меняет старые программы или тренировки.

Программы:

- `POST /v1/training/programs`;
- `GET /v1/training/programs/:id`;
- `GET /v1/training/programs/active`;
- `POST /v1/training/programs/:id/versions`;
- `POST /v1/training/programs/:id/versions/:versionId/activate`.

Новая программа и новая версия сначала являются неактивными. Включение версии
выполняется отдельной командой с `expectedLockVersion`. У одного `Person` не
может быть двух активных программ.

Выполненные тренировки:

- `POST /v1/training/sessions` — идемпотентное создание;
- `GET /v1/training/sessions` — текущие факты с `limit` и необязательной
  локальной датой;
- `GET /v1/training/sessions/:id` — конкретный неизменяемый факт;
- `POST /v1/training/sessions/:id/corrections` — полная замена;
- `GET /v1/training/sessions/:id/history` — цепочка исправлений.

Сессия хранит версию упражнения, его зафиксированное название и каждый подход
с фактическими весом, повторениями и RIR. Исправление создаёт новую полную
сессию; прежняя остаётся в истории и исключается из текущих списков и
вычислений.

Вычисляемые результаты:

- `GET /v1/training/personal-records`;
- `GET /v1/training/progression-candidates`;
- `POST /v1/training/programs/:id/progression-candidates/accept`.

Личный рекорд выбирается по максимальному весу и затем по числу повторений.
Предложение увеличить вес появляется только при явно заданном шаге прогрессии
и выполнении требуемых подходов, повторений и RIR. Сам расчёт программу не
меняет. Принятие создаёт новую неактивную версию; пока она не рассмотрена,
повторное принятие и новые предложения блокируются.

## Основания

- `packages/contracts/src/training.ts`.
- `apps/api/src/training/`.
- `apps/api/src/storage/training-repository.ts`.
- `apps/api/test/training.integration.test.ts`.
- Принятые результаты проверки TASK-0017.

## Решения

- Входы, ответы и OpenAPI используют общие JSON Schema contracts.
- Записи внешних справочников подготавливаются отдельно; сетевого сборщика и
  автоматического объединения по названию нет.
- Рекорды и предложения прогрессии вычисляются запросами и не являются второй
  изменяемой истиной.

## Открытые вопросы

- Список допустимых значений самочувствия после анализа реальных данных.
- Правила прогрессии для собственного веса и упражнений с противовесом.
- Поиск по справочнику и конкретный внешний источник упражнений.

## Связанные материалы

- [Training and Performance](../domain/training-and-performance.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Backend migration notes](../data/backend-migrations.md)
- [ADR о программах и фактах тренировок](../../adr/20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
