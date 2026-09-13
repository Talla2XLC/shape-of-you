---
id: "decisions-20260913-expose-connected-activity-summaries-in-training-context"
kind: adr
title: "Показывать Coach сводки подключённых активностей через общий тренировочный контекст"
status: accepted
date: 2026-09-13
supersedes: []
superseded_by: null
tags:
  - architecture
  - training
  - coaching
  - integrations
  - mcp
---

# Показывать Coach сводки подключённых активностей через общий тренировочный контекст

## Context

Garmin через Intervals.icu уже импортирует в Training неизменяемые типизированные
`ExternalActivityFact`: название, время, продолжительность, дистанцию, нагрузку,
средний и максимальный пульс, устройство и подтверждённую Garmin-атрибуцию.
Повторная синхронизация не создаёт новый текущий факт, а изменение источника
создаёт correction chain.

Эти факты сейчас доступны только внутри `TrainingStore`. MCP-команда
`get_training_context`, которую Coach читает перед тренировочным советом,
возвращает активную `TrainingProgram` и последние детальные `WorkoutSession`, но
не возвращает импортированные активности. Поэтому пользователь вынужден вручную
сообщать о пробежке, уже сохранённой Shape of You.

`ExternalActivityFact` и `WorkoutSession` описывают разные уровни знания.
Внешняя активность является сводкой устройства и не содержит достоверных
упражнений, подходов, повторений, веса или RIR. Автоматическое преобразование
такой сводки в `WorkoutSession` исказило бы доменную модель и могло бы создать
ложную детальную тренировку.

## Decision

Расширить существующий MCP read `get_training_context` обязательным полем
`recentExternalActivities`. Отдельную MCP-команду и новый сервис не создавать.
Один Person-scoped read остаётся источником тренировочного контекста для Coach и
возвращает три явно разделённых вида знания:

1. активную программу как единственный `Planned` authority;
2. последние `WorkoutSession` как детальные подтверждённые выполненные факты;
3. последние подключённые активности как подтверждённые сводки внешнего
   устройства или сервиса.

В shared Training contract добавить безопасную типизированную проекцию
`ExternalActivitySummary`. Она содержит стабильный публичный `id`,
`occurredAt`, `localDate`, `timezone`, `name`, `durationSeconds`, nullable
`distanceMeters`, `trainingLoad`, `averageHeartRate`, `maximumHeartRate`,
`deviceName` и `garminAttributed`.

Проекция не содержит `personId`, `connectionId`, `consentId`, provider identity,
normalized checksum, credential, OAuth token или raw transport JSON. Поле
`garminAttributed` отражает только уже нормализованную подтверждённую атрибуцию и
не превращает provider transport в доменную модель.

Существующий `historyLimit` ограничивает независимо обе исторические коллекции:
не более указанного количества текущих `WorkoutSession` и не более указанного
количества текущих `ExternalActivitySummary`. Ограничение применяется в SQL, а
не после неограниченного чтения всех активностей.

`recentSessions` и `recentExternalActivities` не объединяются автоматически.
Coach использует внешнюю сводку как достаточное свидетельство пробежки, поездки
или общей нагрузки и не просит пользователя повторно прислать скриншот или
пересказать уже импортированный факт. Внешняя сводка не является основанием
выдумывать упражнения или автоматически записывать `WorkoutSession`. Если две
коллекции могут описывать одно физическое событие, Coach не суммирует их как две
отдельные тренировки без дополнительного подтверждения идентичности.

MCP operational instructions и описание `get_training_context` требуют читать
этот контекст перед советом о тренировке или восстановлении и различать
план, детальную выполненную тренировку и внешнюю сводку. Ошибка чтения остаётся
fail-closed: Coach не заменяет данные памятью чата и не утверждает, что
синхронизации не было.

## Considered alternatives

### Добавить отдельную MCP-команду `list_connected_activities`

Отклонено. Контракт был бы понятным, но Coach должен был бы помнить о втором
чтении наряду с `get_training_context`. Это сохраняет исходный риск: импорт есть,
а модель не вызвала дополнительный инструмент и попросила ручное сообщение.

### Преобразовывать внешние активности в `WorkoutSession`

Отклонено. Intervals activity summary не содержит точных упражнений и подходов.
Такое преобразование смешало бы разные агрегаты, создало ложную детализацию и
усложнило бы correction, deduplication и erasure semantics.

### Объединить внешние и ручные факты в одну автоматически сопоставленную ленту

Отложено. Надёжное связывание требует формального identity/correlation policy для
времени, типа активности и источников. Для текущего пользовательского результата
достаточно двух явно разделённых коллекций и запрета двойного учёта сомнительных
совпадений.

### Создать отдельный Coach или Integration service

Отклонено как ненужная deployable boundary. Данные уже принадлежат Training, а
MCP adapter уже живёт внутри существующего API.

## Consequences

- После обычной синхронизации Garmin -> Intervals.icu -> Shape of You Coach
  увидит импортированную пробежку без скриншота и ручного напоминания.
- Активная программа, точные силовые сессии и внешние сводки остаются
  семантически различимыми.
- Имя `get_training_context`, его input и OAuth scope не меняются; output
  получает одно additive typed field.
- Существующие import, correction, deduplication, consent, disconnect и erasure
  lifecycle не меняются.
- Миграция базы, новая зависимость, secret, frontend change или новый deployable
  не требуются.
- Полное автоматическое сопоставление внешней и вручную записанной тренировки
  остаётся отдельной будущей задачей, если практическое двойное представление
  окажется проблемой.

## Verification

- Contract tests проверяют строгую безопасную `ExternalActivitySummary` и оба
  варианта `TrainingContext`.
- Repository tests проверяют Person isolation, SQL limit и current-only
  correction projection.
- Service и MCP tests проверяют совместный bounded read программы, сессий и
  внешних активностей при active и absent программе.
- Fake-provider integration test проводит activity через существующий import и
  доказывает её видимость в `get_training_context`; повторная синхронизация
  остаётся одним текущим фактом.
- Policy tests проверяют отсутствие просьбы о скриншоте для уже импортированной
  активности, запрет выдуманных sets и запрет двойного учёта сомнительного
  совпадения.
- API lint, typecheck, build, unit/integration tests, документационный validator,
  `git diff --check`, PostgreSQL identifier guard и `4dt-board validate` проходят
  до handoff.

## Related material

- [Training API](../wiki/api/training.md)
- [Coaching and Decision Support](../wiki/domain/coaching-and-decision-support.md)
- [Garmin through Intervals.icu](20260907-connect-garmin-through-intervals-icu.md)
- [Confirmed TrainingProgram MCP command](20260912-persist-confirmed-training-programs-through-one-mcp-command.md)

