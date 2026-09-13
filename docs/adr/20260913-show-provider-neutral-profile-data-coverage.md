---
id: "decisions-20260913-show-provider-neutral-profile-data-coverage"
kind: adr
title: "Показывать provider-neutral покрытие профиля и готовность данных по направлениям"
status: accepted
date: 2026-09-13
supersedes: []
superseded_by: null
tags:
  - architecture
  - progress
  - coverage
  - recommendations
  - timezones
---

# Показывать provider-neutral покрытие профиля и готовность данных по направлениям

## Context

Страница `/progress` показывает factual trends и текущую daily projection, но
не объясняет, насколько глубока и регулярна история Person и достаточно ли
конкретного вида evidence для рекомендаций. Connection status и число
импортированных provider records не решают эту задачу: одни и те же typed facts
могут прийти из Garmin через Intervals.icu, ручного ввода или будущей интеграции.

Один общий score скрывает разные пробелы, создаёт ложную точность и может быть
воспринят как процент здоровья или обещание медицинского качества. Простые
счётчики покрытия объективны, но заставляют пользователя самостоятельно
интерпретировать разные cadence сна, тренировок и веса.

Актуальная архитектура не имеет `DayClosure`. Текущий Person-local день ещё
может пополняться, а отсутствие факта не доказывает отсутствие события. Для
Nutrition наличие complete nutrient snapshot не доказывает, что записан весь
дневной рацион.

## Decision

1. Добавить на `/progress` отдельный provider-neutral блок готовности данных для
   семи направлений: sleep, HRV, resting heart rate, Body Battery, training,
   weight и nutrition.
2. Публиковать отдельный bounded application read contract
   `GET /v1/progress-data-coverage?localDate=YYYY-MM-DD&timezone=Area%2FCity`.
   `localDate` задаёт рассматриваемый Person-local текущий день, а valid IANA
   `timezone` фиксирует его контекст.
3. Для каждого направления возвращать первую и последнюю дату current evidence,
   freshness, recorded и usable coverage за 28 и 90 полностью прошедших дней,
   количество существенных пробелов, самый длинный пробел и объяснимый статус
   `sparse`, `partial` или `good` с typed reason codes.
4. Текущий `localDate` может участвовать в freshness и historical bounds, но не
   входит в 28/90 regularity denominators. Future facts относительно
   `localDate` не учитываются.
5. Current evidence исключает superseded и withdrawn facts. Source, provider,
   connection и import record count не влияют на coverage или status.
6. Sleep использует typed sleep observations; HRV — `hrv_rmssd`; resting heart
   rate — `resting_heart_rate`. `poor` Recovery observations считаются recorded,
   но не usable.
7. Body Battery считает usable day при наличии provider-neutral
   `body_battery` observation либо полной пары `body_battery_min` и
   `body_battery_max`. Одиночный minimum/maximum остаётся recorded, но partial.
8. Training объединяет current `WorkoutSession` и current
   `ExternalActivityFact` по local date. Один день считается один раз; система
   не утверждает, что разные facts описывают разные физические события, и не
   считает дни отдыха пропущенными тренировками.
9. Weight использует current `WeightMeasurement`. Его readiness оценивается по
   недельной cadence, а не по ежедневному denominator.
10. Nutrition считает recorded day при наличии current `Meal` и usable day,
    только когда все записанные Meal имеют complete nutrient totals. Даже
    `good` означает пригодность записанных Meal для pattern context, а не
    доказанную полноту всего дневного рациона.
11. Версия policy — `profile-data-coverage-v1`. Для daily evidence `good`
    требует не менее 21 usable day из 28 и freshness не более двух дней;
    `partial` — не менее семи usable days и freshness не более семи дней.
    Weight и Training используют недельную cadence: `good` требует evidence в
    трёх из четырёх последних недель и freshness не более десяти дней;
    `partial` допускает ограниченный недавний или 90-day context. Остальные
    случаи — `sparse`.
12. Существенный gap начинается с трёх consecutive unusable days для daily
    evidence и с пятнадцати дней для Weight/Training. Формулировка в UI всегда
    говорит об отсутствии записанных или usable данных, а не о пропущенном
    поведении пользователя.
13. Coordinator остаётся внутри существующего API и вызывает постоянное число
    module-owned aggregate reads. Новая table, cache, materialized aggregate,
    database, credential, service или deployable не создаются. История не
    загружается и не hydrate-ится по одному факту.
14. Connections остаётся единственным местом управления import lifecycle.
    Progress показывает только результат — Person-owned typed evidence — и не
    публикует provider counters или connection controls.
15. Статусы описывают data sufficiency для wellness/coaching context. Они не
    являются health score, диагнозом, медицинским выводом или гарантией качества
    рекомендации.

## Considered alternatives

### Показывать только статистику покрытия

Сохраняет максимальную объективность, но пользователь вынужден самостоятельно
интерпретировать одинаковые числа для принципиально разных cadence. Не выбрано.

### Вычислять один общий readiness score

Даёт компактный headline, но скрывает отсутствующие направления, создаёт ложную
точность и конфликтует с безопасной product language. Отклонено.

### Показывать coverage и readiness отдельно по направлениям

Требует versioned policy и большего UI, но сохраняет объяснимость, показывает
конкретные пробелы и не смешивает provider transport с доменной семантикой.
Выбрано.

### Расширить существующий progress overview response

Уменьшает число HTTP calls, но повторно вычисляет неизменный 28/90 coverage при
каждом переключении chart period и связывает две разные read semantics.
Отклонено в пользу отдельного bounded endpoint в том же application module.

### Хранить coverage snapshots или общий профильный aggregate

Может ускорить чтение, но создаёт freshness, correction, erasure и ownership
проблемы без измеренной необходимости. Отклонено.

## Consequences

- Пользователь видит, какие направления уже пригодны для recommendation context
  и какие конкретно данные стоит продолжить записывать.
- Недавняя регулярность и глубина истории остаются отдельными наблюдаемыми
  фактами; 90-day history не маскирует stale recent data.
- Новый additive public contract и policy требуют contract, API, repository,
  browser и accessibility tests.
- Training получает module-owned coverage read, который учитывает manual и
  imported activities без provider leakage.
- Для production-like density могут потребоваться purpose-built
  `(person_id, local_date)` indexes. Их создание допускается только как bounded
  index migration после проверки query plans; применение migration остаётся
  отдельной operational approval.

## Verification

- Contract tests фиксируют семь направлений, policy version, nullable bounds,
  28/90 windows, gap summary, statuses и reason codes.
- Unit pin tests проверяют все policy boundaries, текущий незавершённый день,
  timezone/local-date arithmetic и empty state.
- PostgreSQL tests доказывают Person isolation, current-only corrections,
  withdrawals, Recovery quality, Body Battery pair, incomplete Nutrition и
  Training union без provider dependence.
- Repository spies или query assertions доказывают постоянное число bounded
  reads и отсутствие per-day/public-HTTP fan-out.
- Web tests проверяют доступный блок, plain-language explanation, independent
  loading/error state и отсутствие import controls или health-score language.
- Migration identifiers, если migration понадобится, проверяются на лимит
  PostgreSQL 63 UTF-8 bytes.

## Related material

- [Progress overview authenticated default](./20260818-make-progress-overview-the-authenticated-default.md)
- [Independent facts over DayRecord](./20260728-prefer-independent-facts-over-broad-day-record.md)
- [Capture-first Coach and DayClosure removal](./20260829-remove-day-closure-and-use-capture-first-coach.md)
- [Typed Recovery observations](./20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md)
- [Typed Intervals wellness import](./20260912-import-supported-intervals-wellness-as-typed-recovery.md)
- [Connected activity summaries](./20260913-expose-connected-activity-summaries-in-training-context.md)
- [Progress overview API](../wiki/api/progress-overview.md)
- TASK-0107
