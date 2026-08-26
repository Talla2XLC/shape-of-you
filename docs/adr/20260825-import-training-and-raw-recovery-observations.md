---
id: "decisions-20260825-import-training-and-raw-recovery-observations"
kind: adr
title: "Импортировать Training и сырые Recovery-наблюдения через единый Fitness Tracker importer"
status: accepted
date: 2026-08-25
supersedes: []
superseded_by: null
tags:
  - "training"
  - "recovery"
  - "garmin"
  - "data-migration"
  - "google-sheets"
  - "mcp"
---

# Импортировать Training и сырые Recovery-наблюдения через единый Fitness Tracker importer

## Context

Google Sheets `Fitness Tracker` остаётся источником истины до отдельного
cutover. Живой ChatGPT-проект пишет operational data только в Sheets; direct
dual-write запрещён. Общий importer уже поддерживает Weight, Body и Nutrition,
но ещё не переносит Training и сырые Garmin/Recovery observations.

Лист `Training` содержит 39 строк, объединённых в 9 стабильных `Session_ID`.
Большинство строк описывает силовые упражнения, но две строки пробежек содержат
дистанцию и длительность вместо повторов. Одна строка приёма пищи ошибочно
попала в Training и не имеет `Exercise_ID`. Текущий `PerformedSet` требует
`reps` и поэтому не может честно представить пробежку.

Отдельного Garmin-листа нет. Сырые наблюдения находятся в typed columns
`Daily_Log`: sleep duration и stages, HRV, resting/night heart rate, average и
minimum SpO2, temperature deviation, respiration rate и Body Battery. Поля
readiness, AI, recovery status и лист `Load_Risk` являются производными
оценками, а не сырыми observation facts.

До cutover ChatGPT должен получить MCP write/read coverage для используемых
Training и Recovery fact types. Реальный database apply, writer switch и
authority transfer не входят в это решение.

## Decision

### Один importer с двумя domain adapters

Расширить существующую команду `import-fitness-tracker` доменами `training` и
`recovery`. Каждый adapter использует тот же bounded read-only source,
immutable snapshot, safe report и результаты
`created|unchanged|conflict|invalid`. Dry-run не получает writer port. Apply
реализуется транзакционно и идемпотентно, но его выполнение требует отдельного
операторского разрешения.

Training snapshot читает только `Training`. `Program` и `Personal Records`
остаются планом и производными проекциями; importer не копирует их как факты.
Recovery snapshot читает только известные raw columns `Daily_Log`. Readiness,
AI, `Recovery_Status`, `Next_Workout`, progression и `Load_Risk` исключены.

### Training identity, exercise mapping и cardio evidence

WorkoutSession identity — exact workbook, numeric sheet id и `Session_ID`.
Строки внутри session сохраняют исходный `Exercise_ID`, locator и checksum.
Повторный `Session_ID` с тем же normalized content является `unchanged`, а с
другим content — `conflict`; existing факт не перезаписывается.

Source `Exercise_ID` отображается на private Training exercise/version через
отдельную typed relational mapping table. Имя создаётся только из фактического
`Exercise` source cell. Отсутствующий или противоречивый ID даёт локальный
`invalid/conflict`, а не name-based guessing.

`PerformedSet` получает nullable `reps`, `durationSeconds` и `distanceMeters`.
Минимум одно значение обязательно. Силовые строки заполняют reps; timed holds
заполняют duration; run rows заполняют duration и distance. Направленные
значения вроде `10/нога` сохраняют числовую работу и source notation в typed
import evidence; количество сторон не домысливается. Случайная meal row в
Training остаётся `invalid` и не создаёт WorkoutSession.

### Typed Recovery observations

Recovery identity — exact workbook, `Daily_Log` sheet id, local date и metric
kind. Sleep сохраняется одной observation с total и nullable stage minutes.
Остальные известные Garmin values сохраняются отдельными typed metric
observations: HRV, resting/night heart rate, average/minimum SpO2, temperature
deviation, respiration rate и Body Battery.

Источник observation — `google_sheets`, `externalSystem = garmin-via-fitness-tracker`.
Поскольку importer читает workbook, а не Garmin API, `connectionId` и
`consentId` остаются `null`; фиктивное device consent не создаётся. Narrative,
пустое или вне допустимого диапазона значение классифицируется `invalid` и не
заменяется synthetic value.

### MCP writer coverage

Добавить `list_recovery_observations` под `person:read` и
`record_recovery_observation` под новым scope `recovery:write`. Predefined
ChatGPT client получает этот scope через release-managed manifest. Existing
`record_workout_session` принимает расширенный typed set contract. MCP пишет
только в Shape of You после отдельно спроектированного cutover; наличие tools
само по себе не меняет текущий writer workflow.

## Considered alternatives

- **Отдельные Training и Garmin scripts:** отклонено, потому что это создаёт
  одноразовые lifecycle, audit и credential paths вместо общего importer.
- **Считать runs invalid:** отклонено, потому что это оставляет используемый
  writer fact type без migration и MCP coverage перед cutover.
- **Создать отдельный Cardio service/entity:** отклонено как преждевременная
  граница; duration/distance являются естественной typed evidence выполненного
  exercise внутри WorkoutSession.
- **Кодировать duration/distance в reps или note:** отклонено как потеря
  семантики и выдумывание значений.
- **Импортировать Program, PR, readiness и Load_Risk:** отклонено, потому что
  это mutable/derived projections, а не исходные immutable facts.
- **Пометить Sheets observations как direct device ingestion:** отклонено;
  importer не владеет Garmin connection/consent и обязан отражать реальный путь.
- **Хранить source rows или Garmin payload в JSON:** отклонено; известная
  структура моделируется реляционными колонками и enum.

## Consequences

- Training и Recovery используют одну команду, credential path, safe reporting
  и import batch lifecycle с существующими доменами.
- Training contract становится пригоден для силовой, timed и distance work без
  нового deployable boundary.
- Recovery schema расширяется известными metric enum и sleep-stage columns;
  неизвестные source values остаются invalid.
- Predefined ChatGPT OAuth policy получает новый granular write scope; после
  deployment connector потребуется выдать его через обычный consent flow.
- Реальный apply, recurring dual-run, cutover, switch point, rollback execution
  и Google Sheets writes остаются отдельными явно разрешаемыми операциями.

## Verification

- Unit tests покрывают grouping, parsing, invalid rows, metric mapping,
  checksums и four-outcome classification.
- PostgreSQL integration tests покрывают transactional apply, exercise mapping,
  typed cardio/recovery persistence, retry idempotency, conflict и Person
  isolation.
- Contract/API/MCP/Identity tests покрывают новые fields, tools и OAuth scope.
- Migration suite проверяет clean/every-prefix upgrade, constraints и лимит
  PostgreSQL identifiers 63 UTF-8 bytes.
- Exact workbook используется только для bounded read-only dry-run; apply и
  cutover выполняются только после отдельного разрешения.

## Related material

- [Pull import and exclusive writer cutover](20260821-use-pull-based-sheets-import-and-exclusive-writer-cutover.md)
- [Relational import batches](20260821-use-relational-import-batches-and-explicit-weight-temporal-precision.md)
- [Training domain](20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
- [Recovery domain](20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md)
- [TASK-0052 plan](../../plans/2026/08/completed/2026-08-25-task-0052-training-and-recovery-import.md)
