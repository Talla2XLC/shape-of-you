# TASK-0122 — Контекстное использование completion в обычном Coach flow

Статус: завершён локально 2026-09-21; принят Quality и Architecture Review,
без commit, push, migration или deploy.

## Цель

Coach самостоятельно использует TASK-0121 completion assessment для точной
актуальной или предыдущей рекомендации, не задаёт повторный вопрос при
надёжном observed evidence, честно объясняет partial/unknown/conflict и не
делает лишние tool calls вне релевантного контекста.

Архитектура зафиксирована в
[ADR](../../../../../docs/adr/20260921-use-recommendation-completion-in-ordinary-coach-flow.md).

## Границы

В scope:

- контекстные trigger rules в server-owned MCP instructions;
- динамическая presentation completion результата;
- bounded previous-day V4 candidate для сегодняшнего Daily Coach context;
- exact snapshot/date/action pairing;
- active append-only self-report corrections;
- symmetric conflict limitation;
- unit и MCP tests;
- independent Quality, Architecture Review и post-acceptance canonical Wiki.

Вне scope:

- изменение DailyAssessment policy или следующей рекомендации;
- completion как DailyAssessment input;
- public schema change или migration;
- новая автоматическая отрицательная completion policy;
- LLM learning, generic JSON rules, service, database, queue, scheduler,
  dependency, env или manual server operation;
- commit, push, migration execution, deploy или staging access.

## Этапы реализации

1. Добавить внутренний typed `DailyRecommendationReference` для model-facing
   orchestration: `snapshotId`, `localDate` и exact presentation action.
2. Добавить Person-scoped repository read последнего V4 snapshot за одну
   переданную локальную дату. Он не выполняет arbitrary lookback и не меняет
   snapshot.
3. Добавить DailyAssessment service composition для current assessment и
   optional candidate за `currentLocalDate - 1`. Existing `read()` и public
   HTTP result оставить неизменными.
4. Использовать composition в `get_daily_assessment` MCP adapter: structured
   content остаётся текущим `DailyAssessmentResult`, а fresh model-facing
   content получает optional exact previous candidate и contextual lookup
   instructions.
5. Сохранить compatibility `get_daily_projection`: factual structured result и
   DailyAssessment authority не меняются; fresh presentation получает те же
   правила только при наличии exact assessment context.
6. Расширить `MCP_OPERATIONAL_INSTRUCTIONS` trigger/no-trigger матрицей:
   explicit progress, relevant verified owner fact, reused current snapshot и
   previous candidate; запрет фонового discovery и unconditional calls.
7. Сделать completion result presentation динамической для `observed`,
   `self_reported`, `partially_observed`, `unknown` и conflict, не показывая
   internal field names пользователю.
8. Исправить conflict evaluation: active `skipped` против fully observed
   required criteria получает `self_report_conflicts_with_observation` без
   изменения self-reported state и owner facts.
9. Добавить tests:
   - previous candidate только за предыдущую Person-local дату;
   - latest V4 и omission без candidate;
   - exact snapshot pairing;
   - unchanged public structured result;
   - trigger/no-trigger instructions;
   - state-specific presentation;
   - active corrected self-report;
   - symmetric conflict;
   - authorization и fail-closed regression.
10. Выполнить focused tests, API unit suite, typecheck, lint, build, canonical
    docs validation, `git diff --check` и board validation.
11. Передать frozen diff в независимый Quality Review. При полном acceptance
    выполнить Architecture Review.
12. После Quality и Architecture Review обновить только затронутые canonical
    Wiki pages: Coaching и MCP external access. Managed Wiki не использовать.

## Acceptance criteria

1. Coach не вызывает completion при каждом ответе и не запускает assessment
   discovery для нерелевантной routine capture.
2. Full Daily Coach по-прежнему начинает с `get_daily_assessment`; completion
   не меняет status, action или policy.
3. Exact current snapshot проверяется при progress question, relevant verified
   owner fact или другом случае, где outcome влияет на ответ.
4. Сегодняшний brief получает максимум одного candidate: latest V4 snapshot за
   ровно предыдущую Person-local дату. Без candidate completion call не нужен.
5. Completion outcome никогда не применяется к другому snapshot, action или
   localDate.
6. `completed/observed` устраняет вопрос «выполнили?» и кратко сообщает
   подтверждённый результат.
7. `self_reported` явно атрибутируется пользователю и отражает активную
   append-only correction, а не superseded feedback.
8. `partially_observed` сообщает подтверждённую часть и недостающую, stale,
   partial, unknown или unlinked часть.
9. `unknown` не становится невыполнением и не вызывает вопрос, если ответ не
   зависит от уточнения.
10. Conflict сохраняет автоматическое и ручное свидетельства, показывает
    неопределённость и не изменяет owner facts.
11. `skipped/self_reported` против fully observed completion получает conflict
    limitation симметрично существующему конфликтному пути.
12. Public `DailyAssessmentResult`, completion schema, scopes и existing HTTP
    contracts остаются совместимыми; migration не создаётся.
13. Existing stable projection остаётся factual compatibility carrier и не
    превращает completion в recommendation input.
14. Нет LLM learning, generic rules, нового сервиса, queue, scheduler,
    dependency, env, migration или manual server operation.
15. Relevant tests, independent Quality, Architecture Review и canonical docs
    validation проходят до завершения.

## Проверки

- focused completion policy unit tests;
- focused DailyAssessment service/repository tests;
- focused MCP server unit tests;
- `pnpm --filter @shape-of-you/api test:unit`;
- `pnpm --filter @shape-of-you/api typecheck`;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm build`;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- independent Quality Review;
- Architecture Review.

## Риски

- Model-facing candidate не должен стать вторым recommendation source of
  truth; он содержит только pointer и presentation context существующего
  immutable snapshot.
- Последний snapshot за вчера не доказывает, что пользователь видел его.
  Формулировка сообщает результат рекомендации, но не утверждает факт показа.
- Completion read остаётся lazy и может быть недоступен. В этом случае Coach
  сохраняет outcome unknown и не строит fallback из отдельных facts.
- Новые instructions должны быть достаточно короткими и приоритетными, чтобы
  не ухудшить уже принятый Daily Coach и routine capture flow.

## Отдельные operator gates

- commit;
- push;
- migration или deploy на staging;
- authenticated staging/runtime smoke;
- production migration/deploy;
- любое расширение completion policy или DailyAssessment inputs.
