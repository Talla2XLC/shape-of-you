---
id: "architecture-api-body-measurement-sessions"
kind: architecture
title: "API BodyMeasurementSession"
status: draft
tags:
  - "api"
  - "body"
  - "contract"
  - "physical-state"
---

# API BodyMeasurementSession

## Кратко

API управляет принадлежащими `Person` неизменяемыми сеансами замеров тела.
Один сеанс атомарно содержит от одного до пяти типизированных значений с общей
provenance. Исправление создаёт полный replacement snapshot и не меняет
исходный сеанс.

## Содержание

Endpoints:

- `POST /v1/body-measurement-sessions` — `201` для нового сеанса и `200` для
  idempotent retry по `(personId, source channel, dedupeKey)`;
- `POST /v1/body-measurement-sessions/:id/corrections` — append-only
  correction, `409`, если исходный сеанс уже заменён другой correction;
- `GET /v1/body-measurement-sessions/:id` — чтение неизменяемого snapshot;
- `GET /v1/body-measurement-sessions/:id/history` — полная цепочка corrections;
- `GET /v1/body-measurement-sessions?limit=50&cursor=...&metric=waist` —
  только текущие сеансы, stable order `(measuredAt DESC, id DESC)`, opaque
  cursor и optional metric filter.

Create и correction принимают `measuredAt`, IANA `timezone`, `values`,
`dedupeKey`, typed `sourceReference` и nullable `confidence`, `photoMediaId`,
`note`. Каждый value содержит metric `waist`, `chest`, `hips`, `thigh` или
`biceps`, число `1.00..500.00` и unit `cm`. Duplicate metric отклоняется.

`personId`, `localDate`, UUID и server timestamps не принимаются как доверенные
client fields. Публичный `SourceReference` не содержит private raw snapshot.

## Основания

- `packages/contracts/src/body-measurement-session.ts`.
- `apps/api/src/body-measurement-sessions/`.
- PostgreSQL integration tests Physical State.

## Решения

- Сеанс и его values записываются одной транзакцией.
- В один локальный день разрешено несколько независимых сеансов.
- Correction заменяет агрегат целиком, сохраняя исходный snapshot и provenance.

## Открытые вопросы

- Upload, хранение, retention и удаление private media.
- Privacy и retention policy для заметок и фотографий.

## Связанные материалы

- [BodyMeasurementSession](../domain/body-measurement-session.md)
- [Backend runtime](../architecture/backend-runtime.md)
- [Backend migration notes](../data/backend-migrations.md)

