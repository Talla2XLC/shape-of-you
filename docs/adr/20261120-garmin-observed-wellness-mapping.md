---
id: garmin-observed-wellness-mapping
kind: adr
title: "Последний Body Battery и подтверждённые показатели сна Garmin"
status: accepted
date: 2026-11-20
supersedes: []
superseded_by: null
tags:
  - architecture
  - integrations
  - recovery
---

# Последний Body Battery и подтверждённые показатели сна Garmin

## Context

TASK-0180 проверил официальный Garmin Personal API на разрешённом аккаунте
за 2026-11-06–2026-11-19. Безопасный отчёт содержит только поля, типы,
число заполненных записей и HTTP состояния. В 14 daily summaries заполнен
`bodyBattery.latestValue`; он отличается по назначению от `minValue/maxValue`.
В daily sleep заполнены `avgHeartRate`, `averageSpO2Value` и
`averageRespirationValue`. Факт заполнения не подтверждает все свойства
метрики: единицы HRV/RMSSD, точный overall key sleep score и timestamp
последнего Body Battery пока не установлены.

Первый adapter сознательно импортирует только ограниченное подмножество.
Расширение должно сохранять provenance, corrections, отсутствие ложной
точности и совместимость Intervals. Существующая Recovery модель уже имеет
`body_battery`, `night_heart_rate`, `oxygen_saturation`, `respiration_rate`
и точность `local_date`; новая сущность или deployable service не нужны.

## Decision

Оператор утвердил ADR и локальный план TASK-0180 2026-11-20 ответом
«Да, реализуй этот этап». Расширить существующий adapter и общий импорт
следующими отображениями:

| Garmin field | Recovery metric | Правило |
| --- | --- | --- |
| `data[].bodyBattery.latestValue` из `/usersummary-service/v2/dailysummaries` | `body_battery`, `score` | Целое 5–100, последнее известное значение за `calendarDate`; отдельно от min/max |
| `avgHeartRate` из `/sleep-service/sleep/dailySleep` | `night_heart_rate`, `bpm` | Средний пульс за сон; не resting/minimum pulse |
| `averageSpO2Value` из того же sleep record | `oxygen_saturation`, `percent` | Среднее за сон; не daytime latest и не minimum |
| `averageRespirationValue` из того же sleep record | `respiration_rate`, `breaths_per_minute` | Среднее за сон; не daytime latest |

Сопоставление единиц/назначения трёх sleep fields с официальным контрактом
и Garmin descriptions — обязательная проверка до их включения. Если её
результат неоднозначен, поле остаётся `null`, а незавершённый пункт явно
отражается в приёмке. Наличие числового поля само по себе недостаточно.

Все четыре факта имеют `temporalPrecision: local_date`, исходную дату
и timezone аккаунта, `observedFrom/observedUntil: null`. Время fetch,
`wellnessChronology.endTimestampGmt`, timestamp feedback event и начало/конец
сна не выдаются за время измерения Body Battery. UI/Coach должны описывать
его как последнее доступное значение за дату, без утверждения «сейчас»
или «измерено N минут назад». Старый день не становится текущим показателем
из-за позднего импорта. Проверка пользовательских формулировок входит
в acceptance этого расширения.

Во внутренний provider contract добавляется необязательный nullable
`bodyBatteryLatest`; отсутствие поля у Intervals означает отсутствие факта.
Checksum, consent fencing, correction, fact pointers, delivery evidence
и erasure переиспользуются. Повторная синхронизация меняет факт за дату,
не создавая искусственный внутридневной ряд и не изменяя min/max.
Missing значение обрабатывается по существующим правилам provider corrections,
без синтеза нуля или переноса предыдущего дня.

HRV RMSSD, общий sleep score, sleep stages, stress, calories, питание,
вес, VO2 и новые агрегаты не добавляются этим ADR. Их coverage-кандидаты
сохраняются в TASK-0180; дальнейшее расширение требует точного mapping
и отдельного решения по отсутствующим domain contracts. Это не отказ
от разрешённого оператором анализа полезных новых данных.

## Considered alternatives

- **Использовать `latestValue` с `local_date` (предлагается).** Уже подтверждённое
  поле, существующая модель, нет дополнительного API запроса. Timestamp
  измерения неизвестен; интерфейс обязан сохранить это ограничение.
- **Выбирать последнюю точку из `bodyBatteryValuesArray`.** Позволяет точное
  время и внутридневную динамику, но требует проверки descriptor layout,
  единиц timestamp, status/version, неполных рядов и поведения устройств.
  Без этих доказательств сейчас дороже и рискованнее. Не смешивать этот
  будущий контракт с daily snapshot.
- **Показывать min/max как текущий уровень.** Проще, но меняет смысл данных;
  отклонено.
- **Сохранить все ответы как универсальные raw metrics.** Максимальное
  покрытие ценой неявной модели, дублирования authority и расширения хранения
  чувствительных данных; отклонено.

## Consequences

Пользователь получает отдельное последнее дневное значение Body Battery.
Новые таблицы, migrations, services и публичный credential API не нужны.
Изменяются internal adapter/import contract, additive delivery enum
и затронутые consumer labels.
Точное время Body Battery остаётся неизвестным; настоящий live показатель
и внутридневной график этим решением не обещаются.

### Уточнение после Architecture Review — утверждено

Оператор утвердил уточнение 2026-11-20 ответом «Да, продолжай с уточнением».

Проверка текущего кода выявила закрытый публичный delivery enum, в котором
`body_battery` отсутствует. Предлагается добавить этот ключ в
`ConnectedRecoveryMetricKey` и runtime schema. Для него использовать те же
consent-scoped receipt/pointer состояния, что для остальных метрик;
`periodState/asOf` остаются `null`, без ложного timestamp. Это additive
расширение существующего публичного контракта, а не новая сущность/API route.
Intervals явно возвращает `unknown` для неподдерживаемого latest, Garmin
подтверждает отдельные latest и extrema независимо. Whitelist Garmin также
должен включить подтверждённые sleep averages.

Для legacy DailyAssessment предлагается выбирать `bodyBattery` только
из точечных `instant` observations. Дневной latest остаётся в Recovery
и основном контексте Coach с `local_date`; legacy assessment сохраняет
свой прежний fallback на min/max и предупреждение о дневном диапазоне.
Так сохраняется существующий публичный assessment schema и не требуется
выдумывать свежесть. Альтернатива — расширять assessment summary данными
о точности/времени; дороже и затрагивает сохранённые decision contracts,
поэтому для локального этапа не предлагается.

Новые таблицы, migrations и API routes не требуются.

### Совместимость MCP при будущей доставке

Расширение enum увеличивает полный `metricDelivery` с 10 до 11 элементов.
Это не wire-compatible изменение для клиента, закешировавшего прежнюю
закрытую output schema (`maxItems: 10` и прежний enum). MCP SDK может
проверять structured output по такому cache и отклонить успешный ответ.
Версия `connected-recovery-freshness-v2` обозначает неизменённый алгоритм
свежести, а не обещание совместимости старого schema cache.

Локальный этап не доставляет новый ответ работающим клиентам. Перед отдельно
согласованной выкладкой требуется обновление tool discovery/schema подключения
и smoke-вызов current Recovery context с валидацией нового structured output.
До этого delivery нельзя объявлять готовой для существующего MCP клиента.
Не добавлять параллельный versioned tool только ради локальной реализации:
он расширит public surface и потребует отдельного решения. Сохранённые legacy
assessment schemas этим расширением не меняются.

Ключ уже хранится encrypted в обычном connection lifecycle. Повторный ввод
на каждой синхронизации не требуется. Разовые ephemeral diagnostics
не должны становиться пользовательским flow. Истечение/ротация ключа
следуют базовому ADR; ежегодный срок конкретного ключа не является
универсальным default.

## Verification

- Контрактные fixtures: latest отличается от min/max; null/missing,
  границы диапазона, дробное/нечисловое значение, старая дата и corrections.
- Изоляция Intervals: отсутствие нового поля не создаёт `body_battery`.
- Integration: persisted metric, повторная синхронизация, изменение latest,
  receipt/pointer/consent и erasure; отдельно от extrema.
- Consumer review: ни UI, ни Coach не приписывают daily snapshot точное время
  измерения или гарантированную актуальность.
- Unit/typecheck, затронутые integration checks, независимые Quality
  и Architecture Review, docs validator и diff check.
- Live download дал HTTP 200 и ZIP metadata с одним FIT candidate;
  это не доказательство успешного FIT decoding. Проверка реального decoder
  остаётся отдельным критерием, без повторного скрытого чтения credentials.

## Related material

- [Базовое подключение Garmin](20261118-connect-garmin-personal-api.md)
- [Recovery and readiness](../wiki/domain/recovery-and-readiness.md)
- [План TASK-0180](../../plans/2026/11/completed/2026-11-20-task-0180-garmin-observed-wellness.md)
- [Официальный Personal API Swagger](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
- [Garmin: sleep breathing rate and Pulse Ox](https://www.garmin.com/en-US/blog/health/garmin-smartwatches-track-more-sleep-data/)
- [Garmin: respiration rate units](https://support.garmin.com/en-PH/?faq=2yEgS0Pax53UDqUH7q4WC6)
- [Garmin: sleep Pulse Ox averages and saturation percentage](https://support.garmin.com/en-US/?faq=SK2Y9a9aBp5D6n4sXmPBG7)
