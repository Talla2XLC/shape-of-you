---
id: "decisions-20260918-record-typed-daily-recommendation-feedback"
kind: adr
title: "Собирать типизированную обратную связь по ежедневной рекомендации"
status: accepted
date: 2026-09-18
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - daily-assessment
  - feedback
  - evidence
---

# Собирать типизированную обратную связь по ежедневной рекомендации

## Context

API уже создаёт неизменяемый `DailyAssessment` snapshot как
`CoachingRecommendation(kind = daily_next_action)`. Его `snapshotId` совпадает
с `coaching_recommendations.id` и однозначно фиксирует Person, локальную дату,
timezone, версию политики, evidence checksum, статус оценки и конкретное
`recommendedAction`.

Существующий Coach может показать это действие, но не может сохранить
типизированное свидетельство о том, что пользователь его принял, выполнил,
пропустил либо счёл слишком тяжёлым или неподходящим. Свободный текст без
типизированного значения плохо анализируется и не обеспечивает устойчивого
контракта для будущей калибровки.

`coaching_recommendation_decisions` решает другую задачу: хранит одно
терминальное `accepted` или `rejected` решение по `training_adjustment`.
Расширение этой таблицы смешало бы принятие предложения, фактический результат
и оценку пригодности. Оно также нарушило бы действующий инвариант: принятие
рекомендации не доказывает её выполнение.

Нужно сохранить точную историю пользовательских сообщений и возможность
последующего анализа, но не внедрять самообучение, автоматическую калибровку или
изменение текущей политики `DailyAssessment`.

## Decision

1. Coaching владеет отдельным append-only потоком
   `DailyRecommendationFeedback`. Он не является новым bounded context,
   `DailyPlan` или deployable service.
2. Каждое событие связано составным внешним ключом
   `(recommendation_id, person_id)` с точным
   `coaching_daily_assessment_details`. Ссылка на произвольную
   `CoachingRecommendation` или клиентская передача версии политики вместо
   snapshot запрещены.
3. Типизированный `status` обязателен и принимает одно из значений:
   `accepted`, `completed`, `skipped`, `too_heavy`, `unsuitable`.
4. `accepted` означает намерение следовать рекомендации. `completed` означает
   явный самоотчёт о результате. `skipped` означает явный самоотчёт о
   невыполнении. Эти значения не выводятся из времени, отсутствия фактов или
   поведения пользователя.
5. `completed` и `skipped` взаимоисключающие для одного snapshot. `accepted`
   может предшествовать любому из них. `too_heavy` и `unsuitable` являются
   отдельными типизированными сигналами пригодности и могут сосуществовать с
   `accepted`, `completed` или `skipped`. Поэтому сообщение «выполнил, но было
   слишком тяжело» не теряет ни факт результата, ни оценку сложности.
6. Один status записывается для одного snapshot не более одного раза. Событие
   содержит собственный UUID, `personId`, `actorPersonId`, `reportedAt`,
   `idempotencyKey` и необязательный `comment` длиной до 1000 символов.
   Непустой комментарий только дополняет status и не может существовать без
   него.
7. Запись идемпотентна в границе Person. Повтор того же payload с тем же
   `idempotencyKey` возвращает ранее созданное событие. Повтор ключа с другим
   snapshot, status или comment завершается конфликтом. Другой ключ не может
   создать дубликат уже записанного status.
8. Создание выполняется в транзакции под блокировкой Person/recommendation;
   ограничения уникальности остаются последней защитой от конкурентных
   повторов. PostgreSQL статически обеспечивает Person ownership, уникальность
   idempotency key, уникальность status и взаимоисключение `completed` /
   `skipped`.
9. Feedback можно записать после `expiresAt`: пользовательский результат
   естественно появляется позже времени актуальности рекомендации. Snapshot
   должен существовать, принадлежать текущему Person и оставаться доступным по
   действующим privacy/erasure правилам.
10. Удаление daily snapshot по privacy erasure каскадно удаляет связанную
    обратную связь. Комментарий не пишется в логи, checksum, model-facing
    инструкции или аналитические отчёты.
11. API публикует отдельный typed command и read-back истории feedback под
    daily-assessment/Coaching boundary. Текущий `DailyAssessmentResult` не
    расширяется и не получает новую policy version.
12. MCP получает одну команду `record_daily_recommendation_feedback` с точным
    `snapshotId`, status, необязательным comment и `idempotencyKey`. Команда
    использует отдельный минимальный OAuth scope
    `daily-recommendation-feedback:write`.
13. Coach использует `snapshotId` из уже полученного результата. Если точный
    текущий snapshot неизвестен, он сначала вызывает `get_daily_assessment`.
    Неоднозначная ссылка на старую рекомендацию требует одного естественного
    уточнения; Coach не присваивает feedback предположительно выбранному
    snapshot.
14. Явное и однозначное сообщение пользователя разрешает routine write без
    повторного вопроса-подтверждения. Coach сообщает успех только после typed
    результата записи и не показывает пользователю ID, OAuth scope или детали
    транспорта.
15. Feedback не участвует в `usedFacts`, evidence checksum, personal baseline,
    status/action evaluator или выборе нового snapshot. Он не меняет
    `TrainingProgram`, не создаёт `WorkoutSession`, Meal, RecoveryObservation
    или другой owning-domain fact и не доказывает такие факты за пределами
    контекста результата рекомендации.
16. В TASK-0119 не создаются scoring, analytics pipeline, adaptive policy,
    автоматическое обучение или правило изменения рекомендации. Реляционные
    typed events только создают доказательную базу для отдельно спроектированной
    будущей калибровки.

## Considered alternatives

### Расширить `coaching_recommendation_decisions`

Потребовало бы меньше новых таблиц, но смешало бы терминальное решение по
`training_adjustment` с многоэтапной обратной связью по ежедневному действию.
`accepted -> completed` невозможно выразить в модели одного терминального
решения без изменения существующей семантики. Отклонено.

### Хранить одно изменяемое состояние на snapshot

Упростило бы чтение текущего значения, но перезаписывало бы историю принятия и
результата, теряло timestamps и ухудшало воспроизводимый анализ. Скрытый
overwrite противоречит правилам API. Отклонено.

### Append-only typed events, связанные с точным snapshot

Сохраняют историю, разделяют предложение и результат, поддерживают составные
сигналы вроде `completed + too_heavy` и используют уже существующую immutable
recommendation authority. Выбрано.

## Consequences

- Появляются additive API schema и migration, но не новый сервис, база,
  credential, queue, scheduler или environment variable.
- Identity расширяет allowlist и consent copy одним минимальным resource scope;
  существующий `person:read` не получает write authority.
- Историю можно реляционно сопоставить с action type, policy version, reasons,
  confidence и evidence checksum без копирования этих значений в feedback.
- Отдельные статусы пригодности не теряются при завершённом или пропущенном
  действии.
- Отсутствует «текущее единственное состояние» feedback; потребители читают
  упорядоченную историю или строят явную projection. Это намеренная цена
  сохранения доказательств.
- Новая информация пока никак не улучшает и не ухудшает рекомендации. Любая
  будущая калибровка потребует отдельного ADR, критериев качества и operator
  approval.
- Commit, push, migration execution, deployment, staging/production access и
  аналитический запуск остаются отдельными operator gates.

## Verification

- Contract tests проверяют закрытый status enum, обязательный status,
  необязательный bounded comment и strict schemas.
- PostgreSQL tests проверяют clean/upgrade migration, Person isolation,
  составной FK к daily snapshot, expiry-independent write, privacy cascade,
  exact retry, payload conflict, duplicate status и конкурентную запись.
- Domain/storage tests проверяют допустимую историю `accepted -> completed`,
  конфликт `completed` / `skipped` и сосуществование `completed + too_heavy`.
- HTTP tests проверяют typed create/read-back и отсутствие доступа к snapshot
  другого Person или recommendation другого kind.
- MCP/Identity tests проверяют новый tool, `idempotentHint`, dedicated scope,
  consent label, predefined-client reconciliation и отказ read-only token.
- Regression tests доказывают, что feedback не меняет повторный
  `get_daily_assessment`, policy version, checksum, status или action.
- Проверяются PostgreSQL identifiers не длиннее 63 UTF-8 bytes, full tests,
  typecheck, lint, build, docs validation, независимый Quality, Architecture
  Review и post-acceptance Wiki.

## Related material

- [Immutable Coaching recommendations and decisions](./20260731-model-immutable-coaching-recommendations-and-separate-user-decisions.md)
- [API-owned daily assessment](./20260914-own-daily-assessment-and-next-action-in-api.md)
- [Daily Coach over existing MCP tools](./20260827-orchestrate-daily-coach-over-existing-mcp-tools.md)
- [TASK-0119 plan](../../plans/2026/09/completed/2026-09-18-task-0119-typed-daily-recommendation-feedback.md)
- TASK-0119
