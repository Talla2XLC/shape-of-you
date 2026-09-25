# TASK-0133 — автоматическая связь доказанных тренировочных фактов

## Цель

Автоматически связывать current `WorkoutSession` и `ExternalActivity`, когда
они доказанно описывают одно занятие, без угадывания по одной дате или времени.

## Решение и границы

- Применить [ADR](../../../../docs/adr/20260925-link-proven-workout-sessions-to-external-activities.md).
- Работать в Training и существующем Intervals.icu sync; использовать
  `training_workout_session_activity_links` и Person lock.
- Сохранить независимость `ExternalActivityProgramClassification` и
  неизменяемость WorkoutSession/external facts.
- Не выполнять staging migration, deploy, commit или push в этой задаче без
  отдельного разрешения.

## Шаги

1. Зафиксировать в 4DreamTeam критерии, ограничения и тестовый план.
2. Добавить проверяемый pure matcher, metadata для automatic link и отдельную
   Person-owned конфигурацию доверенного external title для exact program
   version/position. Явное подтверждение/замена/отзыв доступны через
   `workout:write`; неподтверждённое имя не участвует в matcher.
3. Запускать reconciliation после записи обеих сторон и для недавних
   существующих записей при повторном sync.
4. Учесть provider/session corrections и current projection без двойного
   occurrence; сохранить explicit links.
5. Добавить unit, PostgreSQL integration и migration tests, выполнить
   относящиеся к задаче проверки.
6. Провести независимую Quality Review и Architecture Review; после принятия
   обновить затронутые current-state Wiki pages.

## Критерии приёмки

- Пара с точным общим source identity связывается независимо от порядка
  поступления; во втором пути нужны заранее подтверждённый trusted title,
  exact program position и совместимое точное время при взаимной уникальности.
- Подтверждение, замена и отзыв title атомарно переоценивают auto-links;
  версия программы и classification отдельной активности не меняются.
- Generic name, только дата/время, несколько кандидатов и конфликтующая
  explicit связь не дают automatic link.
- Corrections переоценивают automatic link; manual links и classification не
  перезаписываются; повторный sync не создаёт дубликатов.
- Training cadence и DailyAssessment не считают связанную пару двумя
  тренировками; числовая нагрузка не удваивается.
- Миграция и docs validation проходят; Quality подтверждает каждый критерий.
