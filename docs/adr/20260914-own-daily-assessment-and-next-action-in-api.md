---
id: "decisions-20260914-own-daily-assessment-and-next-action-in-api"
kind: adr
title: "Владеть ежедневной оценкой и следующим действием на стороне API"
status: accepted
date: 2026-09-14
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - recommendations
  - recovery
  - training
  - timezones
---

# Владеть ежедневной оценкой и следующим действием на стороне API

## Context

Daily Coach сейчас читает typed facts через MCP, но основную композицию и выбор
следующего действия выполняет модель по prompt-инструкциям. Поэтому одинаковые
факты могут получить разные формулировки и разные решения в разных чатах.

В API уже существуют подходящие ownership boundaries: Recovery владеет typed
observations и immutable readiness/load-risk assessments, Training — active
`TrainingProgram`, выполненными sessions и external activity facts, Coaching —
immutable policy-pinned recommendations, а `DailyProjection` — always-live
композицией фактов. TASK-0107 добавила provider-neutral data coverage. Эти
модели следует расширить, а не создавать параллельный `DailyPlan` или generic
rules engine.

Дополнительный пробел: `Person` не хранит timezone. Daily reads получают
`localDate` и timezone от клиента, поэтому новый cross-chat API-owned результат
не может надёжно определять Person-local день без Person-owned настройки.

## Decision

1. Основная daily decision policy принадлежит существующему API и остаётся
   детерминированной. LLM не участвует в вычислении статуса или действия.
2. Расширить Coaching typed recommendation model новым kind
   `daily_next_action`. Не создавать `DailyPlan`, новый bounded context,
   микросервис или универсальный rules engine.
3. Recovery продолжает владеть physiological readiness/load-risk, evidence
   quality и hard stops. Training продолжает владеть программой и выполненными
   фактами. Coaching читает их и выбирает cross-domain next action, но ничего в
   Recovery или Training не изменяет.
4. `daily_next_action` хранится как immutable versioned snapshot. При чтении API
   собирает current typed facts, вычисляет canonical evidence checksum и
   переиспользует snapshot для одинаковых Person, local date, timezone, policy
   version и evidence. Новый или исправленный факт меняет checksum и создаёт
   новый current snapshot. Mutable invalidation flag не используется.
5. Snapshot содержит safe day status, typed used facts/evidence, missing
   important data, typed reasons, ровно одно recommended action, bounded
   alternatives, limitations, confidence, policy version и checksum. Provider
   JSON и generic polymorphic evidence запрещены.
6. Добавить Person-owned nullable IANA timezone. Пока timezone не задана,
   assessment read возвращает typed `timezone_required` result и не угадывает
   timezone по чату, браузеру или provider payload. Настройка меняется только
   через authenticated Person HTTP boundary; MCP write scope не добавляется.
7. Статусы первой policy: `ready`, `caution`, `recovery_priority` и
   `insufficient_data`. Hard stop имеет отдельное доминирующее представление в
   `recovery_priority`; отсутствие timezone возвращается envelope-веткой
   `timezone_required`, а не status.
8. Next action является closed typed union. Training action может ссылаться
   только на active `TrainingProgramVersion` или существующую точную
   `training_adjustment` recommendation. API не изобретает workout, exercises,
   sets, load или schedule и не создаёт выполненный fact.
9. Safety precedence: acute illness, injury concern и Recovery hard stop;
   затем high recovery/load risk вместе с recent load; затем short sleep с
   неблагоприятным Person baseline HRV/resting heart rate; затем низкий Body
   Battery только вместе с другими signals; затем missing/stale/poor evidence.
   Низкая confidence запрещает progression и новую training prescription.
10. Nutrition completeness и Weight используются как typed context. Partial
    Nutrition не доказывает голодание или полный дневной рацион, а отдельный
    Weight fact не создаёт diagnosis или причинный вывод.
11. Добавить один MCP read tool `get_daily_assessment` с существующим read
    authorization scope и `readOnlyHint`. Он не принимает mutation input.
    ChatGPT объясняет готовый structured result, но не заменяет status, reasons,
    action, alternatives, limitations или confidence.
12. PostgreSQL остаётся authority. Sheets/chat-history fallback запрещён.
    Snapshot materialization является idempotent внутренней работой API, не
    расширением полномочий MCP-клиента.

## Considered alternatives

### Продолжать управление только через MCP-промпты

Не требует schema и policy implementation, но зависит от модели, chat context и
порядка tool calls. Нельзя гарантировать одинаковое решение и audit trail.

### Вызывать LLM внутри backend

Централизует orchestration, но сохраняет недетерминизм, добавляет стоимость,
dependency, эксплуатацию и второй conversation layer. Для safety foundation не
выбрано.

### Детерминированная API-owned policy

Требует typed vocabulary, versioned policy, evidence model и boundary tests, но
даёт воспроизводимость, объяснимость и одинаковый результат во всех clients.
Выбрано.

### Считать результат заново без хранения

Самый простой freshness contract, но не сохраняет точный decision audit и хуже
соответствует существующим RecoveryAssessment/CoachingRecommendation models.
Отклонено в пользу lazy immutable snapshots.

### Создать отдельный DailyAssessment aggregate

Сделало бы название прямым, но продублировало бы policy, evidence, lifecycle и
erasure semantics Coaching. Отклонено: публичный `DailyAssessmentResult`
остаётся projection над расширенным `CoachingRecommendation`.

## Consequences

- Любой approved MCP client получает одно и то же API-owned решение по тем же
  typed facts и policy.
- Corrections и late facts меняют current result без scheduler или mutable
  invalidation state; history остаётся воспроизводимой.
- Появляются additive Person/Coaching schema, migration и новый read contract.
- Пользователь должен один раз сохранить timezone через authenticated HTTP/UI
  flow; до этого daily assessment безопасно недоступен.
- Policy v1 намеренно консервативна и может чаще рекомендовать сбор одного факта
  или recovery-first action, чем недоказанную тренировку.
- Новый service, queue, scheduler, LLM dependency, database, credential и env
  variable не требуются.

## Verification

- Pure table tests фиксируют precedence, thresholds, missing-data behavior и
  deterministic semantic output.
- PostgreSQL tests проверяют Person isolation, idempotent snapshot reuse,
  corrections, withdrawals, late facts, program-version changes и erasure.
- Timezone/DST tests проверяют Person-local date и `timezone_required`.
- Training tests запрещают invented workout и конфликт с active program.
- MCP tests проверяют strict result, existing read scope, `readOnlyHint` и
  fail-closed behavior без prompt-side reconstruction.
- Clean/upgrade migration tests и static guard проверяют PostgreSQL identifiers
  не длиннее 63 UTF-8 bytes.
- Developer, независимый Quality, Architecture Review и post-acceptance Wiki
  выполняются до завершения TASK-0112.

## Related material

- [Recovery assessments](./20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md)
- [Coaching recommendations](./20260731-model-immutable-coaching-recommendations-and-separate-user-decisions.md)
- [Training programs](./20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
- [Daily Coach](./20260827-orchestrate-daily-coach-over-existing-mcp-tools.md)
- [Provider-neutral profile coverage](./20260913-show-provider-neutral-profile-data-coverage.md)
- [TASK-0112 plan](../../plans/2026/09/completed/2026-09-14-task-0112-api-owned-daily-assessment.md)
- TASK-0112
