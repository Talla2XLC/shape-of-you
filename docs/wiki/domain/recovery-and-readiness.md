---
id: "domain-recovery-and-readiness"
kind: domain
title: "Recovery and Readiness"
status: draft
tags:
  - "domain"
  - "privacy"
  - "recovery"
  - "readiness"
---

# Recovery and Readiness

## Кратко

Контекст реализован в API и разделяет общие определения устройств,
персональные наблюдения и воспроизводимые оценки готовности. Реальные данные
устройств по-прежнему запрещены до появления аутентифицированного удаления.

## Содержание

- Общие поставщики, модели устройств и возможности версионируются без
  копирования для каждого `Person`.
- Подключение, экземпляр устройства, согласие, состояние хранения и
  наблюдения принадлежат `Person`.
- Неизменяемое наблюдение содержит происхождение, UTC-интервал, IANA timezone,
  локальную дату, качество, идемпотентность и полную цепочку исправлений.
- Типизированные детали разделяют сеанс сна, числовой показатель и
  субъективную отметку; произвольный JSON не заменяет доменные поля.
- Источник устройства требует действующего согласия. Отзыв запрещает новые
  данные, а удаление остаётся отдельным privacy lifecycle.
- Оценки готовности и риска нагрузки закрепляются за версией правил и явными
  evidence references. Недостаток данных ограничивает confidence, а hard stop
  имеет приоритет над score.
- Recovery публикует оценку состояния. Coaching формирует отдельную
  рекомендацию и не переписывает наблюдения, оценки или программу тренировок.

### Реализованный контракт API

- Подключения и согласия доступны через `/v1/recovery/connections` и
  `/v1/recovery/consents`; общие определения моделей устройств регистрируются
  только внутренним доверенным контуром и не содержат credentials.
- `/v1/recovery/observations` поддерживает создание, текущий список, чтение,
  историю и полную correction для сна, HRV RMSSD, resting heart rate и
  субъективной отметки.
- `/v1/recovery/assessments` явно создаёт и читает неизменяемые оценки,
  закреплённые за точной policy version, окном, evidence checksum и snapshot
  расчёта.
- Тренировочные свидетельства читаются без изменения Training. Количество
  подходов с внешним весом, весом тела и поддержкой остаётся раздельными
  компонентами расчёта.
- Параллельный повтор команды защищён person-scoped идемпотентностью, а
  superseded observations исключаются из текущих списков и новых оценок.

## Основания

- Контракты `AI_Insights` и `Load_Risk` в authoritative workbook.
- [Каталог поведения Google Sheets](../data/google-sheets-behavior-catalog.md).
- [Владение данными](../architecture/data-ownership.md).

## Решения

- [ADR о наблюдениях и оценках восстановления](../../adr/20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md).
- [ADR о shared reference data](../../adr/20260731-separate-shared-reference-definitions-from-person-owned-state.md).
- [ADR о provenance и supersession](../../adr/20260730-use-typed-provenance-and-append-only-supersession.md).

## Открытые вопросы

- Конкретные версии продуктовых правил, веса компонентов и пороги до
  production activation.
- Сроки хранения для каждого вида данных и аутентифицированный протокол
  физического удаления.
- Конкретный provider adapter, credentials boundary и правила синхронизации.

## Связанные материалы

- [Bounded contexts](bounded-contexts.md)
- [Кандидаты в агрегаты](candidate-aggregates.md)
- [Provenance и identifiers](../data/provenance-and-identifiers.md)
- [Завершённый план реализации](../../../plans/2026/07/completed/2026-07-31-recovery-and-readiness.md)
