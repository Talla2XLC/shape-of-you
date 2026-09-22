# TASK-0127 — Конкретный следующий шаг из TrainingProgram cadence

## Статус

Завершено локально и принято Quality Review 2026-09-22. Commit, push,
release-candidate publication, staging promotion, runtime program write и
миграции вне изолированных тестов не разрешены.

## Пользовательский результат

Daily Assessment возвращает конкретное, объяснимое действие по активной
программе с учётом плавающего A/B sequence, лёгкого кардио, реально выполненных
занятий и восстановления. Coach не угадывает расписание и не считает одно
физическое занятие дважды.

## Архитектура

Решение закреплено в ADR
`20260922-own-rolling-training-cadence-and-next-step-in-training`.

- typed cadence принадлежит immutable `TrainingProgramVersion`;
- Training вычисляет `NextTrainingStep` из current facts;
- Coaching применяет существующую Recovery/safety precedence;
- weekdays не фиксируются, пропуски не двигают sequence;
- external summary не становится детальной session;
- объединение evidence возможно только по explicit link;
- legacy program без cadence остаётся `schedule_unavailable`.

## Реализация

1. Расширить contracts typed `rolling_weekly` cadence, next-step projection и
   optional workout classification/correlation полями.
2. Добавить additive relational cadence tables и WorkoutSession links, не
   используя JSON/JSONB.
3. Сохранять и гидратировать cadence во всех create/version/confirmed-save
   paths, сохранив старые inputs и immutable versions.
4. Реализовать pure Training evaluator для A/B sequence, weekly targets,
   light-cardio evidence, misses, repeats, reorder, ambiguity и current-day
   completion.
5. Добавить Training service projection и передать её в DailyAssessment facts.
6. Передать typed projection в DailyAssessment facts и сформировать из него
   конкретное действие для program workout, light cardio, completed state или
   classification question; сохранить Recovery dominance и legacy fallback.
7. Добавить unit, repository/integration, migration и MCP regression tests.
8. Провести Developer checks, независимый Quality Review и Architecture Review.
9. После Quality acceptance обновить только затронутые canonical English Wiki
   pages и переместить план в `completed/`.

## Не входит

- изменение Garmin/Intervals.icu import;
- parsing program `note` или activity names;
- fixed weekdays и автоматическое «догоняние» недельной цели;
- универсальный `TrainingOccurrence` aggregate;
- новый service, queue, scheduler, LLM, generic rules, dependency или env;
- live successor программы, commit, push, promotion или внешняя migration.

## Приёмка

1. Typed cadence выражает подтверждённый rolling A/B и два light-cardio без
   weekdays.
2. API возвращает конкретный Training next step либо точную причину
   `schedule_unavailable`/`needs_classification`.
3. Miss не двигает rotation; repeat/reorder объясняются и anchor следующий шаг.
4. External cardio может подтвердить cardio без fabricated WorkoutSession.
5. External strength без program workout identity не выбирает A/B.
6. Explicitly linked WorkoutSession и external activity считаются один раз;
   возможное, но не доказанное совпадение не суммируется.
7. DailyAssessment использует Training projection, а Recovery hard stop
   остаётся доминирующим.
8. Legacy inputs/versions читаются, immutable versions и Person isolation
   сохранены.
9. Никакого runtime data write или import change не происходит.

## Проверки

- contracts/API typecheck и lint;
- pure Training and DailyAssessment unit tests;
- focused PostgreSQL Training integration tests;
- migration clean/idempotent/every-prefix и 63-byte identifier guard;
- API build и full relevant suites;
- `node scripts/validate-docs.mjs`, `git diff --check`, `4dt-board validate`;
- независимые Quality Review и Architecture Review.

## Результат

- создан additive relational cadence и отдельная lifecycle-safe correlation
  association без изменения immutable `WorkoutSession`;
- `TrainingContext` возвращает versioned `NextTrainingStep`, а
  `DailyAssessment` использует его после Recovery precedence;
- cadence сохраняется при confirmed save, semantic no-op и создании progression
  successor version;
- Garmin/Intervals.icu import не изменён;
- прошли 257 unit tests, 5 Training PostgreSQL tests и 19 migration-chain tests;
- live migration, runtime program write, commit, push, release candidate,
  staging promotion и smoke verification не выполнялись.
