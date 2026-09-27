---
id: "decisions-20260927-record-qualitative-wellbeing-in-recovery-and-reassess"
kind: adr
title: "Сохранять словесное самочувствие в Recovery и пересчитывать Daily Assessment"
status: accepted
date: 2026-09-27
supersedes: []
superseded_by: null
tags:
  - architecture
  - recovery
  - coaching
---

# Сохранять словесное самочувствие в Recovery и пересчитывать Daily Assessment

## Context

Coach получает прямые сообщения о самочувствии, но текущий
`RecoveryObservation` типа `subjective` требует сразу пять оценок `1..5` и два
булевых ответа. Из фразы «сегодня устал» нельзя получить эти числа и отрицать
болезнь или боль. Свободное изменение совета агентом обошло бы
`Daily Assessment`, которому принадлежит решение о сегодняшней нагрузке.
Оператор 27 сентября согласовал хранение типизированного факта и пересчёт API
без обязательного отчёта после каждого ответа.

## Decision

1. Recovery расширяет существующий `subjective` detail двумя непересекающимися
   формами: полный числовой check-in без изменения его контракта и короткий
   качественный сигнал. Сигнал имеет закрытый словарь `feeling_well`,
   `fatigued`, `sore`, `acute_illness`, `injury_concern`. Один явно сообщённый
   смысл — один факт с Person-local датой, manual provenance, идемпотентностью
   и существующей append-only correction lifecycle. Отсутствующие признаки не
   становятся `false` или числом; неоднозначность даты или смысла требует
   одного короткого вопроса, только если ответ влияет на действие.
2. Качественная форма допустима только для прямого manual сообщения Person.
   Она не считается числовым Recovery check-in, не участвует в расчёте
   readinessScore, confidence или персональной метрики. Старые полные
   наблюдения и immutable snapshots остаются читаемыми.
3. Новая версия `Daily Assessment` включает current качественные факты в
   usedFacts и evidence checksum. `acute_illness` и `injury_concern` создают
   hard stop; `fatigued` и `sore` ограничивают достаточно обоснованное решение
   до `caution` с `recovery_first`, если уже нет более строгого решения.
   `insufficient_data` остаётся нехваткой данных и сохраняет запрос нужного
   факта. `feeling_well`
   сохраняется как сообщение, но не повышает готовность и не снимает
   ограничения из других фактов. Никакая словесная оценка не разрешает
   прогрессию сверх решения API.
4. После записи или исправления Coach читает факт обратно и получает новое
   `get_daily_assessment` для текущего дня; видимый совет следует только ему.
   Вопрос о самочувствии не задаётся рутинно после каждого ответа. Оценка
   будущего дня повторяется в его день.
5. Изменение не касается активной TrainingProgram и не создаёт новый
   deployable сервис. Миграция изменяет только detail storage Recovery;
   старые строки остаются в полной форме. Коммит, push, deploy и применение
   миграции к окружению требуют отдельных разрешений.

## Considered alternatives

### Агент меняет совет по тексту чата

Быстро, но решение не воспроизводится в API, может противоречить hard stop и
не имеет проверяемой истории исправлений. Отклонено.

### Создать отдельную сущность для короткого самочувствия

Сохраняет строгий старый detail, но дублирует Person/date/provenance/correction
жизненный цикл RecoveryObservation и добавляет второй источник субъективных
Recovery фактов. Отклонено.

### Дополнить существующий subjective detail отдельной формой

Использует владельца и существующую историю. Требует явной проверки
взаимоисключающих форм и новой версии Daily Assessment. Выбрано.

## Consequences

- Однозначное словесное сообщение становится проверяемым фактом без
  выдуманных оценок; короткий вопрос остаётся только для важных неясностей.
- Сигнал может ограничить действие, но не создать положительное разрешение на
  тренировку и не отменить аппаратные или программные ограничения.
- Потребуются миграция nullable detail columns с CHECK, расширение публичных
  схем, новая версия снимка Daily Assessment и обновление Coach policy.

## Verification

- Контрактные тесты двух непересекающихся форм и запрета connected qualitative.
- PostgreSQL create/retry/correct/read-back и отсутствие вымышленных шкал.
- Pure/integration тесты `Daily Assessment`: fatigue/soreness, hard stop,
  positive non-override, сохранение более строгих ограничений и snapshot v6.
- MCP policy тесты нужного вызова после ясного сообщения и отсутствия
  навязчивого вызова без сообщения; независимый Quality и Architecture Review.

## Related material

- [Recovery and Readiness](../wiki/domain/recovery-and-readiness.md)
- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
- [Typed Recovery observations](20260731-model-typed-recovery-observations-and-versioned-readiness-assessments.md)
- TASK-0139
