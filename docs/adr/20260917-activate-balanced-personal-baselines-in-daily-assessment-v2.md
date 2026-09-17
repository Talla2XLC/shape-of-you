---
id: "decisions-20260917-activate-balanced-personal-baselines-in-daily-assessment-v2"
kind: adr
title: "Активировать balanced personal baselines в daily-assessment-v2"
status: accepted
date: 2026-09-17
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - recovery
  - training
  - baselines
---

# Активировать balanced personal baselines в daily-assessment-v2

## Context

TASK-0115 реализовала и проверила гибридные personal baselines, typed travel
eligibility и privacy-safe retrospective evaluation. Counterfactual staging
dry-run показал, что `balanced` и `stable` дают одинаковые решения, тогда как
`responsive` создаёт втрое больше переходов personal overlay в
`recovery_priority`. `stable` требует более длинной истории без измеренного
выигрыша. Поэтому Product выбрал `balanced`.

Однако текущий `DailyAssessmentService` продолжает создавать только
`daily-assessment-v1`; baseline evaluator вызывается лишь retrospective
harness. Пользователь не получает персональное сравнение. Shadow-only delivery
не завершает продуктовую цель TASK-0115.

## Decision

1. Сделать `daily-assessment-v2` текущей API-owned authority для новых daily
   reads. Использовать immutable `balanced` bundle из принятой baseline policy:
   минимум 14 eligible days, target 28, maximum lookback 84 days, minimum recent
   coverage 0.45, trend 3 из последних 4 eligible comparisons, recovery buffer
   2 days и freeze при трёх marked signals.
2. Сохранить `evaluateDailyAssessment` как абсолютную v1 основу. Вынести
   personal overlay из retrospective-only пути в одну чистую deterministic
   функцию, используемую live service и retrospective evaluator. Не допускать
   двух реализаций policy.
3. Overlay является только консервативным. Absolute guardrails и Recovery hard
   stops доминируют. Недостаточный или unstable baseline сохраняет v1 outcome.
   Personal evidence может сделать результат строже, но не может превратить
   `caution`, `recovery_priority` или `insufficient_data` в `ready`.
4. Возвращать typed qualitative comparison для каждого metric:
   `below_usual`, `within_usual`, `above_usual`, `baseline_unavailable` или
   `unstable`. Простое объяснение называет изменение относительно личного
   обычного уровня и не содержит диагноза, причинного вывода, score или ложной
   точности.
5. Recovery и Training остаются владельцами bounded daily consolidation.
   Coaching получает daily representatives, exclusions и точные evidence IDs,
   но не raw provider payload.
6. Для external Training load добавить provider-neutral `loadBasis` и
   `loadBasisVersion` на adapter boundary. Domain сравнивает load history только
   при точном равенстве basis/version и не ветвится по provider. Отсутствующая
   или несовместимая семантика делает personal Training baseline unavailable;
   существующие v1 absolute Training safeguards продолжают действовать.
7. Расширить strict `DailyAssessmentResult` как discriminated v1/v2 contract.
   Старые v1 snapshots остаются читаемыми. V2 snapshot сохраняет exact policy
   parameters, selected evidence IDs, daily representatives, exclusions,
   comparisons и calculation detail внутри typed immutable evidence envelope.
8. Coaching policy version 2 хранится отдельно от version 1. Repository
   возвращает сохранённый `policyVersion`, а не подставляет v1. Evidence checksum
   включает v2, balanced parameters, Person-local context, exact evidence,
   exclusions, comparisons и выбранное действие.
9. Snapshot создаётся только под единым Person-scoped PostgreSQL advisory lock,
   который обязателен для каждого assessment-relevant writer, включая Intake и
   controlled import apply. В той же транзакции repository повторно сверяет
   исходные timezone/Person preference version и evidence revision; при
   изменении composition выполняется заново ограниченное число раз, затем
   fail-closed.
10. Correction, withdrawal, deletion, late import или privacy erasure меняют
   current evidence. Следующий read создаёт или переиспользует snapshot по
   новому canonical checksum; старые non-erased snapshots не переписываются.
11. Не вводить environment-specific domain switch. Код v2 одинаков для всех
    environments, но текущий delivery разрешает только обычный deploy в staging.
    Production deployment и activation требуют отдельного решения оператора.
12. MCP и Coach представляют exact API result. LLM, chat history, provider SDK,
    env thresholds и free-text interpretation не участвуют в domain authority.

## Considered alternatives

### Оставить personal baseline только в shadow harness

Сохраняет минимальный operational risk, но пользователь не получает ценности и
TASK-0115 остаётся незавершённой. Отклонено.

### Заменить v1 только personal baseline

Может нормализовать хронически неблагоприятное состояние и не работает при
sparse history. Отклонено.

### Использовать `connectionId` как Training load semantics

Разделяет источники, но не доказывает единицу или версию алгоритма и не
переживает смену интеграции. Отклонено.

### Гибрид v1 guardrails и balanced personal overlay

Даёт персональный результат, сохраняет проверенные safety rules и позволяет
fail-closed fallback по каждому metric. Выбрано.

## Consequences

- Новые daily reads создают v2 snapshots и могут консервативно изменить
  user-visible status/action относительно v1.
- Публичный strict contract получает versioned v2 detail; клиенты продолжают
  использовать тот же `get_daily_assessment` и не рассчитывают policy сами.
- Потребуются additive migration и backfill для typed Training load semantics.
- Live read станет дороже из-за bounded baseline history; caching или mutable
  baseline не добавляются без измеренного query-plan требования.
- При недостаточной истории отдельный metric честно сообщает
  `baseline_unavailable`, а решение остаётся v1-compatible.
- Production остаётся неизменённым до отдельного deploy approval.

## Verification

- Pure policy tables проверяют precedence, per-metric fallback, 14-day minimum,
  median/MAD fallback, trend persistence, unstable freeze, chronic adverse
  center и простые explanations.
- Owner tests проверяют Person isolation, daily consolidation, evidence IDs,
  correction, withdrawal, deletion, late import, erasure и context exclusions.
- Training tests проверяют exact basis/version compatibility и отсутствие
  provider branching или zero imputation.
- Contract, HTTP, MCP и persistence tests проверяют v1 readability, exact v2
  output, policy version 2, checksum reproduction и one-action authority.
- Migration проходит clean/upgrade/idempotency chains и static PostgreSQL
  identifier limit не более 63 UTF-8 bytes.
- Выполняются full tests, typecheck, lint, build, docs validation, independent
  Quality, Architecture Review и post-acceptance Wiki.
- Staging deploy и реальная user-path проверка выполняются только после
  отдельных commit/push/deploy approvals.

## Related material

- [Hybrid personal baselines](./20260915-use-hybrid-personal-baselines-for-daily-assessment.md)
- [Counterfactual replay](./20260915-replay-daily-assessment-v1-with-explicit-ambiguity.md)
- [API-owned daily assessment](./20260914-own-daily-assessment-and-next-action-in-api.md)
- [Activation plan](../../plans/2026/09/completed/2026-09-17-task-0115-activate-personal-baselines.md)
- TASK-0115
