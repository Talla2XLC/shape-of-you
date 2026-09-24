# TASK-0130 — Классификация импортированной силовой относительно TrainingProgram

## Статус

Завершён 2026-09-24. Архитектура одобрена 2026-09-23 и закреплена в ADR
`20260923-classify-imported-strength-activity-against-training-program`.
Оператор одобрил реализацию 2026-09-23. Реализация и предусмотренные планом
проверки завершены. После исправления initial date-scoped authority и добавления
Drizzle snapshot независимый Quality Review принял все 10 критериев; финальный
Architecture Review завершён без блокеров.

## Пользовательский результат

Если пользователь уже однозначно сказал, что импортированная силовая была
конкретной тренировкой активной программы, Coach сохраняет это без повторного
вопроса. Если identity недостаточна, Coach задаёт один короткий вопрос,
сохраняет ответ через API и в том же ходе возвращает следующий шаг только из
пересчитанного `DailyAssessment`.

При этом не создаётся фиктивная `WorkoutSession`, не появляются выдуманные
упражнения или sets и не используется inference из A/B order, названия
активности или program note.

## Архитектура

- Training владеет append-only `ExternalActivityProgramClassification`.
- Факт связывает stable root activity correction lineage, exact current
  activity fact и exact active `TrainingProgramVersion`.
- Classification является union `program_workout(workoutPosition)` или
  `not_program_workout`.
- Идентичный retry является no-op; изменение ответа создаёт successor.
- Existing Person lock и optimistic expectations защищают от stale writes.
- Реальная linked `WorkoutSession` имеет приоритет и предотвращает двойной
  учёт.
- `training-next-step-v2` использует classified external strength как cadence
  occurrence, но не как detailed exercise evidence.
- Исторические DailyAssessment snapshots с `training-next-step-v1` остаются
  читаемыми.
- После write обязательны `TrainingContext` и новый `DailyAssessment` read-back.

## Реализация

1. Расширить strict contracts:
   - classification DTO и projection;
   - narrow classify/correct command с expected activity, local date, program,
     version, lock и current classification authority;
   - typed outcomes `created`, `corrected`, `unchanged`, `stale` и
     `not_pending` либо эквивалентный закрытый union;
   - `needs_classification` options и короткий API-generated question;
   - backward-compatible v1 read и current `training-next-step-v2` output.
2. Добавить additive PostgreSQL migration и Drizzle schema для append-only
   classification chain:
   - composite Person ownership FKs;
   - lineage-root и exact-fact FKs к `integration_activity_facts`;
   - exact program-version/workout-position FK;
   - supersedes FK и unique no-fork constraint;
   - union shape check и индексы current read;
   - все generated identifiers короче 63 UTF-8 bytes.
3. Реализовать repository lineage resolution и current classification read без
   изменения Garmin/Intervals importer. Provider successor должен наследовать
   projection существующей classification по root lineage, а disconnect
   удалять её relational cascade.
4. Реализовать одну Training transaction под существующей Person lock:
   - перечитать current activity и exact active program authority;
   - проверить expected current classification;
   - для initial write доказать, что activity является current
     `needs_classification` target;
   - отклонить activity, уже связанную с real `WorkoutSession`;
   - relationally проверить workout position;
   - вернуть no-op либо append successor без partial writes.
5. Расширить `TrainingContext` безопасной current-classification projection,
   достаточной для read-back и последующей correction, без provider identity,
   connection, checksum и raw payload.
6. Обновить `evaluateNextTrainingStep`:
   - построить единый ordered strength occurrence stream из exact classified
     sessions и external classifications;
   - сохранить explicit-link deduplication;
   - не считать `not_program_workout` и old-version classification;
   - использовать current external activity id как evidence id;
   - не создавать PR, progression или performed-set evidence.
7. Добавить narrow MCP action с `workout:write`:
   - использовать direct unambiguous user statement об exact pending activity;
   - не infer A/B из order, name, note, времени или exercise similarity;
   - при нехватке identity задать только API-returned question;
   - после success/no-op вызвать `get_training_context`, затем
     `get_daily_assessment` в том же ходе;
   - скрыть tool names, ids и persistence mechanics от пользователя.
8. Включить classification chain в DailyAssessment Person evidence-revision
   guard. Доказать, что изменение classification создаёт fresh assessment
   через существующий used-facts checksum и не создаёт циклическую зависимость
   Training -> Coaching.
9. Добавить validation coverage:
   - contract compatibility и policy versioning;
   - pure domain A/B sequence, negative answer и old-version isolation;
   - PostgreSQL create/no-op/correction/stale/rollback/Person isolation;
   - provider correction lineage и disconnect erasure;
   - linked-session precedence и отсутствие double count;
   - MCP direct answer, natural equivalents, one-question ambiguity,
     stale recovery и mandatory read-back;
   - DailyAssessment recalculation и concurrency retry.
10. Запустить focused и full relevant checks, затем без остановки передать
    implementation независимому Quality Review и выполнить Architecture Review.
11. Только после accepted Quality и отдельного wiki approval обновить affected
    canonical Markdown Wiki pages, добавить ADR links и переместить этот план в
    `plans/2026/09/completed/`.

## Не входит

- synthetic, empty или автоматически созданная `WorkoutSession`;
- parsing provider activity name, program note или conversation prose на API;
- inference из ожидаемой A/B sequence, даты, времени или similarity;
- изменение Garmin/Intervals import payload или provider contracts;
- generic `TrainingOccurrence`, generic patch или cross-domain mutation;
- перенос classification на новую program version без explicit authority;
- новая service/database/queue/scheduler/dependency/env;
- ручное изменение PostgreSQL или live user data;
- commit, push, release-candidate publication, action refresh, promotion или
  deployment без отдельных разрешений.

## Приёмка

1. Уже однозначно названная пользователем A/B identity сохраняется без нового
   вопроса для exact pending activity.
2. При недостатке identity Coach задаёт ровно один короткий API-returned вопрос.
3. Answer сохраняется как append-only Training classification без создания
   `WorkoutSession` или performed details.
4. `program_workout` продвигает exact active cadence; `not_program_workout`
   прекращает повторный вопрос и не продвигает cadence.
5. Идентичный retry не создаёт строку; correction создаёт successor; stale
   expectations не оставляют partial writes.
6. Provider correction сохраняет classification через stable lineage, а
   disconnect/erasure удаляет её.
7. Linked real `WorkoutSession` имеет приоритет, одно событие не учитывается
   дважды.
8. После write новый `TrainingContext` подтверждает classification, а новый
   `DailyAssessment` возвращает concrete next action или следующую typed
   ambiguity. Coach не рассчитывает A/B самостоятельно.
9. Historical v1 assessment snapshots остаются читаемыми; current projection
   маркируется `training-next-step-v2`.
10. TASK-0111/0127/0128 ownership, immutability, privacy и fail-closed guarantees
    остаются действующими.

## Проверки

- `pnpm --filter @shape-of-you/contracts typecheck` и contract tests;
- `pnpm --filter @shape-of-you/api typecheck`;
- `pnpm --filter @shape-of-you/api lint`;
- `pnpm --filter @shape-of-you/api build`;
- focused Training domain/unit tests;
- focused Training PostgreSQL integration tests;
- focused DailyAssessment unit/integration tests;
- focused MCP schema, dispatch и natural-language policy tests;
- clean, idempotent и every-prefix migration verification;
- PostgreSQL identifier 63-byte static guard;
- full relevant API test suites;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- independent Quality Review и Architecture Review.

Фактически пройдено: contracts typecheck/build; API typecheck/lint/build;
36 unit suites с 261 тестом; Training, DailyAssessment, Recovery и migrations
PostgreSQL suites с 53 тестами; clean, idempotent и every-prefix migration
verification; Drizzle no-op generation и journal/snapshot parity; 63-byte
identifier guard; documentation и board validation; `git diff --check`.
Миграция выполнялась только в Testcontainers.

## Approval gate

Реализация в primary working tree была отдельно одобрена оператором 2026-09-23.
Quality Review принят записью `task-0130-quality-acceptance-20260924`, а
Architecture Review завершён без блокеров 2026-09-24. Canonical Wiki обновлена
после отдельного одобрения оператора. Применение миграции, runtime или ручные
записи в БД, action publication/refresh, staging, commit, push, promotion и
deployment не выполнялись и по-прежнему требуют отдельных разрешений.
