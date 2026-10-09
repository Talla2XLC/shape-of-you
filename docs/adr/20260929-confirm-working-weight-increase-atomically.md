---
id: "decisions-20260929-confirm-working-weight-increase-atomically"
kind: adr
title: "Применять прибавку рабочего веса только после явного подтверждения"
status: superseded
date: 2026-09-29
supersedes: []
superseded_by: decisions-20261007-allow-single-session-working-weight-audit
tags:
  - architecture
  - training
  - coaching
---

# Применять прибавку рабочего веса только после явного подтверждения

## Context

TASK-0135 рассчитывает read-only прогрессию по двум последним подробным
`WorkoutSession` точной позиции A/B. TASK-0137 вызывает её в обычном разговоре
о следующей силовой. Существующий `ProgressionCandidate.accept` повторно
проверяет подходы, но создаёт только inactive draft; отдельная активация не
проверяет восстановление. Пользователь выбрал вариант B для TASK-0145:
конкретное предложение Coach, одно понятное подтверждение человека и повторная
проверка перед сохранением. Молчаливая прибавка запрещена.

## Decision

Полномочия и обязательная orchestration нового Coach заменены
[ADR базы знаний](20261009-let-coach-propose-working-weight-from-history.md).
Хранение фактов, исторические версии и legacy eligibility сохраняются
для совместимости, но не ограничивают новый универсальный путь.

1. Training выдаёт неперсистентное предложение ровно для одного назначения
   точной следующей силовой тренировки: active program/version/lock, workout и
   prescription position, `exerciseVersionId`, текущий и предложенный вес,
   два current evidence session id и Person-local date. Основание прибавки —
   неизменный строгий предикат TASK-0135. Предложение не меняет программу.
2. Coach показывает упражнение, прежний и новый вес и спрашивает одним
   вопросом, подтверждает ли человек эту прибавку при уверенной технике и
   отсутствии боли. Сомнение, вопрос, правка или ответ на другое предложение
   не разрешают запись. Одно ясное согласие разрешает одну точную команду.
3. Отдельная API-owned команда повторно читает текущие Recovery и Training
   facts для текущей Person-local даты. Серверная консервативная проверка
   требует допустимого текущего восстановления без hard stop, caution,
   недостаточности данных, боли или болезни; точной доступной силовой позиции;
   и совпадения active/current версии. Coach не может передать собственный
   вывод о безопасности как authority. Будущая дата не даёт разрешения.
4. API получает проверяемый revision фактов до и после свежего чтения. В одной
   PostgreSQL transaction под существующей Person evidence lock сверяет его
   снова, проверяет expected program lock и активную версию, заново рассчитывает
   кандидат из текущих non-superseded сессий и сравнивает все параметры
   предложения. При расхождении транзакция не пишет ничего; нужно показать
   новое предложение и получить новое согласие.
5. Успешная транзакция копирует immutable `TrainingProgramVersion`, меняет
   только один `targetWeightKg` и сразу делает новую версию current и active.
   Старые версии и `WorkoutSession` не меняются. Существующий путь принятия
   кандидата в inactive draft сохраняется для других сценариев.
6. `TrainingProgramWeightChange` — типизированная Person-owned audit entity:
   request id, program, base/new version, точные позиции, exercise version,
   старый/новый вес, две evidence session id, local date, Recovery revision,
   server confirmation timestamp и источник `coach_explicit_confirmation`.
   Уникальный Person/request id делает повтор идентичной команды идемпотентным;
   другой payload с тем же id конфликтует. Audit row и активация атомарны.
   Текст переписки не сохраняется как доказательство согласия.
7. Coach подтверждает успех только после read-back активной версии и свежего
   дневного контекста. Без явного согласия write action не вызывается.
   MCP-сервер не видит доверенный пользовательский event и не может
   криптографически доказать natural-language согласие; это ограничение
   разговорного канала, а не основание ослаблять серверные проверки.
8. Решение остаётся в существующем API modular monolith. Новая таблица и
   миграция обслуживают только типизированный аудит; новых сервисов, очередей
   и автоматического фонового повышения нет.

## Considered alternatives

### Оставить совет и ручное редактирование

Безопасно, но каждое подтверждение заставляет вручную менять программу.

### Последовательно вызвать accept кандидата и activate версии

Между командами могут измениться Recovery, evidence или программа;
активация не проверяет Recovery. Отклонено.

### Молча повышать вес при выполненном правиле

Исключает решение человека и может опереться на ошибочную запись или новую
боль. Отклонено.

### Одна подтверждённая команда с повторной проверкой и транзакцией

Сохраняет один понятный шаг для человека и единый момент доменной проверки.
Выбрано.

## Consequences

- Исправление подходов, новый Recovery факт, смена версии, повторное применение
  или переход даты закрывают старое предложение.
- Для `body_weight`, `assisted`, неполных и неоднозначных данных команда
  недоступна. Техника подтверждается человеком, а не выводится из sets.
- Понадобятся типизированные public contract, таблица аудита, миграция и
  интеграционные тесты конкурентной записи.
- Реальное natural-language согласие внешнего MCP-клиента нельзя доказать
  серверным тестом; тесты проверяют опубликованное правило вызова и отсутствие
  вызова для неоднозначных ответов.

## Verification

- Pure tests: точное предложение и все запреты правила TASK-0135.
- PostgreSQL tests: повторное чтение, correction, Recovery change, смена
  active version/lock, переход даты, race, атомарность, идемпотентность и audit.
- MCP tests: одна явная confirmation, пропуск при сомнении, точный payload,
  post-write read-back и отсутствие фоновой записи.
- Typecheck, lint, build, relevant unit/integration suites, identifier length
  check, docs validation, независимые Quality и Architecture Review.

## Related material

- [Session-backed progression](20260925-explain-session-backed-training-progression.md)
- [Ordinary Coach routing](20260927-invoke-progression-in-ordinary-next-strength-coaching.md)
- [Training model](20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
- [Training and Performance](../wiki/domain/training-and-performance.md)
