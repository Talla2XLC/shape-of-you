---
id: "decisions-20260923-classify-imported-strength-activity-against-training-program"
kind: adr
title: "Сохранять пользовательскую классификацию импортированной силовой отдельно от WorkoutSession"
status: accepted
date: 2026-09-23
supersedes: []
superseded_by: null
tags:
  - architecture
  - training
  - coaching
  - integrations
  - mcp
---

# Сохранять пользовательскую классификацию импортированной силовой отдельно от WorkoutSession

## Context

TASK-0127 добавила typed cadence и Training-owned `NextTrainingStep`, а
TASK-0128 материализовала cadence действующей программы после естественного
согласия. После этого API корректно перестал угадывать A/B: импортированная
силовая хранится как `ExternalActivitySummary`, не содержит упражнений и
подходов и не связана с конкретной позицией workout в active
`TrainingProgramVersion`.

`evaluateNextTrainingStep` может продолжить sequence только по факту с exact
program version и workout position. Сейчас такую identity несёт только
детальная `WorkoutSession`. Существующая связь external activity с
`WorkoutSession` предназначена для дедупликации двух представлений одного
физического события и требует реальной сессии. Создавать пустую или
синтетическую `WorkoutSession` ради A/B нельзя: это выдумало бы детальный факт,
которого импорт не содержит, и затронуло бы personal records, progression,
baseline и correction semantics.

Пользователь при этом может уже прямо сказать, что импортированная силовая была
конкретной тренировкой программы. Если такого высказывания нет, достаточно
одного короткого вопроса. Ответ должен стать типизированным Training fact,
переживать provider correction той же активности, поддерживать явное
исправление и немедленно менять новый `DailyAssessment`.

`integration_activity_facts` неизменяемы: provider correction создаёт successor
с новым id и сохраняет stable correction lineage. Поэтому ссылка только на
текущий fact id потеряла бы смысл после следующей синхронизации. Встраивать
пользовательскую классификацию в provider fact также нельзя, поскольку у этих
сведений разные authority и lifecycle.

## Decision

1. Training получает отдельный Person-owned append-only факт
   `ExternalActivityProgramClassification`. Он не является `WorkoutSession` и
   не добавляет выполненные упражнения, sets, weight, repetitions, RIR или
   progression evidence.
2. Классификация связывает stable root correction lineage одной external
   activity, exact текущий activity fact, увиденный при записи, и exact active
   `TrainingProgramVersion`.
3. Значение классификации является закрытым union:
   `program_workout(workoutPosition)` или `not_program_workout`.
   Отрицательное значение прекращает повторный вопрос, но не продвигает
   cadence и не считается завершённым program workout.
4. Новая классификация создаётся append-only. Повтор идентичного ответа
   возвращает semantic no-op. Изменение ответа создаёт successor с optimistic
   expectation текущей classification; скрытая перезапись запрещена.
5. Узкая Training command принимает expected current external activity id,
   expected active program id/version id/lock version, expected current
   classification id или `null` и выбранное union-значение.
6. Команда выполняется под существующей Person lock. Она перечитывает current
   activity и её lineage, exact active program authority и текущую
   classification, проверяет pending `needs_classification` для initial write,
   валидирует workout position relationally и только затем создаёт факт.
7. Stale activity, program, version, lock или classification завершаются typed
   conflict без записи. Similar activity, совпадение даты, название, порядок
   A/B, program note или предполагаемые упражнения не дают authority.
8. Если external activity уже явно связана с реальной `WorkoutSession`, session
   остаётся главным detailed evidence. Отдельная classification не создаётся и
   событие не считается дважды.
9. Repository проецирует current classification на current successor той же
   activity lineage. Provider correction не требует автоматического копирования
   пользовательского факта. Disconnect/erasure удаляет classification через
   relational cascade вместе с activity lineage.
10. `program_workout` для exact active version становится одним strength
    occurrence для weekly count и rolling-sequence anchor. Порядок определяется
    typed `occurredAt`. Classification для другой program version не переносится
    автоматически и не продвигает текущую cadence.
11. Public Training projection показывает current classification достаточно
    полно для read-back и correction, но не раскрывает provider identity,
    connection, checksum или raw payload. `needs_classification` возвращает
    workout options и один короткий сформированный API вопрос.
12. Coach использует уже сказанное пользователем только когда exact activity и
    exact workout названы прямо и однозначно. Он не выводит A/B из ожидаемого
    порядка, activity name, note, времени или сходства упражнений. При нехватке
    данных Coach задаёт ровно один вопрос, например: «Силовая 21 сентября —
    Ahilej A, Ahilej B или не по этой программе?»
13. После `created`, `corrected` или `unchanged` Coach в том же ходе перечитывает
    `TrainingContext`, затем вызывает `get_daily_assessment`. Только новый
    API-owned `DailyAssessment` определяет видимый следующий шаг.
14. Classification revisions входят в Person evidence-revision guard
    `DailyAssessment`. Изменение между read и persist заставляет assessment
    повторить расчёт. Его used-facts checksum продолжает включать
    `trainingNextStep`.
15. Текущий runtime вычисляет `training-next-step-v2`. Контракты чтения
    сохраняют совместимость с уже сохранёнными assessment snapshots, которые
    содержат `training-next-step-v1`; исторические snapshots не переписываются.
16. Решение остаётся внутри существующего modular monolith и PostgreSQL. Новый
    deployable service, database, queue, scheduler, generic mutation gateway,
    dependency или environment variable не создаётся.

## Considered alternatives

### Создать минимальный или синтетический WorkoutSession

Позволило бы повторно использовать существующую A/B identity, но создало бы
несуществующие detailed execution facts и исказило бы downstream projections.
Отклонено.

### Добавить program fields в integration_activity_facts или парсить name

Смешивает provider evidence и user authority, нарушает immutable correction
lifecycle и возвращает inference из свободного текста. Отклонено.

### Хранить одну изменяемую mapping-строку для current activity id

Минимально по schema, но provider correction меняет current fact id, а
исправление пользователя стало бы скрытой перезаписью. Отклонено.

### Создать универсальный TrainingOccurrence

Мог бы унифицировать manual и connected evidence, но потребовал бы нового
lifecycle, backfill, correction и erasure policy для всех тренировочных фактов.
Для текущего дефекта такая сложность преждевременна. Отложено.

### Append-only classification по stable activity lineage

Сохраняет границу агрегатов, явную user authority, correction history,
provider correction и privacy erasure при минимальном расширении Training.
Выбрано.

## Consequences

- Один естественный ответ A/B немедленно становится authoritative Training fact.
- Если ответ уже однозначно присутствует в разговоре, дополнительный вопрос не
  нужен; иначе задаётся один короткий вопрос.
- Импортированная сводка остаётся сводкой и не приобретает выдуманную
  детализацию `WorkoutSession`.
- Появляются additive relational migration, strict contracts и один узкий MCP
  write action с существующим `workout:write` scope.
- Provider correction и пользовательская correction остаются независимыми
  append-only цепочками.
- Смена active program version намеренно не переносит старую A/B identity без
  нового explicit authority.
- После публикации action требуется отдельная проверка и refresh approved
  ChatGPT action snapshot согласно operational evidence TASK-0129.

## Verification

- Domain tests проверяют A/B anchor, negative classification, sequence,
  weekly count, old-version isolation и отсутствие exercise/set evidence.
- PostgreSQL tests проверяют Person isolation, lineage resolution, FK workout
  validation, idempotent no-op, append-only correction, stale conflicts,
  linked-session precedence, provider successor и disconnect erasure.
- MCP tests проверяют уже сказанные A/B ответы, один короткий вопрос,
  неоднозначность, отсутствие inference и обязательные same-turn reads.
- DailyAssessment tests проверяют evidence-revision retry, новый checksum и
  concrete next action после классификации.
- Contract tests проверяют `training-next-step-v2` и чтение исторических v1
  snapshots.
- Migration verification включает clean, idempotent, every-prefix upgrade и
  статический лимит PostgreSQL identifiers в 63 UTF-8 bytes.
- Full relevant lint, typecheck, build, unit/integration suites,
  documentation validation, independent Quality Review и Architecture Review
  проходят до завершения задачи.

## Related material

- [Training-owned rolling cadence](20260922-own-rolling-training-cadence-and-next-step-in-training.md)
- [Connected activity summaries](20260913-expose-connected-activity-summaries-in-training-context.md)
- [Atomic cadence materialization](20260923-materialize-confirmed-training-program-cadence-atomically.md)
- [Training API](../wiki/api/training.md)
- [Training and Performance](../wiki/domain/training-and-performance.md)
- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
- TASK-0130
