---
id: import-complete-useful-garmin-personal-data
kind: adr
title: "Импортировать доступные полезные данные Garmin без искусственных пробелов"
status: accepted
date: 2026-11-20
supersedes: []
superseded_by: null
tags:
  - architecture
  - integrations
  - recovery
  - training
---

# Импортировать доступные полезные данные Garmin без искусственных пробелов

## Context

Оператор изначально требовал получать все полезные данные, предоставляемые
Personal API. Частичный importer был ошибочно представлен как ограничение API,
а переход сопровождался waiver для ещё не исследованных полей. Оператор
отклонил такой результат и разрешил разовый перенос своего единственного
аккаунта без нового мастера сайта. Перенос не выполнен; Intervals работает.

Read-only проверка 28 официальных GET paths и дополнительных recent-day reads
подтвердила HRV, `sleepScores.overall.value`, стадии сна, минимальный ночной SpO₂,
stress, energy, производителя и Garmin activity load. У двух недавних activity
`trainingStressScore` пуст, а `activityTrainingLoad` заполнен. ZIP с правильным
Accept успешно декодируется. Body Battery report содержит заполненные
timestamp/level columns с millisecond timestamps. Вес, питание, VO₂max,
hydration history и wellness snapshots в проверенных ответах пусты;
это не доказательство отсутствия методов или будущих данных.

## Decision

Оператор явно утвердил ADR и план TASK-0182 2026-11-21 ответом «го»
на представленный полный scoped implementation и последующий разовый перенос.

Расширить существующий importer и типизированные модели текущего API. Новых
сервисов, UI управления переносами и универсального raw data warehouse нет.
Отсутствие mapping не считается API gap. Реальные отсутствующие значения
остаются отсутствующими; условные zeros, guessed units и fabricated timestamps
не создаются. Все новые факты имеют Person/provider/connection/consent/source
ownership, correction/idempotency и journal-backed erasure.

### Recovery

Использовать существующие observations и их typed details:

- `hrv_rmssd`: `hrvSummary.lastNightAvg` либо соответствующий daily summary,
  overnight RMSSD в ms по официальной HRV semantics; не weekly average/5-min high.
- `sleep_score`: только проверенный `sleepScores.overall.value`, score 0–100.
- Существующие sleep `deepSleepMinutes`, `lightSleepMinutes`, `remSleepMinutes`
  из seconds; `minimum_oxygen_saturation` — только из sleep lowestSpO₂.
- Добавить optional sleep detail: awake minutes, sleep need/baseline minutes,
  next-day need/baseline minutes и явно provider-reported breathing-disruption
  qualifier. Optional `sleepKind: main_sleep | nap` явно отличает отдельные
  naps; legacy observation без поля считается основным сном. Naps — отдельные
  sleep observations при реальных start/end;
  не прибавлять их автоматически к основному ночному сну.
- Stress average/max и длительности rest/low/medium/high/activity/uncategorized —
  отдельные metric keys с units score/minute, а не subjective stress 1–5.
- Body Battery daily latest/min/max сохраняют прежнюю day semantics. Отдельный
  `body_battery` instant fact создаётся из последней реальной валидной строки
  time series. Internal fact keys разделяют point и daily snapshot. Consumer
  выбирает point при наличии, иначе day snapshot; не выдаёт fetch time за sample.
- Charged/drained — отдельные накопленные day metrics, не уровень 0–100.
  Дневные respiration/SpO₂ не заменяют ночные значения: у них отдельные keys.

### Training

Дополнить существующий immutable external activity fact optional typed fields:
`trainingStressScore`, `providerExerciseLoad` с basis
`garmin_activity_training_load_v1`, aerobic/anaerobic effect, calories kcal,
average/normalized/maximum power W, intensity factor и Body Battery delta.
Не переименовывать `activityTrainingLoad` в Intervals relative stress или EPOC
без соответствующего отдельного доказанного смысла/units. Старый
`trainingLoad/relative_training_stress` сохраняется как историческая серия;
разные basis автоматически не складываются и не сравниваются.

Производитель файла — из подтверждённого manufacturer. Модель устройства —
только из фактической device/FIT metadata, без вывода модели из manufacturer.
FIT records/laps/sessions не дублировать из JSON; расширить typed session
summary полями standard FIT там, где они реально присутствуют. Source direct
Garmin должен сохраняться как direct Garmin, не `intervals_icu_original_fit`.

Новая сущность `ConnectedDailyFitnessSummary` принадлежит Training:
Person, localDate/timezone, connection/consent/source identity, version/
supersedes/withdrawal; optional resting/active/total expenditure kcal, movement
distance m, floors up/down, moderate/vigorous minutes; provider fitness-age
estimate/achievable estimate years с source as-of и computed provenance;
VO₂max generic/cycling/rowing в mL/kg/min при подтверждённом DTO. Goals и
chronological age не превращаются в измерения. Day summaries не суммируются
повторно с activity calories; это отдельные представления расхода энергии.

### Physical State

Weight DTO импортируется в существующий `WeightMeasurement`: фактический kg
и timestamp, provider identity и явные nullable integration connection/consent
ownership fields. Не делить на 1000 по привычке неофициального endpoint.

Новая сущность `BodyCompositionObservation`: Person, measuredAt/time precision,
optional linked WeightMeasurement, body-fat %, body-water %, muscle/bone mass
kg, BMI, source identity/connection/consent, version/supersedes/withdrawal.
Создаётся только из реального DTO; отсутствие массы не создаёт фиктивный weight.
Названные %/kg — canonical target units. Для каждого source field conversion
сначала подтверждается официальным unit contract/metadata; unit веса не
распространяется автоматически на muscle/bone fields. Неподтверждённый unit
не угадывается и остаётся явно blocked mapping, а не «данных в API нет».
Сантиметровые body measurements не переиспользуются для процентов или kg.

### Nutrition

Новая сущность `ConnectedNutritionDay`: Person, localDate/timezone, immutable
source identity/connection/consent и correction chain; optional consumed kcal,
protein/fat/carbohydrate g и consumed fluid ml. Intake и expenditure различаются.
Пустые logs и один goal не доказывают измеренный intake 0. External totals
возвращаются отдельно от Meal totals и автоматически к ним не прибавляются.
Meal не создаётся без реальных стабильных record IDs и пригодной детализации.
Garmin goals не меняют утверждённые цели пользователя.

### Общие правила

- Day/range/chart endpoints — представления одних данных, а не 28 import jobs.
- Документированный DTO определяет единицы: например, detail calories kcal
  нельзя молча брать из одноимённого list field, описанного как kJ.
- Производные рекомендации Garmin хранят source/as-of и не объявляются
  собственными решениями Coach или медицинским диагнозом.
- Только необходимые health/fitness facts. Профильные форматы, social metadata,
  фотографии, пользовательские заметки и координаты не складываются в архив
  «ради полноты». Periodic-health без данных не создаёт новых фактов/псевдонулей.
- Новые repositories применяют существующие Person locks, consent generation,
  import-policy bounds и erasure barriers. Erasure удаляет все новые owned facts
  и их derived references до удаления connection; manual facts не затрагиваются.
- Сначала compatible implementation, isolated checks, independent acceptance и
  staging delivery. Затем отдельный разовый operational перенос без UI:
  сохранить старые IDs/links, явно разрулить overlap текущего дня, sealed policy
  proof до активации. Регулярный future-day wizard этим решением не расширяется.

### Identity, endpoint merge и доступ к данным

- DailyFitness и Nutrition имеют logical key `(Person, provider, localDate)`;
  immutable successors связаны `supersedesId`. Один normalization bundle сначала
  собирает complete результат согласованных endpoints, затем атомарно публикует
  successor с checksum. Повторный bundle подтверждает receipt, не создаёт копию.
- У каждой группы полей один primary source: v2 daily summary для energy/movement
  и consumed hydration; sleep/HRV — их typed endpoints; maxmet — VO₂max;
  fitnessage — provider fitness-age; nutrition logs — intake/macros. Duplicate
  chart/day routes используются как проверяемый fallback, не второй producer.
  Отсутствующий/failed endpoint не обнуляет и не withdraws группу другого endpoint.
  Явное удаление подтверждается только authoritative complete ответом этой группы.
- Hydration из двух views не складывается; food intake не суммируется с Meal
  ledger. Public reads показывают оба источника отдельно с provenance/as-of.
- Ownership всех day wellness/food/energy/fitness snapshots определяется их
  provider localDate относительно `D`. Actual weight/body composition instant
  получает date через snapshot timezone cutover policy, затем тот же `D` guard;
  `T0` относится только к activity и её children. Fitness-age snapshot date
  отличается от `computedAt`: старый provider as-of не превращается в новое
  физическое измерение, его stale state виден consumer.
- Integration consent generation явно разрешает Recovery/Training/Physical State/
  Nutrition import с правдивым purpose. Добавить immutable typed
  `integrationImportScopes` к existing consent record; legacy integrations получают
  только существующие Recovery/Training scopes. Каждый новый writer проверяет
  свой scope, точные Person/connection/generation, active consent, bounds и erasure
  под Person lock. Один только Recovery `metric` kind не даёт Nutrition/weight
  permissions. Для нового Garmin подключения одно согласие перечисляет категории;
  нового мастера/набора toggles нет. Разовый operator transfer использует явно
  утверждённую область собственного аккаунта, не расширяет legacy source consent.
- Recovery виден в существующих observation/current Recovery reads; новые activity
  поля и DailyFitness — в Training context v1/v2 и external activity detail;
  Nutrition external day — отдельно в Daily Projection/Daily Decision Context;
  body composition — typed Physical State read и readonly MCP tool. Новые схемы
  входят в OpenAPI/MCP и стандартные output validation tests. Это data contracts,
  не новые страницы/карточки управления. Импорт без доступного consumer не готов.

## Considered alternatives

- **Дополнить typed domains (принято).** Больше небольших schema/mapper
  изменений, зато данные действительно доступны системе и не теряют semantics.
- **Попросить принять gaps текущего importer.** Не выполняет запрос оператора:
  данные реально присутствуют в API. Отклонено.
- **Raw JSON archive или passthrough к Coach.** Теряет typed contracts, units,
  ownership/erasure и контроль персональных данных. Отклонено.
- **Новый data service или новый мастер переноса.** Не нужен единственному
  аккаунту и добавляет эксплуатационную сложность. Отклонено.

## Consequences

HRV/score/stages/minSpO₂ используют существующие модели. Новые полезные категории
имеют явных владельцев и small typed entities вместо одного cross-domain blob.
Цена — additive API-owned migrations/contracts и полный erasure test matrix.
Переход нельзя назвать выполненным до фактического импорта и проверки истории.

## Verification

- Official contracts + metadata-only live audit; реальные значения не входят
  в fixtures, ADR, планы, логи или отчёты.
- Synthetic tests: null/missing/zero, invalid units/ranges, timezone/DST,
  source identity, correction idempotency, point-vs-day Body Battery и basis.
- PostgreSQL ownership/consent/erasure/late-worker tests; identifiers ≤63 bytes.
- Independent Quality/Architecture Review, API/MCP schemas и staging smoke.
- Before/after ручного переноса: старые IDs и links сохранены, нет двойных
  актуальных дневных facts и повторно импортированных старых activities.

## Related material

- [План TASK-0182](../../plans/2026/11/completed/2026-11-20-task-0182-garmin-complete-data-and-manual-switch.md)
- [Текущий cutover ADR](20261120-switch-intervals-to-garmin-with-date-boundary.md)
- [Текущие mappings](20261120-garmin-observed-wellness-mapping.md)
- [Official Swagger](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
- [Official client](https://github.com/garmin/connect-personal-api-python)
- [Garmin HRV](https://www.garmin.com/en-GB/garmin-technology/health-science/hrv-status/)

### Подтверждение единиц sleep need

Metadata-only проверка официального `dailySleepSummariesByDate` 2026-11-21:
в 14 из 14 ответов `sleepNeed.baseline` совпал с явно минутным
`sleepAlignment.sleepNeedBaselineMins`; current/next `actual` присутствовали
в тех же 14 ответах. Для `actual` и `nextSleepNeed` minute mapping — вывод
из одинакового DTO и подтверждённого baseline, а не явно указанная unit annotation;
все значения проходят диапазон 0–1440. Raw payload и значения не сохранялись.
Для body composition в текущей OpenAPI единицы массы muscle/bone и шкала
bodyFat/bodyWater не подтверждены: эти поля остаются null до отдельного
подтверждения wire units; BMI и явно документированный kg weight импортируются.

### Разовые cross-connection corrections и erasure

При разовом переносе сохраняется нормальная same-Person correction chain:
сегодняшний Garmin successor может ссылаться на сохранённый Intervals root.
Erasure удаляемого connection обязан сначала отвязать surviving same-Person
successors от удаляемых roots, как уже требуется для weight corrections.
Если удаляется Garmin successor, сохранённые account ancestors получают
существующий `withdrawn_at` tombstone: удаление новой версии не должно снова
сделать старое исправленное значение текущим. Значения, IDs и provenance
retained истории не переписываются. Операция ограничена same-Person цепочкой,
idempotent; unrelated manual facts не затрагиваются.

Альтернатива — заранее withdraw Intervals перед созданием pending policy —
создаёт промежуток без current facts и усложняет rollback при отказе durable
proof. Выбран erasure-only tombstone через существующую модель: он сохраняет
обычные correction chains и не добавляет сущностей или миграционных сервисов.
Оба порядка erasure проверяются на изолированном PostgreSQL до live transfer.
