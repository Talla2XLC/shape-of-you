---
id: "decisions-20260921-determine-daily-recommendation-completion-from-domain-facts"
kind: adr
title: "Определять выполнение ежедневной рекомендации по доменным фактам"
status: accepted
date: 2026-09-21
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - daily-assessment
  - evidence
  - feedback
  - recommendations
---

# Определять выполнение ежедневной рекомендации по доменным фактам

## Context

API создаёт неизменяемый `DailyAssessment` snapshot как
`CoachingRecommendation(kind = daily_next_action)`. Snapshot фиксирует
Person-local день, версию политики, точное действие, использованные факты,
evidence checksum и объяснение. TASK-0119 добавила append-only
`DailyRecommendationFeedback`, но выполнение по-прежнему известно только после
явного сообщения пользователя.

Для части действий это создаёт лишнее трение. Система уже владеет
типизированными фактами Weight, Nutrition, Training, Recovery, sleep, movement
и connected activities. Например, новый `WeightMeasurement`, Meal или
`WorkoutSession`, связанный с нужной `TrainingProgramVersion`, может
положительно подтвердить атомарное действие без сообщения «я сделал».

При этом отсутствие записи не доказывает невыполнение. Источник может быть
неполным, устаревшим, ещё не закрытым за локальный день или не связанным с
конкретной рекомендацией. Субъективные действия, боль, пригодность, слишком
высокая сложность и пользовательские исправления также нельзя надёжно вывести
из доменных фактов.

Текущий `DailyNextAction` содержит один typed action и presentation text, но
часть формулировок, например `recovery_first`, остаётся составной или слишком
общей для машинной проверки. Разбор текста как контракта сделал бы вывод
неверсионируемым и зависимым от формулировки.

## Decision

1. Использовать гибридную модель. Coaching автоматически оценивает выполнение
   только там, где критерий подтверждается доменными фактами, и сохраняет
   ручной feedback для субъективных оценок, неподтверждаемых действий,
   пропуска и исправлений.
2. Результат разделяет две независимые оси:
   `completionState = completed | partially_completed | not_completed | unknown`
   и
   `evidenceMode = observed | self_reported | partially_observed | unknown`.
   `observed` не является синонимом `completed`, а `unknown` не является
   синонимом невыполнения.
3. В первой версии автоматический evaluator не создаёт `not_completed`.
   Отсутствие Weight, Meal, WorkoutSession, RecoveryObservation, sleep, steps
   или другого факта всегда оставляет критерий `unknown`. `not_completed`
   появляется только из актуального явного `skipped` либо пользовательского
   исправления. Будущее автоматическое отрицательное доказательство требует
   отдельного ADR.
4. Для новых snapshots ввести `daily-assessment-v4`. V4 сохраняет ровно одно
   primary action, но добавляет закрытый типизированный набор completion
   criteria. Authoring policy предпочитает один атомарный required criterion.
   Несколько required criteria с `all_of` допустимы только для действительно
   неделимого составного действия. Supporting criteria не могут самостоятельно
   доказать полное выполнение.
5. Presentation text не является критерием и никогда не разбирается evaluator.
   Free-form criteria, generic rules engine и LLM evaluation запрещены.
6. Каждый criterion фиксирует stable identifier, closed type, owner domain,
   required/supporting role, Person-local observation window, completion
   boundary и typed sufficiency rule. Пороговые значения и ссылки на
   `TrainingProgramVersion` хранятся типизированно, а не в generic JSON/JSONB.
7. Первые typed criterion families покрывают Weight, Nutrition, Training,
   Recovery/sleep и movement. Конкретное действие может использовать только
   критерии, смысл которых соответствует его action type. Например:
   WeightMeasurement или Meal после snapshot положительно подтверждают
   атомарную запись; `WorkoutSession` с точной `TrainingProgramVersion`
   подтверждает соответствующее программное действие; несвязанная external
   activity является только частичным evidence; текущий step count может
   подтвердить уже достигнутый порог, но не доказать низкую активность до
   закрытия дня; sleep подтверждает только явно sleep-oriented criterion.
8. Legacy V1/V2/V3 snapshots остаются неизменяемыми и читаемыми. Их completion
   имеет `self_reported` или `unknown`, если отдельное точное typed mapping не
   доказано без разбора текста. Migration не переписывает старые snapshots и
   не назначает им предполагаемые критерии.
9. Coaching владеет отдельным immutable
   `DailyRecommendationCompletionAssessment`, связанным с точным daily
   recommendation snapshot. Он содержит completion policy version,
   `completionState`, `evidenceMode`, `evaluatedAt`, evidence checksum,
   reason/limitation codes и результаты каждого criterion.
10. Completion assessment материализуется лениво при Person-scoped read.
    Coaching собирает bounded typed evidence через module-owned read
    interfaces, переиспользует assessment для одинаковых recommendation,
    policy и evidence checksum либо добавляет новый. Corrections, withdrawals,
    freshness/completeness changes и новые факты меняют текущий evidence
    identity, не переписывая историю. Eager callbacks, scheduler, queue и новый
    service не создаются.
11. Для каждого criterion assessment хранится provenance: owner domain,
    exact fact identifiers, observation window, source observation/as-of time,
    completeness, freshness, evaluation reason и limitation. Evidence links
    реализуются typed relational tables и foreign keys там, где факт имеет
    устойчивую identity.
12. Freshness и completeness определяет owning module, а не Coaching.
    Partial, stale, ambiguous или unavailable evidence не может дать полностью
    `observed` completion. Положительный факт может быть достаточен до закрытия
    окна только если criterion явно допускает monotonic positive proof,
    например достигнутый step threshold.
13. Coaching не создаёт и не исправляет `WeightMeasurement`, Meal,
    `WorkoutSession`, RecoveryObservation, sleep, steps, TrainingProgram или
    иной owning-domain fact. Completion assessment является выводом о
    рекомендации, а не новым доменным фактом выполнения в owning context.
14. Ручной feedback остаётся отдельным evidence stream. Добавить append-only
    supersession/correction relation: исправление ссылается на точное прежнее
    feedback event, старое событие не изменяется и не удаляется. Concurrent
    competing corrections конфликтуют детерминированно.
15. Актуальный явный `completed` или `skipped` disposition имеет приоритет при
    user-facing resolution и даёт `evidenceMode = self_reported`. Возможный
    конфликт с observed evidence сохраняется и объясняется; он не исправляет
    owning-domain факт автоматически. `accepted`, `too_heavy` и `unsuitable`
    остаются отдельными intent/suitability signals и сами не доказывают
    completion.
16. Completion policy version развивается отдельно от DailyAssessment policy.
    Каждый результат объясним по точной recommendation version, criteria,
    evidence, freshness/completeness и resolution rule. Completion feedback не
    входит в DailyAssessment input, baseline, recommendation checksum или выбор
    следующего action и не запускает self-learning.
17. PostgreSQL остаётся authority. Реализация выполняется в существующем
    modular monolith и не добавляет deployable service, database, credential,
    dependency, queue, scheduler, одноразовый environment variable или ручную
    серверную операцию.

## Considered alternatives

### Оставить только ручной feedback

Это сохраняет ясное намерение и минимальную schema, но заставляет пользователя
регулярно подтверждать действия, уже доказанные собственными фактами системы.
Вариант не достигает продуктовой цели.

### Полностью автоматическое определение

Даёт минимальное трение, но не может надёжно представить субъективное
самочувствие, пригодность, боль, сознательный пропуск, исправления и
неподтверждаемые действия. При неполных источниках оно склонно превращать
отсутствие evidence в ложное невыполнение. Отклонено.

### Гибридная модель

Автоматизирует только доказуемые критерии, сохраняет ручной feedback и делает
неопределённость явной. Выбрано.

### Вычислять completion только на чтении без хранения

Упрощает persistence, но историческое объяснение дрейфует после corrections,
withdrawals и изменения freshness. Нельзя доказать, какой вывод был показан
пользователю. Отклонено в пользу lazy immutable assessments.

### Пересчитывать completion на каждой доменной записи

Сделало бы projection более eager, но связало бы write paths владельцев фактов
с Coaching и потребовало callbacks, events либо scheduler. Для первой версии
это лишняя сложность. Отклонено.

### Принудительно оставить только одно атомарное действие без criteria set

Это простейшая проверяемая модель, но не покрывает легитимные неделимые
действия вроде выполнения точной программной тренировки без прогрессии.
Атомарность остаётся authoring default, а закрытый `all_of` — ограниченным
исключением.

## Consequences

- Новые recommendations получают V4 contract; legacy V1/V2/V3 остаются
  совместимыми.
- Появляются additive typed relational schema, completion policy/evaluator,
  module-owned evidence reads и read-only completion projection.
- Данные могут оставаться `unknown` дольше, чем ожидает пользователь, если
  источник неполон или действие сформулировано непроверяемо. Это намеренная
  цена отсутствия ложных утверждений.
- Broad actions придётся постепенно заменять атомарными actions либо явно
  структурированными criteria; их текст сам по себе не станет исполняемым
  контрактом.
- Manual correction history становится сложнее, но сохраняет исходное
  сообщение, исправление и разрешение конфликта без hidden overwrite.
- Накопленные completion assessments не меняют будущую recommendation policy.
  Любая калибровка или self-learning требует отдельного решения.
- Commit, push, migration execution вне изолированных tests, deployment,
  staging/production access и Wiki writes остаются отдельными operator gates.

## Verification

- Contract tests фиксируют V4 discriminated schema, closed action/criterion
  unions, `completionState`, `evidenceMode` и legacy V1/V2/V3 reads.
- Pure policy matrix проверяет satisfied/partial/unknown, atomic-first/all-of,
  supporting criteria, manual precedence и отсутствие automatic
  `not_completed`.
- Owner evidence tests покрывают Weight, Nutrition, Training, Recovery/sleep,
  steps, linked/unlinked activities, completeness, freshness и monotonic
  positive proof.
- PostgreSQL tests проверяют exact provenance, Person isolation, immutable
  assessment reuse, A-B-A evidence, feedback supersession, concurrency,
  corrections/withdrawals и privacy cascade.
- Timezone/DST и action-window tests проверяют Person-local boundaries.
- MCP/HTTP tests проверяют read-only projection, strict output, authorization,
  fail-closed behavior и отсутствие prompt-side reconstruction.
- Migration verification покрывает clean, every-prefix и idempotent upgrade, а
  static guard — PostgreSQL identifiers не длиннее 63 UTF-8 bytes.
- Выполняются typecheck, lint, build, relevant/full tests, docs validation,
  независимый Quality Review, Architecture Review и отдельный post-acceptance
  Wiki sync.

## Related material

- [API-owned DailyAssessment](./20260914-own-daily-assessment-and-next-action-in-api.md)
- [Typed daily recommendation feedback](./20260918-record-typed-daily-recommendation-feedback.md)
- [Automatic day context and movement](./20260917-automate-day-context-and-use-optional-daily-movement.md)
- [Recovery freshness for Coach](./20260918-expose-connected-recovery-freshness-to-coach.md)
- [TASK-0121 plan](../../plans/2026/09/completed/2026-09-21-task-0121-automatic-recommendation-completion.md)
- TASK-0121
