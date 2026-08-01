---
id: "decisions-20260731-model-immutable-coaching-recommendations-and-separate-user-decisions"
kind: adr
title: "Неизменяемые рекомендации Coaching и отдельные решения пользователя"
status: accepted
date: 2026-07-31
supersedes: []
superseded_by: null
tags:
  - "coaching"
  - "evidence"
  - "policies"
  - "recommendations"
---

# Неизменяемые рекомендации Coaching и отдельные решения пользователя

## Контекст

Coaching должен превращать опубликованные assessments и факты предметных
контекстов в объяснимое предложение действия. Рекомендация не является
выполненным фактом, не должна менять программу автоматически и обязана
сохранять точные правила и свидетельства, по которым была сформирована.

Одинаковые требования к владельцу, сроку действия, идемпотентности, версии
правил и решению пользователя повторяются для разных видов рекомендаций. При
этом содержимое рекомендации должно оставаться типизированным и проверяемым
на уровне базы данных.

## Решение

1. `CoachingRecommendation` является неизменяемым person-owned корнем. Он
   хранит вид рекомендации, точную `CoachingPolicyVersion`, время создания и
   окончания действия, контрольную сумму свидетельств, объяснение и ключ
   идемпотентности.
2. Каждый вид рекомендации получает отдельную типизированную detail table.
   Произвольное JSON/JSONB-хранилище доменных полей запрещено.
3. Свидетельства представлены отдельными типизированными связями с owning
   modules. Polymorphic `(type, id)` references без внешних ключей не
   используются.
4. `RecommendationDecision` является отдельным неизменяемым person-owned
   фактом с исходом `accepted` или `rejected`, временем, actor и причиной.
   Recommendation не меняет status скрытым обновлением.
5. Для одной рекомендации допускается не более одного терминального решения.
   Повтор той же команды идемпотентен, а противоположное решение конфликтует.
6. `proposed`, `accepted`, `rejected` и `expired` являются состояниями
   проекции. `expired` вычисляется по `expires_at`, если решения нет;
   scheduler для смены состояния не нужен.
7. `executed` не является состоянием рекомендации. Выполнение может быть
   подтверждено только отдельной командой owning context и созданным там
   фактом. Принятие рекомендации не создаёт тренировку и не меняет программу.
8. Shared `CoachingPolicy` и неизменяемые `CoachingPolicyVersion` принадлежат
   Coaching. Параметры первой версии типизированы; универсальный rules engine
   не вводится. Production activation требует отдельного утверждения.
9. Первый вид — `training_adjustment`. Он использует точный
   `RecoveryAssessment`, текущую `TrainingProgramVersion`, назначение и при
   необходимости тренировочные сессии как read-only evidence.
10. Первая detail поддерживает только представимые текущим Training contract
    действия: удержать назначение, предложить новый целевой вес либо новый
    диапазон повторений. Одновременно меняется не более одного параметра.
11. Смена сложности упражнения, замена упражнения, дневной план, nutrition и
    recovery guidance откладываются до появления соответствующих
    типизированных contracts.
12. Расчёт запускается явной командой и создаёт воспроизводимый результат.
    LLM, provider integration, queue, scheduler и автоматическое применение
    не входят в решение.

## Рассмотренные альтернативы

- Независимый полный aggregate для каждого вида рекомендации: строгий, но
  дублирует policy pinning, evidence checksum, expiration, idempotency,
  Person isolation и accept/reject lifecycle. Отклонено.
- Общий неизменяемый lifecycle с типизированными details и evidence links:
  устраняет повторение, сохраняя реляционные constraints. Выбрано.

Нетипизированное JSON/JSONB-хранилище не является допустимой альтернативой для
доменных данных проекта при наличии реляционной модели. JSON разрешён только
для отдельно обоснованного сырого снимка внешнего формата и не входит в эту
задачу.

## Последствия

- Одна история рекомендаций доступна без смешивания разных detail contracts.
- Новая разновидность требует contract, detail table, evidence links и
  migration review.
- Пользовательское решение прослеживается отдельно от содержания совета.
- Истечение срока не требует фонового процесса.
- Coaching читает Recovery и Training, но не получает права изменять их.
- Реальное применение принятого совета потребует отдельной команды Training и
  отдельного архитектурного решения о связи выполнения с рекомендацией.

## Проверка

- Recommendation, detail, policy version и evidence принадлежат одному
  согласованному типизированному графу.
- Другой `Person` не может читать рекомендацию или принимать по ней решение.
- Конкурентные решения не создают два терминальных исхода.
- Просроченную рекомендацию нельзя принять или отклонить.
- Принятие и расчёт не изменяют программу, сессию, Recovery assessment или
  исходные observations.
- Один training adjustment меняет не более одного поддерживаемого параметра.
- В schema нет polymorphic evidence table и JSON/JSONB с доменными полями.

## Связанные материалы

- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
- [Bounded contexts](../wiki/domain/bounded-contexts.md)
- [Доменные invariants](../wiki/domain/invariants.md)
- [Shared reference definitions и person-owned state](20260731-separate-shared-reference-definitions-from-person-owned-state.md)
- [Recovery assessments](20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md)
- [Training programs и sessions](20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
- [Завершённый план реализации](../../plans/2026/07/completed/2026-07-31-coaching-recommendation-lifecycle.md)
