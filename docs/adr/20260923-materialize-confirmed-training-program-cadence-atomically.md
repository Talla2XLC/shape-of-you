---
id: "decisions-20260923-materialize-confirmed-training-program-cadence-atomically"
kind: adr
title: "Атомарно материализовать подтверждённый cadence без повторной передачи TrainingProgram"
status: accepted
date: 2026-09-23
supersedes: []
superseded_by: null
tags:
  - architecture
  - training
  - coaching
  - mcp
---

# Атомарно материализовать подтверждённый cadence без повторной передачи TrainingProgram

## Context

TASK-0125 закрепила естественное принятие последней полной опубликованной
версии программы, а TASK-0127 добавила typed rolling cadence и вычисляемый
`NextTrainingStep`. Уже существующие неизменяемые версии намеренно не получили
автоматический backfill: без cadence они возвращают `schedule_unavailable`.

Live-проверка выявила разрыв между решениями. Coach показал активную legacy
программу вместе с полным подтверждённым чередованием, получил обычное
«Подходит, делаем так», но оставил старую версию активной и затем сам назвал
следующую тренировку. Пользователь не должен понимать различие между заметкой
и typed cadence, просить создать новую версию или повторять техническое
описание расписания.

Существующая команда сохранения принимает полный snapshot. Использовать её для
одного cadence возможно, но model orchestration пришлось бы повторно передать
каждое упражнение, порядок, нагрузку и progression. Это создаёт ненужный риск
изменения полей, которые пользователь не редактировал.

## Decision

1. Training предоставляет узкую Person-owned команду материализации cadence.
   Её вход содержит ожидаемую authority активной программы и полное typed
   расписание, однозначно принятое пользователем.
2. Команда под существующей Person lock в одной транзакции перечитывает
   активный `TrainingProgramVersion`, проверяет optimistic expectation и
   ссылки cadence на позиции workouts.
3. Backend копирует имя, note, workouts, prescriptions, exercise versions,
   нагрузки, repetition targets, RIR и progression из активной версии без
   участия модели. Единственное содержательное изменение — подтверждённый
   cadence.
4. Результат создаётся как новая неизменяемая версия и атомарно становится
   активным. Исходная версия не изменяется.
5. Если активная версия уже содержит семантически тот же cadence, команда
   возвращает semantic duplicate/no-op и не создаёт новую версию.
6. Если active program/version/lock отличается от ожидаемого, команда
   fail-closed завершается stale conflict. Автоматическая перезапись новой
   активной версии запрещена.
7. Coach вызывает команду только после однозначного естественного принятия
   последней полной опубликованной версии cadence. «Да», «го», «подходит» и
   «делаем так» не являются magic phrases; важна однозначная связь с
   предложением. Вопрос, сомнение, альтернатива, частичная правка или ответ на
   другой вопрос не дают authority.
8. После команды Coach в том же ходе перечитывает `TrainingContext` и
   `DailyAssessment`. Активной версией и конкретным следующим действием можно
   назвать только совпадающий PostgreSQL read-back и backend-owned projection.
9. Tool/API/schema names не показываются пользователю. Пользователь не
   повторяет программу и не подтверждает отдельные упражнения.
10. Note не парсится, legacy версии не обновляются молча, generic patch,
    proposal token и новая persisted draft entity не создаются.

## Considered alternatives

### Попросить пользователя явно описать structured cadence

Переносит внутреннее устройство persistence на пользователя и воспроизводит
наблюдаемый UX-дефект. Отклонено.

### Парсить note или выполнить silent backfill

Свободный текст не является typed authority. Такой путь может додумать
семантику и нарушает неизменяемость и explicit consent. Отклонено.

### Усилить только model-facing инструкцию и повторно отправлять полный snapshot

Не требует новой команды, но модель обязана реконструировать все неизменяемые
поля ради одного cadence. Ошибка или пропуск может изменить либо заблокировать
не связанную часть программы. Отклонено в пользу backend clone.

### Persisted proposal token или generic partial update

Token не доказывает, к чему относилось естественное согласие, а generic patch
расширяет mutable surface и lifecycle. Отклонено как лишняя сложность.

### Узкая атомарная команда backend clone + cadence

Сохраняет естественное принятие на conversational boundary и гарантирует на
Training boundary, что кроме cadence ничего не меняется. Выбрано.

## Consequences

- Обычного естественного принятия достаточно и для legacy active program.
- Модель не передаёт заново упражнения и prescriptions.
- Появляется один новый скрытый mutation contract и соответствующие service и
  repository методы.
- Существующая relational schema cadence достаточна; новая migration,
  dependency, service, queue, scheduler или env не нужны.
- Версионирование, Person ownership, atomicity, duplicate no-op и stale
  protection сохраняются.
- Live-проверка должна доказать создание typed successor и API-owned следующий
  шаг, а не только правдоподобный текст Coach.

## Verification

- Repository integration test сравнивает все скопированные workout и
  prescription поля до и после материализации.
- Integration tests проверяют atomic successor activation, duplicate/no-op,
  retry и stale conflict.
- MCP fixtures проверяют естественное принятие, неоднозначные ответы,
  обязательный read-back и отсутствие внутренних имён в ответе.
- Training/DailyAssessment tests доказывают, что после materialization
  `NextTrainingStep` вычисляется из сохранённого cadence.
- Full relevant unit, PostgreSQL, static и documentation checks остаются
  зелёными.

## Related material

- [Естественное принятие TrainingProgram](20260922-bind-natural-training-program-acceptance-to-latest-complete-proposal.md)
- [Training-owned rolling cadence](20260922-own-rolling-training-cadence-and-next-step-in-training.md)
- [Training API](../wiki/api/training.md)
- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
- TASK-0128
