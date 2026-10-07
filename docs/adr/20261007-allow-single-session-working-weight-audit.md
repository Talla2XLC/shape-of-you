---
id: decisions-20261007-allow-single-session-working-weight-audit
kind: adr
title: "Разрешить audit подтверждённой прибавки по одной тренировке"
status: accepted
date: 2026-10-07
supersedes: [decisions-20260929-confirm-working-weight-increase-atomically]
superseded_by: null
tags:
  - training
  - progression
  - architecture
---

# Разрешить audit подтверждённой прибавки по одной тренировке

## Context

Оператор одобрил single-session high-reserve predicate и TASK-0162 plan.
При проверке реализации обнаружено, что `WorkingWeightProposal` требует
ровно две evidence ссылки, Coaching дополнительно проверяет length=2,
а `training_program_weight_changes.evidence_session_two_id` имеет NOT NULL.
Существующий CHECK требует разные ссылки. Поэтому прежнее предположение
«без миграций» не позволяет реализовать одобренное подтверждение прибавки.
Дополнение и delivery одобрены оператором 2026-10-07.

## Decision

Одобренный TASK-0162 дополнен следующими изменениями:

1. У существующего `evidence_session_two_id` снять только NOT NULL
   additive API migration; первая ссылка остаётся обязательной.
   Person-scoped foreign keys и CHECK различия двух non-null ссылок сохраняются.
   Исторические audit rows не переписываются; duplicate первой ссылки не используется.
2. `WorkingWeightProposal.evidenceSessionIds` допускает одну или две unique
   ссылки. Новый high-reserve путь возвращает только реально использованную
   последнюю сессию; обычный путь сохраняет две.
3. Coaching предлагает только согласованные typed guidance/candidate.
   Training под Person evidence lock повторно вычисляет одобренный общий
   предикат по current sessions, сравнивает точные использованные ссылки и
   предложение. При одной сессии audit сохраняет вторую ссылку NULL.
4. Recovery gate, exact active version, bounded increment, explicit confirmation,
   evidence revision, immutable successor и idempotent retry остаются прежними.
   Нет новых entities, tables, services или dependencies.
5. После Quality acceptance уточнить affected current Wiki и supersession
   только затронутых положений прежних progression/confirmation ADR.

## Considered alternatives

Остальные положения прежнего confirmation ADR сохраняются; cardinality
используемого evidence теперь составляет одну или две точные сессии.

- Снять NOT NULL второй ссылки: минимальное изменение existing audit,
  рекомендовано; фиксирует фактическую cardinality evidence.
- Дублировать первую ссылку: искажает evidence и нарушает existing CHECK,
  отклонено.
- Создать новую audit table или child evidence collection: лишняя структура
  для двух существующих вариантов cardinality, отклонено.
- Разрешить только read-only предложение: не выполняет одобренное атомарное
  подтверждение прибавки по одной сессии, отклонено.

## Consequences

Необходима одна additive migration и contract validation cardinality change.
Все существующие строки остаются допустимыми. После новых single-session
writes rollback старого NOT NULL требует отдельной оценки; blind tightening
не разрешается. Миграция проверяется isolated PostgreSQL; live delivery
не входит в это архитектурное одобрение.

## Verification

- Один high-reserve report проходит projection, proposal и atomic confirmation.
- Audit имеет одну обязательную ссылку, вторую NULL и корректный Person scope.
- Two-session путь сохраняет обе разные ссылки и historical audit rows.
- Повтор команды idempotent; изменение RIR, sessions, Recovery или active
  version до подтверждения отклоняет stale предложение.
- Clean migration, upgrade prefixes, identifier limit 63 UTF-8 bytes,
  contract validation, independent Quality и Architecture Review.

## Related material

- [Одобренный high-reserve predicate](20261006-allow-single-session-high-reserve-progression.md).
- [Existing confirmation audit](20260929-confirm-working-weight-increase-atomically.md).
- [План TASK-0162](../../plans/2026/10/completed/2026-10-06-task-0162-high-reserve-progression.md).
