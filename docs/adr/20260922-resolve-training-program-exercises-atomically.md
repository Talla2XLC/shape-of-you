---
id: "decisions-20260922-resolve-training-program-exercises-atomically"
kind: adr
title: "Атомарно разрешать упражнения при сохранении TrainingProgram"
status: accepted
date: 2026-09-22
supersedes: []
superseded_by: null
tags:
  - architecture
  - training
  - exercise-catalog
  - mcp
---

# Атомарно разрешать упражнения при сохранении TrainingProgram

## Context

После TASK-0125 Coach может естественно получить authority на сохранение полной
программы, но существующая команда принимает только готовые
`ExerciseVersion` UUID. Пользовательская программа может содержать точное новое
название, которого ещё нет в доступном каталоге. Отдельные операции поиска,
создания упражнения и сохранения программы оставили бы приватные упражнения при
ошибке программы и сделали бы повторы зависимыми от orchestration.

Training уже владеет `Exercise`, неизменяемыми `ExerciseVersion`, Person-private
видимостью, aliases и атомарным сохранением `TrainingProgram` под Person advisory
lock. Эти границы позволяют разрешить каталог в той же транзакции без новой
сущности или сервиса.

## Decision

1. `save_confirmed_training_program` принимает для каждого prescription либо
   существующий `exerciseVersionId`, либо строгий inline descriptor: принятое
   имя и только известные nullable характеристики упражнения. UUID-вариант
   остаётся обратно совместимым.
2. Все inline descriptors разрешаются внутри существующей Person-locked
   PostgreSQL-транзакции сохранения программы. Сначала валидируются программа и
   optimistic expectation, затем собираются результаты разрешения, и только
   после отсутствия неоднозначностей выполняются inserts.
3. Совпадение допускается только среди доступных current `ExerciseVersion` и
   разрешённых Person aliases. Имя/alias сравнивается после детерминированной
   Unicode- и whitespace-нормализации без fuzzy matching; каждая переданная
   известная характеристика должна точно совпасть. Похожее упражнение не
   подставляется.
4. Ноль точных совпадений создаёт Person-private `Exercise` и его неизменяемую
   версию 1 из descriptor. Этот путь не умеет создавать shared Exercise.
5. Более одного точного кандидата возвращает typed `needs_clarification` без
   catalog/program writes. Coach показывает безопасные человеческие различия,
   задаёт один короткий вопрос, сохраняет полную программу в conversation
   context и повторяет команду с выбранной внутренней ссылкой. UUID и названия
   transport/schema пользователю не показываются.
6. Одинаковые descriptors внутри команды memoize-ятся. Повтор команды под тем
   же Person lock заново находит уже созданную private current version и
   достигает существующего semantic program no-op.
7. Ошибка валидации, stale conflict, ошибка записи или активации откатывает и
   новые упражнения, и изменения программы. Успех объявляется только после
   последующего `get_training_context` и полного совпадения active snapshot.
8. На первом этапе не добавляются normalized-name column/index, pending proposal
   token или другая серверная сущность. Предсуществующие точные дубликаты
   намеренно дают неоднозначность. Persisted normalized key требует отдельного
   ADR при доказанной нагрузке или конкурентном writer-сценарии.

## Considered alternatives

### Отдельные MCP-команды поиска, создания и сохранения

Переиспользуют HTTP API, но разрывают транзакционную границу, оставляют orphan
упражнения после stale/validation failure и усложняют идемпотентность. Отклонено.

### Предварительное создание с компенсационным удалением

Добавляет destructive lifecycle и новые ошибки поверх versioned catalog;
компенсация не эквивалентна одной транзакции. Отклонено.

### Атомарное разрешение внутри confirmed save

Сохраняет один owner, один lock, одну транзакцию и одну точку optimistic
concurrency control. Выбрано.

### Durable proposal/resolution token

Потребовал бы хранения, expiry, cancellation и cleanup, но всё равно не
определял бы, к какому естественному ответу относится согласие. Conversation
snapshot и существующий expectation достаточны. Отклонено.

## Consequences

- Пользователь не заводит упражнения заранее, не ищет UUID и не повторяет
  программу.
- Приватные пользовательские названия не публикуются в shared catalog.
- Exact resolution без нового индекса читает доступный current catalog в
  транзакции; масштабирование этого чтения остаётся наблюдаемым ограничением.
- Ambiguity становится нормальным not-saved исходом, а не исключением или
  молчаливым выбором.
- Схема БД, deployable boundaries, dependencies, environment и Garmin /
  Intervals.icu не меняются.

## Verification

- Contract tests проверяют UUID и inline variants, strict unknown fields и
  typed ambiguity.
- Repository integration покрывает shared/private/alias exact match,
  inaccessible/unavailable exclusions, отсутствие fuzzy substitution, private
  create, повтор, concurrency, ambiguity zero writes и rollback без orphan.
- MCP tests требуют один человеческий вопрос без UUID, сохранение retained
  snapshot и save → read-back до сообщения об успехе.
- Full static, unit, integration и docs checks подтверждают сохранение прежних
  гарантий Training.

## Related material

- [Естественное принятие TrainingProgram](20260922-bind-natural-training-program-acceptance-to-latest-complete-proposal.md)
- [Атомарное сохранение подтверждённой программы](20260912-persist-confirmed-training-programs-through-one-mcp-command.md)
- [Training API](../wiki/api/training.md)
- [Training and Performance](../wiki/domain/training-and-performance.md)
- TASK-0126
