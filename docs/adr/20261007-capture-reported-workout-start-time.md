---
id: "decisions-20261007-capture-reported-workout-start-time"
kind: adr
title: "Сохранять время сообщения о начале тренировки через MCP"
status: accepted
date: 2026-10-07
supersedes: []
superseded_by: null
tags:
  - architecture
  - training
  - mcp
---

# Сохранять время сообщения о начале тренировки через MCP

## Context

TASK-0165: подробная тренировка сохранена с occurredAt=null и local_date,
хотя imported Intervals activity имеет start_date. История подробного факта
не содержит предшественника; потеря времени при correction в этом инциденте
не подтверждена. Исходный chat timestamp и tool payload неизвестны.

Проверка настоящего локального MCP handler с synthetic Training stub показывает:
явный occurredAt проходит без изменений при create и completion correction;
note «Started now» при local_date остаётся без start timestamp. Это проверка
adapter dispatch, не PostgreSQL persistence и не исторический repro.
Intervals normalizer сохраняет start_date как occurredAt; provider время
принадлежит external activity и само по себе не доказывает её связь с сессией.

Опубликованный V2 JSON Schema содержит common properties и root anyOf.
В доступной клиентской декларации record_workout_session_v2 остались только
временные ветки, а общие workout/exercises/dedupe поля исчезли. В correction
измерительные ветки sets скрывают остальные поля set. Это подтверждённый
дефект представления данного клиента, не доказательство прошлого payload.

## Decision

Оператор одобрил ADR и план сообщением «го». Принят один ограниченный MCP capture adapter поверх существующей модели:

1. Публиковать V2 create/correction как обычные object schemas: общие поля
   доступны клиенту, root temporal и nested set measurement conditions
   проверяет неизменный исходный strict V2 validator после normalization.
   Bounds, types, enum и имена полей сохраняются; REST и output не меняются.
   Legacy tools сохраняются. SourceReference при ручном MCP capture можно
   опустить: API заполняет существующий manual provenance, как уже умеет
   normalization. Unsupported contradictions не доходят до Training write.
2. Добавить только в MCP create optional startReportedNow:boolean.
   Его используют исключительно для прямого «начал сейчас», без точного
   времени. Создаётся in_progress session, exercises=[] допустимы; будущая
   программа не считается выполненной. Явный старт с временем продолжает
   передаваться через occurredAt. Одновременные противоречивые modes отвергаются.
3. Для startReportedNow сервер берёт момент получения команды из injectable
   clock и переводит его в timezone Person. Это приближение к моменту отчёта,
   не исходный timestamp сообщения ChatGPT и не измерение Garmin. Сохраняется
   existing sourceReference: channel=manual,
   externalSystem=mcp_start_report:v1, externalRecordId=исходный dedupeKey,
   occurredAt=серверный capture instant. Это идентичность команды, не chat
   message id. Клиент не может передать imported/device provenance этим путём.
   Новая entity, таблица и migration не нужны.
4. Повтор того же dedupeKey возвращает canonical факт с первоначальным
   временем; новый clock не заменяет сохранённое время. Completion и сообщения
   о sets читают текущую сессию и append-only корректируют её, сохраняя
   occurredAt, timezone, temporalPrecision и sourceReference. Явное изменение
   старта остаётся существующей full-replacement correction. Не обещать
   server enforcement сохранения всех полей вопреки full-replacement contract.
5. Для «закончил сейчас» сохраняется completed state; если старт неизвестен,
   он остаётся неизвестным. Время конца можно сохранить в note, но его нельзя
   записывать как occurredAt начала или вычислять старт из guessed duration.
   Delayed/retrospective «вчера начал» без времени остаётся local_date.
6. Existing automatic matching с confirmed recording mode и start tolerance
   до 15 минут остаётся прежним. Проверить timed start → completion → late
   Intervals import и обратный порядок. Не вводить rejected date-only matching,
   не подставлять provider time в якобы сообщённый start, не менять explicit links.

## Considered alternatives

- Только prompt: не предоставляет модели надёжный часовой timestamp и
  не исправляет исчезающие поля клиентской схемы.
- Требовать от пользователя часы/минуты при «начал сейчас»: переносит
  техническую проблему в тренировочный разговор.
- Отдельный clock tool: ещё один round trip, clock и write разделены;
  время всё равно является моментом обработки, а не timestamp сообщения.
- Связывать только по дню или копировать start_date ближайшей активности:
  оператор отклонил первый путь; второй подменяет доказательство связи.
- Новый V3/временная entity: лишняя граница для additive MCP input; existing
  SourceReference описывает происхождение без изменения output модели.

## Consequences

Немедленный старт становится известным approximate temporal evidence, а
не audit createdAt, задним числом объявленным временем тренировки. При
существенной задержке обработки может остаться разница больше 15 минут;
связь тогда не объявляется доказанной. Эта граница видна в provenance.
Модель должна выполнить capture/correction; тесты prompts не доказывают
поведение живого клиента. Проверка реального опубликованного каталога после
доставки обязательна. Historical факты не исправляются автоматически.

## Verification

- Published schema: все common fields и set measurements видимы; прежние
  legal payloads допустимы, original schema не мутируется, output unchanged.
- MCP handler: explicit start, startReportedNow/in_progress/empty exercises,
  fixed clock/timezone rollover, contradictory modes, foreign provenance,
  end-only/local_date, invalid measured sets и excessive numeric precision.
- Isolated PostgreSQL: same-key retry при другом clock возвращает один
  первоначальный start; completion сохраняет его в current/history; поздний
  provider import и обратный порядок дают один existing-policy auto-link;
  другая дата, дальнее время, неоднозначность и explicit occupancy не обходятся.
- API typecheck/build/lint, frozen compatibility, independent Quality и
  Architecture Review; affected canonical Wiki после acceptance, docs validator.
- Commit/push/deploy, connector refresh и live Personal writes отдельно.

## Related material

- [Incomplete fact capture](20261002-capture-incomplete-facts-and-use-contextual-coach-replies.md).
- [Recording context matching](20260925-link-garmin-strength-with-recording-context.md).
- [Training API](../wiki/api/training.md).
- [TASK-0165 plan](../../plans/2026/10/completed/2026-10-07-task-0165-workout-start-capture.md).
