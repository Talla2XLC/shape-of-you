---
id: "decisions-20260925-link-proven-workout-sessions-to-external-activities"
kind: adr
title: "Автоматически связывать только доказанные совпадения WorkoutSession и ExternalActivity"
status: superseded
date: 2026-09-25
supersedes: []
superseded_by: decisions-20260925-link-garmin-strength-with-recording-context
tags:
  - architecture
  - training
  - integrations
  - daily-assessment
---

# Автоматически связывать только доказанные совпадения WorkoutSession и ExternalActivity

## Context

`WorkoutSession` и импортированная `ExternalActivity` могут описывать одно
занятие, но существующая `training_workout_session_activity_links` заполняется
только при явной передаче `externalActivityId` во время создания или исправления
сессии. Импорт Intervals.icu не ищет соответствующую сессию. Отдельная
`ExternalActivityProgramClassification` определяет workout активной программы,
но не доказывает тождество с подробной сессией.

`DailyAssessment` берёт числовую нагрузку из external activity и не прибавляет
к ней нагрузку сессии. Однако две записи остаются разными occurrence evidence,
пока явной связи нет. Сессии из исторического Fitness Tracker имеют только
Person-local date, поэтому дата и общий тип «силовая» не позволяют доказать
тождество с Garmin-сводкой.

## Decision

1. Training остаётся владельцем связи и использует существующую отдельную
   Person-scoped relational association. Новый `TrainingOccurrence`, сервис,
   очередь или источник истины не вводится.
2. Автоматический matcher детерминирован, версионирован и рассматривает только
   current факты одного Person. Он никогда не выводит программу или A/B из
   названия, очередности либо времени.
3. Достаточное доказательство: exact общий внешний record identity из
   `SourceReference` и provider identity; либо заранее подтверждённый Person
   доверенный external title для exact program version/position, к которому
   привязана подробная силовая сессия. Во втором случае нормализованное имя
   импортированной активности должно совпадать с доверенным title, а имя
   сессии — с immutable program workout name; дополнительно нужны совместимый
   тип, совпадающая Person-local date и близкое точное время начала.
   Неподтверждённое название, каким бы необычным оно ни казалось, никогда не
   даёт automatic link. Для `local_date`-only сессии второе правило неприменимо.
4. Доверенный title — отдельная Person-owned конфигурация Training, привязанная
   к immutable program version/position, а не часть версии программы или
   classification отдельной активности. Его можно подтвердить и заменить
   явной командой только для active version с ожиданием program/version/lock;
   отзыв допускается и для прежней Person-owned version. Он не переносится
   автоматически на новую версию программы. Запись или отзыв
   сразу перепроверяет current пары этого exact workout; прошлые auto-links
   удаляются, если доказательство исчезло. Без явного подтверждения title
   сравнение по имени закрыто.
5. Пара должна быть взаимно единственной среди всех current кандидатов в
   проверяемой дате. Второй возможный session или activity, существующая
   другая current связь, расхождение по типу или недостаток полей дают
   no-match. Близость времени без независимого доказательства не достаточна.
6. Сопоставление запускается после появления или исправления любой стороны и
   при повторном sync в ограниченном окне, чтобы захватить запоздалый импорт
   и уже существующие недавние факты. Повторная проверка идемпотентна.
7. Решение записывается под существующей Person lock в транзакции. Для
   automatic association сохраняются версия правила и проверяемое основание;
   ручные existing links сохраняют отдельную authority. Отрицательное или
   сомнительное решение не записывает link и не меняет classification.
8. Provider correction остаётся в той же external lineage. Automatic link
   перепроверяется по current successor; если доказательство исчезло, связь
   перестаёт участвовать в current projection. Исправленная сессия получает
   связь только после новой проверки current пары. Исторические факты остаются
   неизменяемыми; erasure удаляет link через существующую границу FK.
9. Подтверждённая пара даёт одно occurrence для cadence и связанных
   проекций. `WorkoutSession` остаётся единственным источником выполненных
   упражнений и sets; external fact остаётся источником своей числовой
   training load. `DailyAssessment` сохраняет обе ID в used facts для
   provenance, но не трактует пару как два занятия.
10. `ExternalActivityProgramClassification` не создаётся из auto-link.
   Детальная сессия с exact program version/position имеет приоритет;
   существующая user classification допускает automatic link только при
   полном совпадении этой version/position с сессией. Отрицательная или
   противоречащая classification блокирует automatic link; отсутствие exact
   session identity не даёт права автоматически назначить A/B.
11. Обратная совместимость `WorkoutSession.externalActivityId` сохраняется:
    публичное поле отражает current связанную external activity. Ручные
    explicit links имеют приоритет и не переписываются matcher.

## Considered alternatives

### Связывать по совпадению даты или близости времени

Мало данных для нескольких тренировок рядом и `local_date`-only сессий.
Создаёт ложные связи и ошибочное подавление вопроса. Отклонено.

### Создать общий TrainingOccurrence

Упростило бы единый occurrence read, но потребовало бы нового lifecycle,
исторического backfill и отдельной correction/erasure authority. Для
наблюдаемого дефекта преждевременно. Отклонено.

### Детерминированный matcher поверх существующей association

Сохраняет два разных агрегата и использует уже принятую дедупликацию. Правила
строги и проверяемы; неполные исторические пары останутся несвязанными. Выбрано
с дополнительной explicit authority доверенного title.

### Считать редкое название специфичным автоматически

Конечный словарь общих слов пропускает `Strength Workout`, `HIIT Workout`,
`Cardio Workout` и `Yoga Workout`. Даже расширенный словарь не доказывает
специфичность произвольного provider title. Отклонено после двух независимых
Quality rejection.

## Consequences

- После однократного подтверждения title будущие и доступные прошлые пары
  связываются без классификации каждой активности.
- Одна дата, общий Garmin title или ожидаемый A/B порядок не дают auto-link.
- Для связи сессий без точного времени нужен общий точный source identity;
  иначе исторические случаи остаются несвязанными. Пока title не подтверждён,
  `Ahilej B` и любая Garmin-сводка с таким именем также остаются отдельными.
- Additive metadata migration и bounded reconciliation затрагивают только
  существующий Training owner и существующий integration worker.

## Verification

- Pure matcher tests покрывают exact identity, trusted title плюс
  время, неподтверждённые generic и уникальные titles, date-only, конкурирующие
  кандидаты и несовместимый тип.
- PostgreSQL tests проверяют Person isolation, обе последовательности импорта,
  повторный sync, session/provider correction, erasure и explicit-link priority.
- Training и DailyAssessment tests проверяют одно occurrence, отсутствие
  числового double count, неизменность classification и evidence revision.
- Migration tests проверяют clean/upgrade/idempotency и статический лимит
  PostgreSQL identifiers в 63 UTF-8 bytes.
- Выполняются docs validator, relevant lint/typecheck/tests и независимая
  Quality Review.

## Related material

- [Training-owned rolling cadence](20260922-own-rolling-training-cadence-and-next-step-in-training.md)
- [Imported activity classification](20260923-classify-imported-strength-activity-against-training-program.md)
- [Training and Performance](../wiki/domain/training-and-performance.md)
- TASK-0133
