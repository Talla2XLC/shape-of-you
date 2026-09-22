---
id: "decisions-20260922-own-rolling-training-cadence-and-next-step-in-training"
kind: adr
title: "Владеть плавающим тренировочным ритмом и следующим шагом в Training"
status: accepted
date: 2026-09-22
supersedes: []
superseded_by: null
tags:
  - architecture
  - training
  - coaching
  - daily-assessment
  - programs
---

# Владеть плавающим тренировочным ритмом и следующим шагом в Training

## Context

Активная `TrainingProgramVersion` хранит упорядоченные силовые workouts и
свободный `note`, но не имеет типизированного ритма. Поэтому
`DailyAssessment` видит active program, однако возвращает
`training_schedule_not_inferred` и общее действие `follow_active_program`.
Coach может назвать конкретную A/B тренировку только собственной догадкой.

Read-back действующей программы «Ahilej A/B + лёгкое кардио» подтвердил, что в
её `note` действительно согласованы три силовые тренировки в неделю с
чередованием A/B/A, затем B/A/B, и два гибко размещаемых лёгких кардио. Но
последняя внешняя силовая активность не содержит варианта A/B:
`ExternalActivitySummary` намеренно не является детальной `WorkoutSession`.
Свободный текст нельзя превращать в runtime policy, а один физический workout
нельзя считать дважды из manual и connected evidence.

## Decision

1. `TrainingProgramVersion` получает optional закрытый typed
   `rolling_weekly` cadence. Старые версии без cadence остаются читаемыми и
   возвращают `schedule_unavailable`; runtime parsing `note` запрещён.
2. Cadence хранит ordered sequence ссылок на позиции immutable program
   workouts, недельную цель силовых сессий и optional typed light-cardio
   prescription: недельную цель, длительность, целевой средний пульс и фазы
   разминки, основной работы и заминки. Дни недели не задаются.
3. Training владеет read-only `NextTrainingStep` projection. Она вычисляется из
   active immutable cadence и current Training facts, а не сохраняется как
   mutable cursor. Пропущенный день не продвигает sequence.
4. `WorkoutSession` может optional точно указать позицию program workout внутри
   закреплённой `TrainingProgramVersion`. Связь валидируется relational FK;
   вариант A/B нельзя выводить из названия внешней активности.
5. Детальная `WorkoutSession` может optional ссылаться на точную current
   external activity как на второе evidence одного физического события. Связь
   хранится typed relationally и не объединяет сами агрегаты.
6. Training объединяет evidence только по явной ссылке. Возможное совпадение по
   дате, времени или названию остаётся неоднозначным и не суммируется как два
   завершённых program steps.
7. Внешняя активность может подтвердить light cardio без создания
   `WorkoutSession`, только если её typed duration, distance и heart-rate facts
   удовлетворяют versioned Training policy. Название активности не разбирается.
8. Не классифицированная внешняя силовая активность учитывается как load и
   occurrence evidence, но не продвигает A/B. Если без её варианта нельзя
   выбрать следующий workout, projection возвращает typed
   `needs_classification` и один короткий человеческий вопрос.
9. Повтор или перестановка явно классифицированного workout считается
   фактически выполненным событием, отмечается reason code и становится
   anchor для следующего шага. API не переписывает историю под ожидаемый
   порядок.
10. Если qualifying training уже выполнен в текущую Person-local дату,
    projection возвращает `complete_today`: дополнительная тренировка в тот же
    день не назначается. Недельная цель не заставляет «догонять» пропуски в
    конкретный weekday.
11. Coaching остаётся владельцем итогового cross-domain daily action. Он
    использует Training projection и может заменить или отложить её только по
    существующей Recovery/safety precedence. Coaching не выбирает другой
    workout и не восстанавливает отсутствующую Training identity.
12. Существующая active version неизменяема. Для действующей программы нужен
    новый явно создаваемый и активируемый semantically equivalent version с
    typed cadence. Это отдельная runtime data-write операция после delivery;
    миграция schema не изменяет пользовательскую программу автоматически.
13. Реализация остаётся в существующем modular monolith и PostgreSQL. Новый
    service, database, queue, scheduler, LLM, generic JSON rules, dependency и
    environment variable не создаются. Garmin/Intervals.icu import не меняется.

## Considered alternatives

### Оставить cadence в `note` и поручить inference Coach

Минимальное изменение, но результат зависит от чата, не версионируется и не
может быть проверен backend. Отклонено.

### Вычислять schedule внутри Coaching

Даёт единый API-ответ, но переносит смысл TrainingProgram, A/B sequence и
correlation Training evidence в чужой bounded context. Не решает отсутствующий
вариант внешней силовой активности. Отклонено.

### Создать универсальный persisted `TrainingOccurrence`

Мог бы объединить все evidence одного физического занятия, но потребовал бы
нового lifecycle для ingest, correction, erasure и исторического backfill.
Отложено до измеримого доказательства, что явных links недостаточно.

### Typed cadence и Training-owned projection с явными evidence links

Сохраняет domain ownership, даёт детерминированный следующий шаг и решает
реальный сценарий без нового агрегата. Выбрано.

## Consequences

- Новые program versions могут давать конкретный strength/cardio/rest step без
  фиксированных weekdays.
- Legacy versions продолжают работать с честным `schedule_unavailable`.
- Появляется additive typed relational schema и новые optional поля публичных
  contracts.
- Неоднозначная историческая силовая сводка может потребовать одного вопроса;
  это намеренный fail-closed результат.
- Текущая staging программа не станет typed автоматически: после delivery её
  successor version требует отдельного разрешения на runtime write.

## Verification

- Contract tests проверяют strict cadence, next-step union и backward
  compatibility старых inputs.
- Pure policy tests проверяют A/B rotation, missed days, repeats, reordering,
  local-week boundaries, current-day completion и ambiguity.
- PostgreSQL tests проверяют cadence hydration, immutable versions, exact
  program-workout FK, Person-scoped external link, corrections и explicit-link
  deduplication.
- DailyAssessment tests проверяют конкретные actions, Recovery precedence,
  checksum changes и legacy fallback.
- Migration tests проверяют clean, idempotent, every-prefix upgrade и лимит
  PostgreSQL identifiers в 63 UTF-8 bytes.
- Full lint, typecheck, build, unit/integration suites, docs validator,
  `git diff --check` и board validation проходят до acceptance.

## Related material

- [Владеть ежедневной оценкой и следующим действием на стороне API](20260914-own-daily-assessment-and-next-action-in-api.md)
- [Показывать Coach сводки подключённых активностей](20260913-expose-connected-activity-summaries-in-training-context.md)
- [Training API](../wiki/api/training.md)
- [Training and Performance](../wiki/domain/training-and-performance.md)

