---
id: model-wearable-sleep-score-and-normalize-recovery-mcp-input
kind: adr
title: "Моделировать wearable sleep score отдельно и нормализовать Recovery MCP input"
status: accepted
date: 2026-08-31
supersedes: []
superseded_by: null
tags:
  - architecture
  - recovery
  - mcp
  - garmin
---

# Моделировать wearable sleep score отдельно и нормализовать Recovery MCP input

## Context

Обычный пользовательский отчёт с Garmin screenshot содержит длительность сна,
wearable sleep score, HRV, пульс, дыхание, SpO₂ и отклонение температуры. Live
ChatGPT E2E попытался записать Garmin score `86` в `sleepQuality`, но это поле
имеет субъективную шкалу `1..5`; strict Recovery schema отклонила весь sleep
command. Остальные независимые показатели после этого также не были записаны,
а Coach раскрыл пользователю технический факт сбоя.

Текущий `record_recovery_observation` публикует напрямую внутренний
`CreateRecoveryObservation`: модель обязана формировать nullable ownership,
source provenance, temporal precision и другие service bookkeeping fields.
Meal уже отделяет concise connector input от строгого domain command, а
Recovery остаётся хрупким. Accepted writer-parity ADR требует сохранять один
независимый raw RecoveryObservation за вызов, раскладывать screenshot на typed
facts и безопасно дозаписывать отсутствующий набор после частичного сбоя.

## Decision

Добавить provider-neutral raw metric `sleep_score` в `RecoveryMetric`:

- unit — существующий `score`;
- допустимое значение — `0..100`;
- Garmin score не преобразуется в субъективное `sleepQuality`;
- `SleepObservationDetail.sleepQuality` сохраняет прежнюю nullable шкалу
  `1..5` и семантику.

PostgreSQL enum и metric check расширяются той же typed метрикой. Новая таблица,
database или aggregate не создаются: score хранится в существующем
`recovery_metric_details` как отдельный immutable RecoveryObservation.

На существующей MCP boundary вводится connector-facing Recovery schema и
normalizer. Модель обязана передать только фактические domain details, exact
Person-local date/timezone и deterministic dedupe key. Для прямого сообщения
или screenshot adapter безопасно дополняет:

- `sourceReference.channel = manual` и nullable external fields;
- nullable `connectionId`/`consentId`;
- `quality = reliable`, если client не передал другую evidence quality;
- `temporalPrecision = local_date`, nullable interval и exact `localDate`, когда
  пользователь не сообщил реальный интервал.

Normalized command всегда повторно проверяется строгой domain schema до вызова
Recovery service. Device provenance не выдумывается: screenshot, прочитанный
ChatGPT, остаётся manual report, а `device` требует реальной connection/consent.

Один multimodal report раскладывается на независимые commands: sleep duration,
sleep score и каждую известную raw metric. Ошибка одного command не запрещает
попытку сохранить остальные однозначные facts. После набора writes выполняется
`list_recovery_observations` с `localDate` и сверяется ожидаемый set. Final Coach
reply использует естественный язык и не раскрывает schema, tool, API, transport
или internal status.

## Considered alternatives

- **Отбросить score и записать `sleepQuality = null`.** Минимальный diff, но
  теряет явно сообщённый полезный факт и сохраняет хрупкий strict MCP input.
- **Преобразовать `86` в шкалу `1..5`.** Смешивает wearable algorithm score с
  субъективной оценкой и создаёт недоказанную трансформацию.
- **Добавить Garmin-specific field в SleepObservationDetail.** Привязывает
  domain к одному provider и смешивает interval sleep fact с независимой raw
  metric.
- **Добавить batch Garmin snapshot tool/entity.** Упростило бы один вызов, но
  связало бы независимые facts, усложнило partial retry и расширило accepted MCP
  surface без необходимости.
- **Сохранить raw screenshot или generic JSON.** Создало бы второй источник
  истины и обошло typed domain invariants.

## Consequences

- Wearable score сохраняется без потери и без fabricated conversion.
- Natural text/photo Recovery capture требует меньше служебных arguments, но
  строгая domain validation, Person isolation, provenance, idempotency и
  append-only correction сохраняются.
- Один screenshot по-прежнему может создать несколько независимых writes;
  deterministic dedupe keys и set read-back делают retry безопасным.
- Потребуется additive PostgreSQL enum/check migration и compatibility tests.
- Tool count, OAuth scopes, deployable topology и authority boundaries не
  меняются.

## Verification

- Contract/domain tests различают `sleep_score: 86 score` и
  `sleepQuality: 1..5` и отклоняют неверные scale/unit combinations.
- Migration tests проходят clean install и every committed journal prefix;
  generated identifiers статически не превышают 63 UTF-8 bytes.
- Recovery repository integration test сохраняет и читает `sleep_score`.
- MCP tests принимают concise local-date screenshot facts, проверяют normalized
  strict commands, независимый Garmin set, read-back и natural result content.
- Full API, typecheck, lint, build, docs validation, Quality и Architecture
  Reviews проходят до completion.

## Related material

- [Typed MCP writer parity](20260826-complete-typed-mcp-writer-parity-and-use-executable-cutover-preflight.md)
- [Capture-first Coach](20260829-remove-day-closure-and-use-capture-first-coach.md)
- [Recovery and readiness](../wiki/domain/recovery-and-readiness.md)
