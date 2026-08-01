---
title: Реализация lifecycle рекомендаций Coaching
status: completed
created: 2026-07-31
updated: 2026-08-01
related_roadmap_items:
  - DEV-023
related_board_items:
  - TASK-0019
---

# Реализация lifecycle рекомендаций Coaching

## Цель

Добавить в существующий NestJS API первый типизированный Coaching vertical:
воспроизводимую рекомендацию корректировки тренировочного назначения,
отдельное решение пользователя и строгий запрет автоматического изменения
Training или представления принятия как выполненного факта.

## Утверждённая архитектура

- Решение зафиксировано в
  `docs/adr/20260731-model-immutable-coaching-recommendations-and-separate-user-decisions.md`.
- Recommendation root, typed detail, typed evidence links и decision являются
  разными реляционными сущностями.
- Доменное содержимое не хранится в JSON/JSONB.
- Policy definitions/versions shared и неизменяемы; recommendation и decision
  принадлежат `Person`.
- `expired` вычисляется, `executed` не является recommendation state.
- Первый срез поддерживает только `training_adjustment` над уже существующими
  типизированными полями Training.

## Объём

### Входит

- Runtime JSON Schema только как API validation contracts и TypeScript types;
  persistence остаётся типизированным реляционным.
- Shared `CoachingPolicy` и immutable typed version без публичного изменения.
- Immutable `CoachingRecommendation` с Person, policy version, временем,
  expiration, evidence checksum, explanation и dedupe.
- Typed `TrainingAdjustmentRecommendation` для `hold`, нового target weight
  или нового repetition range с правилом одного изменяемого параметра.
- Typed evidence links к `RecoveryAssessment`, `TrainingProgramVersion`,
  конкретному prescription и optional current workout sessions.
- Explicit evaluation command и deterministic synthetic policy vectors.
- Отдельный immutable `RecommendationDecision` с исходом accepted/rejected,
  actor, time, reason и idempotency.
- Current/history queries с derived state.
- Additive Drizzle migration, NestJS module, OpenAPI, unit и PostgreSQL tests.

### Не входит

- JSON/JSONB persistence доменных recommendation fields.
- Применение рекомендации или изменение program version.
- Состояние executed без owning-domain fact.
- Difficulty/exercise replacement без typed Training model.
- AI Insights analytics, nutrition/recovery guidance, daily planner и day
  closure.
- LLM, provider API, natural-language intake, queue, scheduler или worker.
- Production policy parameters, real data import и Google Sheets mutation.

## Этапы

1. Добавить contracts для policy version, training adjustment, recommendation
   projection и decision commands.
2. Добавить чистые проверки одного параметра, expiration, evidence и decision
   conflicts.
3. Добавить schema и одну additive migration с Person ownership, typed detail,
   typed evidence, dedupe и terminal-decision constraints.
4. Реализовать read-only Recovery/Training evidence ports и evaluator.
5. Реализовать repository transactions и конкурентные Person locks.
6. Подключить NestJS controllers, composition и OpenAPI.
7. Добавить synthetic unit/integration vectors без production thresholds.
8. Проверить clean/upgrade migration, concurrency, isolation и отсутствие
   mutations в Recovery/Training.
9. Провести независимые Quality Review и Architecture Review.
10. После принятия обновить current-state Wiki и перенести план в completed.

## Критерии приёмки

1. Recommendation закреплена за точной immutable Coaching policy version.
2. Recommendation, detail, decision и evidence изолированы по `Person`.
3. Training adjustment имеет ровно одну typed detail и не содержит JSON
   domain payload.
4. Evidence использует typed foreign keys, а не polymorphic `(type, id)`.
5. Расчёт требует существующий current Recovery assessment и точную Training
   program version/prescription того же `Person`.
6. Один результат предлагает hold либо изменение ровно одного параметра:
   target weight или repetition range.
7. Повтор evaluation с тем же Person/policy/evidence/dedupe идемпотентен.
8. Recommendation сохраняет evidence checksum и объяснимый calculation
   snapshot в типизированных columns/detail records.
9. Decision является отдельной immutable записью accepted/rejected.
10. Повтор одинакового decision идемпотентен; противоположный или конкурентный
    terminal decision конфликтует.
11. Просроченную recommendation нельзя принять или отклонить, а state expired
    не требует scheduler mutation.
12. Evaluation и decision не изменяют Recovery assessment, observations,
    Training program/version/session или performed sets.
13. Accepted recommendation не возвращается как executed и не создаёт domain
    fact.
14. Другой `Person` не может читать recommendation или принимать решение.
15. Существующие Physical State, Nutrition, Training и Recovery contracts не
    меняют поведение.
16. Runtime schemas, OpenAPI, migrations, unit, integration и documentation
    checks проходят.

## Проверки

- ESLint для затронутых TypeScript-файлов.
- TypeScript typecheck и build contracts/API.
- Все API unit и PostgreSQL integration tests.
- Clean migration и upgrade от текущего snapshot.
- Concurrency pins для evaluation и terminal decision.
- Person-isolation и no-mutation database snapshots.
- `node scripts/validate-docs.mjs` и docs tests.
- `git diff --check` и audit PostgreSQL identifiers до 63 bytes.

## Риски и ограничения

- Synthetic policy доказывает воспроизводимость, но не безопасность
  production thresholds.
- Training пока не моделирует difficulty и exercise substitution как typed
  prescription change.
- Один terminal decision упрощает первый lifecycle; отзыв принятия потребует
  отдельной append-only модели и продуктового решения.
- Evidence checksum не заменяет внешние ключи и typed snapshots.

## Architecture Review до реализации

1. **Избыточная сложность:** один Coaching module и одна migration; нет нового
   сервиса, scheduler, queue или rules engine.
2. **DDD:** Recovery владеет assessment, Training — program и execution,
   Coaching — recommendation и user decision.
3. **Дублирование:** общий root содержит только действительно общий lifecycle,
   а training detail и evidence остаются типизированными.
4. **Целостность:** recommendation, decision и execution не смешиваются;
   foreign keys заменяют строковые polymorphic references.
5. **Упрощение:** derived expiration устраняет worker; первый вид ограничен
   уже существующими полями Training.

## Результат

- Реализованы typed contracts, evaluator, PostgreSQL repository, NestJS API,
  OpenAPI и одна additive migration.
- Добавлены реляционные policy/version, recommendation, training-adjustment
  detail, typed evidence и immutable decision без domain JSON/JSONB.
- Проверены concurrent idempotency, Person isolation, terminal conflict,
  derived expiration и отсутствие mutations в Recovery и Training.
- Независимая Quality Review приняла все 16 критериев TASK-0019.
- Полный набор API tests прошёл: 12 файлов, 56 тестов.
- Architecture Review подтвердила отсутствие нового deployable boundary,
  scheduler, queue, generic rules engine и polymorphic evidence.
