# TASK-0121 — Автоматическое определение выполнения ежедневных рекомендаций

Статус: выполнен; независимый Quality Review и Architecture Review приняты,
canonical Wiki синхронизирована после отдельного разрешения оператора.

## Статус и разрешение

Гибридная архитектура одобрена оператором командой «го» 2026-09-21 и
зафиксирована в
[ADR](../../../../docs/adr/20260921-determine-daily-recommendation-completion-from-domain-facts.md).

Implementation plan и post-acceptance Wiki writes отдельно одобрены оператором
и выполнены. Migration запускалась только в изолированных test databases.
Commit, push, deploy, применение migration к общей локальной, staging или
production базе, доступ к персональным данным, secrets и ручные серверные
операции этим планом не разрешались и не выполнялись.

## Пользовательский результат

Пользователь перестаёт регулярно сообщать «я выполнил рекомендацию», если это
уже положительно подтверждают собственные факты Shape of You. Например,
записанный вес, Meal, точная программная тренировка или достигнутый step
threshold могут автоматически подтвердить соответствующий критерий.

Если источник неполон, устарел, неоднозначен или действие субъективно, система
показывает partial/unknown и не делает отрицательный вывод. Ручной feedback
остаётся для пропуска, субъективной тяжести, пригодности, боли,
неподтверждаемых действий и исправлений.

## Выбранная модель

- `daily-assessment-v4` сохраняет одно primary action и добавляет closed typed
  completion criteria.
- Authoring default — один атомарный required criterion. Ограниченный `all_of`
  используется только для неделимого составного действия; supporting criterion
  не доказывает completion самостоятельно.
- Completion имеет независимые поля:
  `completionState = completed | partially_completed | not_completed | unknown`
  и
  `evidenceMode = observed | self_reported | partially_observed | unknown`.
- Automatic v1 никогда не создаёт `not_completed`; отсутствие записи означает
  `unknown`.
- Coaching лениво создаёт immutable
  `DailyRecommendationCompletionAssessment` для точного `snapshotId`, policy и
  evidence checksum.
- Owner modules определяют freshness/completeness и публикуют bounded typed
  evidence. Coaching не создаёт owning-domain facts.
- Provenance сохраняет exact fact IDs, окно, as-of, полноту, свежесть, причины,
  limitations и criterion result.
- Feedback correction является append-only supersession; old evidence не
  переписывается.
- Актуальный explicit `completed`/`skipped` имеет user-facing precedence, но
  конфликт с observed facts сохраняется и объясняется.
- Нет LLM evaluation/self-learning, generic rules engine, нового сервиса,
  queue, scheduler, dependency, env или ручной серверной операции.

## Затронутые области

- `packages/contracts/src/daily-assessment.ts` — V4 action criteria и result
  schema при сохранении V1/V2/V3.
- `packages/contracts/src/daily-recommendation-feedback.ts` — typed correction
  / supersession contract.
- `apps/api/src/domain/` — closed completion criterion/evaluator и checksum.
- `apps/api/src/coaching/` — completion composition, resolution и controller.
- `apps/api/src/storage/` — immutable completion repository, typed evidence
  reads и feedback correction.
- `apps/api/src/database/schema.ts`, `apps/api/drizzle/` — additive enums,
  criteria, assessments, criterion results, typed evidence links и correction
  relations.
- Weight, Nutrition, Training, Recovery/Integration module read interfaces —
  bounded completion evidence без cross-service SQL.
- `apps/api/src/mcp/`, HTTP/OpenAPI — read-only exact-snapshot completion output
  и безопасная presentation policy.
- Contracts, domain, repository, integration, MCP, migration и privacy tests.
- `docs/wiki/` — только после accepted Quality, Architecture Review и отдельного
  разрешения.

## Этапы реализации

1. Добавить V4 strict contracts. `DailyNextActionV4` содержит presentation
   fields и closed typed criteria; старые V1/V2/V3 schemas и hydration остаются
   неизменными.
2. Определить минимальный closed criterion vocabulary для существующих и
   одобренных V4 actions: Weight record, Nutrition record, exact
   TrainingProgram workout/session, Recovery check-in или sleep observation,
   movement threshold и TrainingProgram confirmation. Запретить несовместимые
   action/criterion пары таблицей pure policy tests.
3. Добавить completion policy version и pure evaluator. Он агрегирует required
   criteria через atomic/all-of semantics, учитывает supporting evidence,
   freshness/completeness и не создаёт automatic `not_completed`.
4. Спроектировать typed relational persistence без generic JSON/JSONB:
   recommendation criteria, completion assessments, per-criterion results,
   owner-specific evidence links и exact source metadata. Добавить Person и
   recommendation composite FKs, uniqueness для deterministic reuse и checks
   для допустимых enum/role/state combinations.
5. Создать additive migration. Проверить clean, every-prefix и idempotent
   upgrade, а также статически отклонять PostgreSQL identifiers длиннее 63
   UTF-8 bytes. Migration не применять к shared/staging/production database.
6. Реализовать module-owned bounded evidence reads:
   - Weight — положительный current fact в criterion window;
   - Nutrition — Meal/record evidence и явная completeness;
   - Training — exact `WorkoutSession`/`TrainingProgramVersion`, а external
     activity без точной связи только partial;
   - Recovery/sleep — exact observation, observation window и freshness;
   - movement — partial-day/completed-day role и monotonic positive threshold;
   - TrainingProgram — exact activation/version evidence.
7. Реализовать lazy completion service. Read блокирует/координирует exact
   Person snapshot, собирает typed evidence, вычисляет canonical checksum,
   переиспользует identical assessment или добавляет immutable новый.
8. Добавить append-only feedback correction/supersession. Correction указывает
   точное прежнее событие, сохраняет idempotency и Person ownership; competing
   successors конфликтуют. Existing feedback history остаётся читаемой.
9. Реализовать resolution policy. Active explicit `completed`/`skipped`
   определяет self-reported disposition; automatic evidence определяет
   observed/partially_observed/unknown; конфликт сохраняется reason/limitation,
   не исправляет owner fact и не влияет на DailyAssessment policy.
10. Добавить Person-scoped HTTP и read-only MCP output для exact snapshot
    completion. Не добавлять новый write scope для автоматической оценки;
    существующий feedback scope используется только для manual feedback и
    correction. Ошибка owner read остаётся fail-closed.
11. Добавить regression для DailyAssessment V1/V2/V3, V4 snapshot reuse,
    recommendation checksum separation и неизменности recommendation после
    completion/feedback.
12. Добавить full acceptance tests и выполнить focused/full checks. После
    реализации без промежуточного operator gate передать frozen diff
    независимому Quality.
13. После accepted Quality выполнить Architecture Review: сложность,
    microservice boundaries, DDD/ownership, дублирование источников истины и
    возможность упрощения. Перед canonical Wiki writes остановиться для
    отдельного разрешения.

## Acceptance criteria

1. Для одного exact daily snapshot API возвращает typed `completionState` и
   `evidenceMode` как независимые значения.
2. Fully `observed` completion возможен только когда все required criteria
   положительно подтверждены свежими и достаточно полными owner facts.
3. Частичное, stale, ambiguous или unavailable evidence не становится fully
   observed и объясняется per criterion.
4. Отсутствие любого owning-domain факта никогда не создаёт automatic
   `not_completed`; automatic evaluator первой версии вообще не возвращает это
   состояние.
5. Weight, Nutrition, Training, Recovery/sleep, movement и TrainingProgram
   имеют typed positive-evidence paths и exact provenance.
6. Partial-day steps могут положительно доказать уже достигнутый threshold, но
   не доказывают низкую активность или невыполнение.
7. Несвязанная external activity не доказывает exact programmed workout;
   `WorkoutSession` с нужной `TrainingProgramVersion` может его доказать.
8. Subjective/broad action остаётся self-reported или unknown, если оно не
   преобразовано в typed criteria; presentation text не парсится.
9. V4 содержит одно primary action и closed criteria; incompatible
   action/criterion combinations отклоняются.
10. V1/V2/V3 snapshots остаются readable и неизменными; migration не создаёт
    для них предполагаемые criteria или completion.
11. Identical recommendation, completion policy и evidence checksum
    переиспользуют immutable assessment; correction/withdrawal/new fact или
    freshness/completeness change создают новый current assessment.
12. Completion result хранит policy version, evaluatedAt, exact evidence,
    window/as-of, freshness, completeness, reason и limitation.
13. Explicit current `completed` создаёт `completed/self_reported`, current
    `skipped` — `not_completed/self_reported`; suitability feedback сам по себе
    completion не меняет.
14. Feedback correction является append-only, ссылается на exact event,
    поддерживает idempotent retry и детерминированно отклоняет competing
    successors.
15. Конфликт self-report и observed evidence видим и объясним, но не изменяет
    Weight, Meal, WorkoutSession, RecoveryObservation, sleep, steps,
    TrainingProgram или другой owner fact.
16. Completion/feedback не меняют DailyAssessment inputs, recommendation
    status/action/checksum/baseline/policy и не запускают learning/calibration.
17. Person isolation, privacy erasure/cascade и correction withdrawal
    сохраняются во всех evidence links и assessments.
18. HTTP/MCP output strict, Person-scoped, read-only для автоматической оценки
    и fail-closed при недоступном owner evidence.
19. Нет нового deployable, database, credential, queue, scheduler, dependency,
    одноразового env, manual server operation или cross-service SQL.
20. Relevant/full checks, независимый Quality, Architecture Review и
    post-acceptance documentation gate выполнены до завершения задачи.

## Проверки

- `pnpm --filter @shape-of-you/contracts build`
- `pnpm --filter @shape-of-you/api typecheck`
- focused completion/DailyAssessment/feedback unit tests
- focused PostgreSQL completion/feedback/migration integration tests
- `pnpm --filter @shape-of-you/api test:unit`
- `pnpm --filter @shape-of-you/api test:integration`
- MCP schema/authorization/fail-closed tests
- clean/every-prefix/idempotent migration tests
- PostgreSQL identifier UTF-8 byte-length guard
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm lint`
- `pnpm build`
- `node scripts/validate-docs.mjs`
- `git diff --check`
- `4dt-board validate`
- независимый Quality Review
- Architecture Review

## Риски и ограничения

- V4 contract и relational provenance увеличивают schema и test surface.
  Упрощение достигается closed vocabulary и отсутствием generic rules engine.
- Broad current actions могут часто оставаться unknown. Нельзя компенсировать
  это разбором текста или скрытой эвристикой.
- Source completeness отличается по доменам; единый global TTL запрещён.
- Append-only correction chain сложнее mutable status, но сохраняет audit и не
  скрывает прежние утверждения.
- Lazy evaluation создаётся только при read. Отдельный background materializer
  не входит в scope.
- Automatic completion не является owning-domain execution fact и не должно
  использоваться как замена WorkoutSession, Meal или иной записи.

## Отдельные operator gates

1. одобрение этого implementation plan перед первой правкой кода;
2. post-acceptance canonical Wiki writes;
3. commit;
4. push;
5. migration/deploy на staging;
6. authenticated staging verification;
7. production migration/deploy;
8. любая future calibration, analytics run или self-learning.
