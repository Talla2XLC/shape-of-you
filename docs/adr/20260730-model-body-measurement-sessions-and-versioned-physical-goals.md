---
id: "decisions-20260730-model-body-measurement-sessions-and-versioned-physical-goals"
kind: adr
title: "Сеансы замеров тела и версионируемые физические цели"
status: accepted
date: 2026-07-30
supersedes: []
superseded_by: null
tags:
  - "body-measurements"
  - "goals"
  - "physical-state"
  - "reconciliation"
---

# Сеансы замеров тела и версионируемые физические цели

## Контекст

Лист `Body` исходного workbook хранит одну строку сеанса с общей датой,
`Measurement_ID`, source, фотографией и заметкой, а также значениями талии,
груди, бёдер, бедра и бицепса. Простая широкая таблица сохранила бы форму
Google Sheets, но потребовала бы менять schema для каждого нового показателя.
Независимые факты по одному показателю потеряли бы общую provenance и
атомарность correction одного сеанса.

Текущая цель в `Settings` состоит из текстового intent и динамического target
weight. Она не является точным численным target и не имеет истории версий.
Будущая модель должна поддерживать направленные, диапазонные и точные criteria,
не превращая пользовательский intent в жёстко заданную policy.

Вес записан одновременно в `Weight` и `Daily_Log.Weight`. Read-only проверка
доступной истории показала, что все заполненные пары совпадают, а даты без веса
в `Daily_Log` остаются пустыми. Это соответствует денормализованному зеркалу,
а не двум независимым измерениям.

## Решение

### Weight authority и reconciliation

- `Weight` является authoritative журналом веса для будущей миграции.
- `Daily_Log.Weight` является legacy projection и reconciliation evidence.
- Import создаёт `WeightMeasurement` только из `Weight`.
- Совпадающее значение в `Daily_Log` подтверждает parity, но не создаёт второй
  fact и не добавляет вторую domain identity.
- Отсутствующее или отличающееся значение создаёт migration/reconciliation
  finding и не разрешается через last-write-wins.
- Несколько настоящих измерений одного `Person` за локальный день допустимы.
  Уникальность по `local_date` не вводится.

### BodyMeasurementSession

Один исходный сеанс является aggregate `BodyMeasurementSession`:

- root хранит UUID, `person_id`, `measured_at`, derived `local_date`, IANA
  timezone, typed source reference, dedupe identity, nullable confidence,
  nullable media reference, nullable note и append-only correction metadata;
- дочерние `BodyMeasurementValue` хранят controlled metric kind, точное numeric
  value и canonical unit;
- в одном сеансе может быть не более одного current value каждого metric kind;
- первая controlled vocabulary содержит `waist`, `chest`, `hips`, `thigh` и
  `biceps`; расширение выполняется явным domain/schema change;
- все текущие окружности хранятся в сантиметрах; floating point не используется;
- correction заменяет весь immutable session новым session с `supersedes_id`.
  Неизменившиеся значения копируются явно, поэтому история одного исходного
  измерительного события остаётся цельной;
- фотография является nullable ссылкой на private media metadata. Binary content
  не хранится в PostgreSQL и не входит в текущий implementation scope.

### PhysicalGoal

Цель моделируется как versioned plan, а не как measurement:

- `PhysicalGoal` задаёт stable identity, owner `Person` и lifecycle;
- immutable `PhysicalGoalVersion` хранит version number, intent/title,
  optional effective/target dates и structured criteria;
- `PhysicalGoalCriterion` задаёт controlled metric, direction или target mode,
  optional exact/range values и canonical unit;
- narrative intent разрешён без численного criterion. Это необходимо для
  текущей цели со снижением процента жира, сохранением мышечной массы и
  динамически пересматриваемым весом;
- новая редакция создаёт draft version; activation атомарно переключает current
  version. Историческая версия не изменяется;
- completion и cancellation относятся к lifecycle goal root, а не переписывают
  measurements или historical versions;
- current goals и progress являются query projections над goal versions и
  physical facts. Отдельная authority-таблица current state не создаётся.
- PostgreSQL enum с legacy-именем `weight_measurement_source` переименовывается
  в `source_channel`: он уже принадлежит shared provenance и используется
  weight, body sessions и goal versions. Состав значений не меняется.

## Рассмотренные альтернативы

- Широкая `body_measurements` с nullable колонками каждого показателя:
  хорошо повторяет текущий лист, но связывает развитие metric catalog с
  постоянными schema migrations и усложняет общие goal criteria.
- Независимый fact на каждый показатель: удобно строить trends, но теряется
  атомарная provenance строки `Body`, общей фотографии и correction.
- Универсальная `measurements` или `facts` с JSONB payload: расширяется быстро,
  но ослабляет constraints, типизацию и module ownership. Противоречит
  принятому ADR о typed facts.
- Mutable goal settings: проще текущего workbook, но уничтожает историю intent,
  criteria и решений, принятых по старой цели.
- Обязательный точный target для каждой цели: упрощает progress percentage, но
  искажает текущий динамический и многокритериальный intent.

## Последствия

- Body persistence использует две связанные таблицы внутри одного aggregate и
  одной transaction boundary.
- Correction сеанса требует передать полный replacement snapshot.
- Metric vocabulary и допустимые units контролируются domain и database
  constraints, а не произвольными строками клиента.
- Goals допускают как объяснимый narrative intent, так и типизированные criteria
  без универсального rules engine.
- Reconciliation `Weight`/`Daily_Log` относится к migration tooling и не
  усложняет runtime `WeightMeasurement`.
- Rename PostgreSQL enum не меняет stored values или публичный API, но убирает
  misleading database name до появления новых module-owned tables.
- Media upload, real-data import, dual-run и cutover остаются отдельными
  задачами.

## Проверка

- Integration tests создают сеанс с несколькими values одной transaction.
- Database запрещает повтор одного metric kind внутри session и invalid units.
- Correction сохраняет исходный session и полную supersession history.
- Goal activation сохраняет предыдущую immutable version и атомарно меняет
  current version.
- Directional goal без численного target является валидным.
- Synthetic reconciliation подтверждает совпадающие журналы и блокирует
  расхождение без создания второго weight fact.

## Связанные материалы

- [WeightMeasurement](../wiki/domain/weight-measurement.md)
- [Кандидаты в агрегаты](../wiki/domain/candidate-aggregates.md)
- [Source of truth и authority](../wiki/data/source-of-truth-and-authority.md)
- [Typed provenance и supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [План Physical State and Goals](../../plans/2026/07/completed/2026-07-30-physical-state-measurements-and-goals.md)
