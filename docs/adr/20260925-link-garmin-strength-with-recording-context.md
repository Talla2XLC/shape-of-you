---
id: decisions-20260925-link-garmin-strength-with-recording-context
kind: adr
title: "Связывать силовую Garmin с подробной сессией по подтверждённому контексту записи"
status: accepted
date: 2026-09-25
supersedes: [decisions-20260925-link-proven-workout-sessions-to-external-activities]
superseded_by: null
tags:
  - architecture
  - training
  - integrations
  - daily-assessment
---

# Связывать силовую Garmin с подробной сессией по подтверждённому контексту записи

## Context

Garmin даёт одинаковое название «Силовая тренировка» для Ahilej A, Ahilej B и
силовых занятий в других местах. Привязка этого title к одному workout
неверна. При этом Person подтвердил устойчивую практику: он запускает именно
этот режим Garmin, когда выполняет силовую тренировку, и сообщает агенту
время и место подробной сессии. Для 23 сентября подробная `Ahilej B` имеет
точное начало, а Garmin-сводка началась на 13 минут раньше. Старое правило
оставляет пару несвязанной, потому что generic title не идентифицирует B.

## Decision

1. Training остаётся владельцем связи. Сохраняем действующие пути exact source
   identity и Person-confirmed exact workout title, приоритет explicit links,
   current lineage, Person lock и отдельную classification. Добавляется третий
   путь `confirmed_recording_context`, не выводящий A/B из Garmin title.
2. Новая Person-owned конфигурация `training_activity_recording_modes`
   подтверждает конкретное название режима Garmin/Intervals.icu как **тип
   записи силовой**, пригодный для поиска кандидатов независимо от программы и
   места. Она не классифицирует отдельную ExternalActivity и не утверждает,
   что всякая Garmin-силовая является Ahilej. Создание, замена и отзыв требуют
   явного заявления Person, версионируются optimistic lock и сразу
   перепроверяют доступные current пары, включая ранее связанные даты при
   замене или отзыве режима.
3. `WorkoutSession` хранит необязательный `venueLabel`, сообщённый Person.
   Исправление сессии заменяет это значение вместе с остальным snapshot.
   Место помогает агенту назвать конкретную сессию в вопросе и сохраняет
   контекст разговора. Пока импорт Garmin не несёт проверенной геопозиции,
   место не является доказательством совпадения с external activity.
4. Для contextual auto-link нужны одновременно: current подробная силовая с
   точным `occurredAt`, выполненными силовыми sets и корректной exact program
   version/position, если они заданы; current Garmin-attributed external
   activity из Intervals.icu с подтверждённым названием режима, без дистанции,
   достаточной длительностью; одна Person-local date; разница начал не более
   15 минут; взаимно единственная пара среди всех кандидатов. Если session
   имеет program identity, её имя должно совпадать с immutable workout name.
   Наличие другого совместимого session или activity, explicit occupancy либо
   конфликтующая classification блокируют link. Само время без подтверждённой
   практики записи ничего не связывает.
5. Успешная пара получает прежнюю association с basis
   `confirmed_recording_context` и новой policy version. При запоздалом
   импорте, повторном sync, исправлении любой стороны, замене или отзыве
   настройки matcher пересчитывает current связи; недоказанные auto-links
   удаляются. Исторические immutable факты не меняются.
6. Если доказательств не хватает или кандидатов несколько, система не
   записывает link и отдаёт агенту конкретный вопрос о паре с датой, временем,
   местом сессии и Garmin summary. Вопрос строится по всем current фактам
   указанной даты и immutable версии программы, независимо от лимита общей
   истории; длинный список показывается частично с указанием общего числа.
   Ответ Person может создать explicit link; он не превращается в правило
   для других тренировок. Запись без подробной сессии не получает A/B
   автоматически.
7. Связанная пара остаётся одним occurrence в cadence и DailyAssessment.
   Числовая нагрузка берётся из external activity; упражнения и sets — из
   WorkoutSession. `ExternalActivity.classification` не меняется от связи.

## Considered alternatives

### Привязать generic Garmin title к Ahilej B

То же имя используется для A и других силовых. Создаёт ложное знание о
программе. Отклонено.

### Связывать только агентом в момент разговора

Использует контекст фразы, но пропускает запоздалый импорт и теряет
воспроизводимость решения. Отклонено.

### Подтверждённый режим записи и строгая взаимная уникальность

Даёт долговременный независимый сигнал сверх времени, работает для A/B и
занятий вне программы, переоценивает поздний импорт. Выбрано. Неоднозначные
случаи требуют вопроса вместо догадки.

## Consequences

- Однократное подтверждение общего режима Garmin позволяет связывать будущие
  подробные силовые без ручной классификации каждой activity.
- Точное время необходимо: `local_date`-only исторические сессии без общего
  source identity остаются несвязанными.
- Location не участвует в автоматическом доказательстве без сопоставимого
  provider signal; агент использует его лишь для ясного вопроса.
- Прежний trusted-title путь остаётся для действительно специфичных названий,
  но generic Garmin title не закрепляется за A или B.

## Verification

- Unit pin tests: подтверждённый/отозванный режим, A/B и вне программы,
  generic title без подтверждения, два близких кандидата, date-only, тип,
  время, место без provider location, classification conflict.
- PostgreSQL tests: Person isolation, поздний импорт, обе последовательности,
  исправления, explicit priority, optimistic lock, пересчёт старых связей,
  неоднозначность для неактивной версии программы и лимит истории.
- Проверить migration clean/upgrade/idempotency и длину всех PostgreSQL
  identifiers не более 63 UTF-8 bytes.
- Проверить один occurrence и неизменную numeric load ownership в
  DailyAssessment; independent Quality и Architecture Review.

## Related material

- [Предыдущее решение](20260925-link-proven-workout-sessions-to-external-activities.md)
- [Training and Performance](../wiki/domain/training-and-performance.md)
- TASK-0134
