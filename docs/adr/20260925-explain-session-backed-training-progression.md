---
id: "decisions-20260925-explain-session-backed-training-progression"
kind: adr
title: "Предлагать прогрессию по двум подробным тренировкам и текущему восстановлению"
status: accepted
date: 2026-09-25
supersedes: []
superseded_by: null
tags:
  - architecture
  - training
  - coaching
---

# Предлагать прогрессию по двум подробным тренировкам и текущему восстановлению

## Context

Действующая Ahilej A/B уже хранится как immutable `TrainingProgramVersion` с
точными workout positions, назначениями и cadence. `WorkoutSession` хранит
фактические sets, weight, reps и RIR. Garmin/Intervals.icu strength summary
может подтвердить occurrence и после явной классификации позицию A/B, но не
содержит выполненных подходов.

Текущий `ProgressionCandidate` проверяет только повторы и RIR одной сессии,
подбирает workout по имени, не сверяет фактический вес с назначением и не
учитывает восстановление. Отдельный `DailyAssessment` знает Recovery и может
запретить прогрессию, но не рассчитывает параметры упражнения. Эти пути могут
дать противоречивые советы. Пользователь одобрил вариант, в котором прибавка
веса требует двух последовательных сопоставимых выполнений той же A или B, а
один успешный результат может поддержать добавление повторений.

## Decision

1. Training владеет read-only `TrainingProgressionGuidance` projection для
   назначений точной active `TrainingProgramVersion` и workout position.
   Projection возвращает `hold`, `add_reps`, `add_weight` либо
   `insufficient_evidence`, typed reason и ссылки на current detailed
   `WorkoutSession` evidence. Это не новая persisted entity.
2. Для сравнения нужны current non-superseded `WorkoutSession` с точными
   `programVersionId`, `programWorkoutPosition`, `exerciseVersionId` и
   `loadBasis`, не позже оцениваемой Person-local даты. Training читает две
   последние сессии точной позиции без общего лимита всей истории. Если
   одинаковая ExerciseVersion встречается в двух назначениях одного workout,
   отсутствие `prescriptionPosition` у performed exercise делает связь
   неоднозначной и блокирует прогрессию. Workout name, ожидаемый A/B порядок, Garmin activity,
   classification и linked external activity не поставляют set evidence.
3. Для `external_weight` все назначенные рабочие подходы в учитываемой
   сессии должны иметь явные фактические weight, reps и RIR, а вес должен
   совпадать с текущим назначением. Неполные, неоднозначные, противоречивые
   записи не порождают увеличение. Extra sets не заменяют неудачные первые
   назначенные sets. Другие load bases остаются без автоматической прибавки.
4. После одной подходящей сессии ниже верхней границы диапазона предлагается
   не более одного дополнительного повторения на подход в следующей такой
   тренировке, в пределах текущего диапазона, если фактический RIR не ниже
   назначенного. Свободный текст `feeling` не разбирается как медицинский
   сигнал; явные Recovery hard stops обрабатывает Coaching.
5. Вес можно предложить лишь когда **две последние** текущие сессии этой
   точной A/B и упражнения достигли верхней границы повторений во всех
   назначенных подходах при назначенном весе и допустимом RIR. Используется
   только явный `progressionIncrementKg` программы. Шаг выше 10% текущего
   веса или 5 kg не предлагается автоматически. Если шага нет или он вне
   границ, projection возвращает объяснение вместо придуманного числа.
6. Действующий `ProgressionCandidate` использует тот же строгий предикат
   прибавки веса и точную workout position. Его `accept` повторно проверяет
   актуальность evidence и создаёт только inactive draft version.
7. Coaching совмещает Training projection с **текущим** `DailyAssessment` для
   Person-local даты. При `recovery_priority`, `caution` или
   `insufficient_data`, при hard stop, несовпадающей active version или
   недостаточно свежем контексте повышение не показывается. Coach объясняет
   причину и предлагает сохранить назначение либо проверить восстановление
   перед следующей тренировкой. Оценка на текущую дату не считается прогнозом
   состояния на будущую дату.
8. Coach получает typed read-only результат и не выводит веса или подходы из
   текста. Результат содержит целевые параметры и фактические weight/reps/RIR
   учтённых подходов с датами и ссылками на сессии; при исправлении сессий
   read пересчитывается. Предложение не создаёт `WorkoutSession`, не меняет active program и
   не означает принятие. Явное принятие кандидата и отдельная активация новой
   версии остаются самостоятельными командами.
9. Решение остаётся в существующем modular monolith. Новые database tables,
   migration, service, queue, dependency или automatic program write не нужны.

## Considered alternatives

### Повышать вес после одной успешной сессии

Быстрее реагирует, но единичный удачный день или ошибка записи могут вызвать
раннюю прибавку. Отклонено по выбору пользователя.

### Показывать только повторы, а изменение веса всегда решать вручную

Даёт максимальный контроль, но не выполняет цель объяснимого предложения
небольшой прибавки на основании устойчивого результата. Отклонено.

### Доверить расчёт Coach по тексту и Garmin summary

Не гарантирует одинаковое правило и может превратить внешнюю сводку в
вымышленные подходы. Отклонено.

### Две подробные сопоставимые сессии и отдельный Recovery gate

Даёт проверяемый Training расчёт и сохраняет Coaching authority над
ежедневной безопасностью. Выбрано.

## Consequences

- Coach может объяснить решение на уровне упражнения и указать конкретные
  подтверждённые сессии, не меняя программу.
- Новые или неполные журналы будут чаще возвращать
  `insufficient_evidence`; это намеренный fail-closed результат.
- После смены active version история старой версии не считается автоматически
  сопоставимой с новой.
- Текущий Recovery gate проверяется при запросе. Перед будущей тренировкой
  требуется новая оценка; рекомендация не обещает готовность заранее.
- Старый кандидат на прибавку веса становится строже; ранее допустимое
  принятие по одной сессии больше не проходит.

## Verification

- Pure tests: hold/reps/weight, две последовательные A/B, exact version и
  position, фактический вес, RIR, missing sets, extra sets, correction,
  loadBasis, explicit increment и safety cap.
- Repository/API tests: current sessions only, candidate и acceptance
  используют один предикат; read-only результат не меняет программу.
- Coaching/MCP tests: Recovery precedence, freshness, active-version match,
  запрет Garmin set inference, понятные limitations и отсутствие write.
- `lint`, `typecheck`, relevant unit/integration tests, docs validation,
  board validation, independent Quality и Architecture Review.

## Related material

- [Training model](20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
- [Training and Performance](../wiki/domain/training-and-performance.md)
- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
- TASK-0135
