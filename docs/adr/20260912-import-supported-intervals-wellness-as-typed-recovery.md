---
id: import-supported-intervals-wellness-as-typed-recovery
kind: adr
title: "Импортировать поддерживаемые Intervals wellness-показатели как типизированные Recovery-наблюдения"
status: accepted
date: 2026-09-12
supersedes: []
superseded_by: null
tags:
  - architecture
  - integrations
  - recovery
  - intervals-icu
---

# Импортировать поддерживаемые Intervals wellness-показатели как типизированные Recovery-наблюдения

## Context

Shape of You уже подключает аккаунт Intervals.icu по OAuth и через существующий
API worker получает активности и wellness-записи. Текущий adapter нормализует
`sleepSecs`, `sleepScore`, `restingHR` и `hrv`, но игнорирует доступные в
официальном Intervals API `avgSleepingHR`, `spO2` и `respiration`. Для Body
Battery adapter ожидает несуществующее стандартное поле `bodyBattery`, тогда как
Intervals.icu импортирует Garmin Body Battery в пользовательские wellness-поля
с кодами `BodyBatteryMin` и `BodyBatteryMax`.

Пользовательский результат — перестать регулярно пересылать скриншоты Garmin
для данных, которые уже дошли до Intervals.icu. Это не означает обещание
получить любой экран Garmin: Intervals.icu может передать только реализованные у
него Garmin wellness-поля. В частности, официальный Intervals API содержит
стандартное поле `respiration`, но обсуждение Garmin sync в июне 2026 года всё
ещё указывает, что ночная respiration из Garmin не импортируется. `spO2` у
Garmin-интеграции Intervals исторически заполняется из Health Snapshot и может
отсутствовать несмотря на ночные показания в Garmin Connect. Официального
Intervals-контракта для Garmin skin-temperature deviation не найдено.

Recovery уже хранит provider-neutral typed observations, поддерживает
correction/supersession, connection-scoped deduplication, consent attribution и
fail-closed erasure. Транспортная модель Intervals не должна стать доменной
моделью и не должна сохраняться как произвольный raw JSON.

## Decision

1. Сохранить Intervals.icu adapter внутри существующего API и существующего
   worker. Новый сервис, deployable boundary или универсальная очередь не
   создаются.
2. Расширить `ProviderWellnessRecord` только явными provider-neutral полями:
   total sleep, sleep score, resting heart rate, average sleeping heart rate,
   HRV RMSSD, oxygen saturation, respiration rate, Body Battery daily minimum
   и daily maximum.
3. Intervals transport должен запрашивать ограниченный whitelist через
   официальный `fields` query parameter: `id`, `updated`, `sleepSecs`,
   `sleepScore`, `restingHR`, `avgSleepingHR`, `hrv`, `spO2`, `respiration`,
   `BodyBatteryMin`, `BodyBatteryMax`. Неизвестные поля не проходят дальше
   adapter boundary.
4. Нормализовать значения в существующие Recovery semantics:
   `sleepSecs` -> sleep duration, `sleepScore` -> `sleep_score`, `restingHR` ->
   `resting_heart_rate`, `avgSleepingHR` -> `night_heart_rate`, `hrv` ->
   `hrv_rmssd`, `spO2` -> `oxygen_saturation`, `respiration` ->
   `respiration_rate`.
5. Добавить две отдельные Recovery metrics: `body_battery_min` и
   `body_battery_max`, обе со шкалой `score` 0..100. Существующую
   `body_battery` сохранить для точечного показания, полученного из другого
   подтверждённого источника. Не выдавать min или max за обобщённый current
   Body Battery.
6. Все новые факты используют существующую схему отдельного fact key,
   normalized checksum, inbox dedupe, correction/withdrawal и connection/
   consent attribution. Повторный rolling или historical fetch должен быть
   no-op; изменённое provider value создаёт типизированное исправление;
   исчезнувшее поле отзывается существующим withdrawal lifecycle.
7. Ошибка или неизвестное значение одного provider record отклоняет этот record
   как `provider_response_invalid`, не удаляет ранее принятые данные и не ломает
   публичный API. Credentials, токены и raw response не логируются.
8. Обычный rolling sync и явный `Import historical data…` используют один и тот
   же normalization/import path. Disconnect прекращает новые импорты, а
   `Delete imported data…` использует существующий fail-closed journal erasure.
9. Coverage UI из TASK-0107 должна показывать фактическое наличие и свежесть
   provider-neutral метрик, а не обещать поддержку по одному лишь наличию поля
   в Garmin Connect.
10. Sleep stages, overnight SpO2 minimum, Garmin readiness/stress semantics,
    skin temperature и ночная respiration не моделируются по догадке. Они могут
    быть добавлены отдельным решением после появления документированного поля
    Intervals и проверяемого payload fixture.

## Considered alternatives

### Оставить текущий adapter и продолжать принимать скриншоты

Отклонено: доступные API-поля теряются, профиль остаётся неполным, а ручной ввод
дублирует уже выполненную Garmin -> Intervals синхронизацию.

### Хранить произвольную map custom wellness-полей или raw JSON

Отклонено: provider-specific transport проникнет в Recovery domain, смысл и
единицы будут неявными, а downstream coaching начнёт зависеть от случайных
пользовательских кодов.

### Записать только `BodyBatteryMax` или среднее как `body_battery`

Отклонено: это необратимо теряет minimum и выдаёт дневной экстремум либо
вычисленное значение за текущий Body Battery. Два явных доменных показателя
сохраняют исходную семантику Intervals.

### Создать один bounded range detail с minimum и maximum

Не выбран: новый вид observation detail потребует больше изменений в public
contract, persistence и consumers. Две scalar metrics естественно ложатся в
существующую модель, позволяют независимо исправлять/отзывать поля и не требуют
новой таблицы detail.

### Читать Garmin Connect напрямую неофициальной библиотекой

Отклонено текущим scope: потребовало бы пароль пользователя или reverse-
engineered API, создало бы хрупкую и неофициальную security boundary и нарушило
бы принятое решение использовать OAuth Intervals.icu.

## Consequences

- Для доступных Intervals данных скриншоты перестают быть обычным способом
  ввода; после один раз настроенного Garmin wellness sync и исторической
  загрузки факты поступают автоматически.
- Body Battery требует создать в Intervals.icu custom wellness fields с точными
  кодами `BodyBatteryMin` и `BodyBatteryMax`, включить Garmin wellness download
  и повторно запросить old data для истории.
- Добавление `body_battery_min` и `body_battery_max` меняет Recovery contract и
  PostgreSQL enum/check constraint. Migration можно создать только после
  одобрения implementation plan, а применять — только по отдельному
  operational approval.
- `spO2` и `respiration` будут импортированы, если Intervals реально вернёт
  значения, независимо от исходного устройства. Это не гарантирует, что Garmin
  заполняет их для конкретной модели часов и режима измерения.
- Нельзя честно гарантировать полное совпадение с каждым Garmin экраном через
  посредника. Недоступные поля должны отображаться как coverage gap, а не
  заполняться из предположений.

## Verification

- Contract tests фиксируют новые Recovery metrics, единицы и диапазоны.
- Provider tests фиксируют точный `fields` whitelist и отсутствие credentials в
  URL, ошибках и логах.
- Normalizer fixtures покрывают полный, частичный, null, boundary и invalid
  payload, включая `BodyBatteryMin`/`BodyBatteryMax`.
- Service/repository integration tests доказывают create, duplicate no-op,
  correction, withdrawal, disconnect/consent fencing и erasure attribution для
  каждой новой метрики.
- Fake provider проверяет одинаковое поведение rolling и explicit historical
  import без настоящего Garmin/Intervals аккаунта.
- Full API checks, migration-chain/idempotency test, PostgreSQL 63-byte
  identifier guard, docs validation и независимые Quality/Architecture Review
  выполняются до завершения TASK-0110.

## Related material

- [ADR: Connect Garmin through Intervals.icu](./20260907-connect-garmin-through-intervals-icu.md)
- [ADR: Import Intervals history only on user request](./20260911-import-intervals-history-only-on-user-request.md)
- [Intervals.icu API documentation](https://intervals.icu/api-docs.html)
- [Intervals.icu API Integration Cookbook](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090)
- [Intervals.icu Body Battery support](https://forum.intervals.icu/t/solved-hrv-tracking-via-garmin-body-battery/36154)
- [Intervals.icu Garmin Health Snapshot support](https://forum.intervals.icu/t/garmin-health-snapshots-supported/9150)
- [Intervals.icu Garmin respiration request](https://forum.intervals.icu/t/respiratory-rate-from-garmin-health-snapshot-avg-during-sleep/119477)
- TASK-0107
- TASK-0110
