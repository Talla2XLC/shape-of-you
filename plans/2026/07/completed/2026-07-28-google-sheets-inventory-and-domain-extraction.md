---
title: Инвентаризация Google Sheets и карта извлечения доменной модели
status: completed
created: 2026-07-28
updated: 2026-07-28
related_roadmap_items:
  - DEV-027
---

# Инвентаризация Google Sheets и карта извлечения доменной модели

## Цель

Получить доказательную карту текущей системы Google Sheets Fitness Tracker до
проектирования backend-модулей, сервисов, API и PostgreSQL schema.

## Контекст

Google Sheets остаётся авторитетным источником операционных fitness-данных до
проверенного dual-run и cutover. Draft baseline по продукту, предметной области
и архитектуре принят, но предлагаемые bounded contexts и MVP нельзя изменять
без фактической инвентаризации таблицы.

## Текущий статус

Исходная таблица однозначно подтверждена по открытому документу и метаданным
Google Sheets:

- название: `Fitness Tracker`;
- spreadsheet ID: `1yUPcU-2RGIOPyfz8HzR6NSHuztwps81PHbzlGzcK2Ik`;
- locale: `ru_RU`;
- timezone: `Europe/Moscow`;
- фактическое количество листов: 26.

Инвентаризация и карта извлечения находятся в canonical Markdown Wiki.
Содержательный review принят. Repository and Documentation Baseline завершён;
результаты готовы как baseline для проектирования DEV-023.

## Ограничения

- Не придумывать колонки, формулы, связи и правила.
- Недоступные сведения обозначать как `Unknown`.
- Гипотезы обозначать как `Assumption`.
- Не превращать формулу Sheets автоматически в domain rule.
- Не превращать каждый лист в PostgreSQL table.
- Не превращать каждый engine в service.
- Не создавать финальную ER-модель, OpenAPI или migration scripts.
- Не создавать код, package manifests, Docker, базы данных, Drizzle schemas и
  deployable services.
- Не выполнять Git commit.
- Не переносить план в `completed/` до review оператора.

## Объём работ

- Метаданные и bounded reads всех подтверждённых листов.
- Заголовки, формулы, идентификаторы, ссылки, статусы, даты, provenance,
  lifecycle и integrity constraints.
- Классификация каждого листа и mechanism.
- Domain extraction map.
- Candidate entities, value objects, aggregates, events, policies,
  projections, workflows и adapters.
- Проверяемые invariants.
- Duplicates, overloaded responsibilities, migration risks и open questions.
- Предложения по bounded contexts только на основе доказательств.
- Architecture Review.

## Вне объёма работ

- Изменение исходной Google Sheets.
- Реализация backend, web, mobile или migration.
- Окончательное утверждение domain model и bounded contexts.
- Сопоставление aggregates с deployable services.

## Этапы

1. Получить точный URL или spreadsheet ID и проверить metadata.
2. Сверить фактический перечень листов с известным перечнем.
3. Для каждого листа прочитать bounded header/data/formula ranges.
4. Зафиксировать grain, identifiers, authority, derivation, lifecycle,
   provenance, dependencies и integrity.
5. Сформировать Wiki inventory и domain extraction map.
6. Сформулировать candidate model и invariants.
7. Проверить duplicates, migration risks и возможные изменения bounded
   contexts.
8. Выполнить валидацию и Architecture Review.
9. Передать результаты оператору, оставив план активным до review.

## Критерии готовности

- Точная исходная таблица подтверждена.
- Изучены все фактически существующие листы в scope.
- Каждый вывод ссылается на прочитанные headers, cells или formulas либо
  обозначен как `Unknown`/`Assumption`.
- Созданы или обновлены все запрошенные Wiki-страницы.
- Bounded contexts и candidate model остаются draft.
- Canonical Wiki и ADR проходят repository validation.
- Architecture Review выполнен.
- План перенесён в `completed/` после принятого review.

## Проверки

- Google Sheets metadata read.
- Bounded value и formula reads по каждому листу.
- Сверка inventory с фактическими sheet properties.
- Точечное чтение созданных Wiki-страниц.
- `scripts/validate-docs.ps1`.
- Проверка физического дерева и `git status --short`.

## Риски

- Выбрать одноимённую или чужую таблицу.
- Сделать выводы по названиям листов без чтения данных.
- Принять derived projection за authoritative fact.
- Перенести spreadsheet structure механически в PostgreSQL.
- Превратить технические workflow в domain entities или services.
- Раскрыть персональные fitness-данные сверх минимально необходимого объёма.

## Стратегия восстановления

Исходная Google Sheets используется только для чтения. Wiki-выводы, которые
окажутся ошибочными после дополнительного чтения, исправляются напрямую в
canonical Markdown с сохранением открытых вопросов. Архитектурные решения не
изменяются без отдельного review и ADR.

## Результат

Подготовлена доказательная инвентаризация 26 листов, карта источников истины,
идентификаторов, provenance, integrity и lifecycle, а также draft-карта
извлечения доменной модели, candidate aggregates, invariants и открытые вопросы.
Содержательный review принят. Результаты остаются draft baseline для
последующего моделирования; принятые ограничения вынесены в canonical ADR.

## Architecture Review

- **Избыточная сложность:** механическое соответствие «лист → таблица → модуль
  → сервис» отклонено. Двадцать шесть листов сведены к фактам, справочникам,
  политикам, проекциям, workflow и governance-данным.
- **Преждевременная микросервисность:** не предлагается. Все найденные границы
  остаются логическими кандидатами внутри modular monolith; deployable
  boundaries не проектировались.
- **Domain-Driven Design:** факты отделены от проекций и технических workflow;
  candidate aggregates определены по предполагаемым consistency boundaries, а
  не по структуре spreadsheet. Окончательное владение остаётся открытым.
- **Дублирование документации:** план хранит только scope, ход и результат;
  детальная инвентаризация находится в Wiki; открытые вопросы канонически
  собраны в `domain/open-modeling-questions.md`; ADR не создавался, потому что
  новое решение не принято.
- **Упрощение без потери масштабируемости:** обнаружена потенциально более
  простая альтернатива — не делать широкий `DayRecord` владельцем питания,
  тренировок, измерений и coaching-выводов, а хранить независимые факты и
  собирать дневное представление как projection. Компромисс: потребуется явная
  оркестрация закрытия дня и согласованные read models, зато снижается связанность
  и исчезает смешение источников истины.

Architecture Review не изменил ранее согласованную архитектуру. Альтернатива и
её компромиссы должны быть обсуждены до обновления bounded contexts и
оформления ADR.

## Валидация

- `scripts/validate-docs.ps1`: успешно, 23 Wiki-страницы, 12 ADR,
  35 уникальных ID.
- Managed Wiki сохраняется как frozen legacy copy и не является источником
  проектных знаний.
- `4dt-board validate`: `ready`, замечаний нет.
- `4dt-sources registry validate`: `ready`, ошибок и предупреждений нет.
- `4dt-sources index check`: `ready`, замечаний нет.
- `4dt-memory doctor`: `ready`.
- Исходная Google Sheets не изменялась.
- Код, сервисы, package manifests, Docker, БД, migrations и commit не создавались.

## Отклонения от плана

Поиск через подключённый Google Drive не обнаружил таблицу по названию. Точный
документ был найден в уже открытой авторизованной сессии Google Sheets, после
чего его ID и состав листов подтверждены через Google Sheets metadata read.
Отклонение не повлияло на read-only характер исследования.

## Ссылки на Wiki

- `data/google-sheets-inventory.md`
- `data/source-of-truth-and-authority.md`
- `data/provenance-and-identifiers.md`
- `data/integrity-and-lifecycle.md`
- `domain/domain-extraction-map.md`
- `domain/candidate-aggregates.md`
- `domain/invariants.md`
- `domain/open-modeling-questions.md`

## Ссылки на ADR

- `decisions/20260728-keep-google-sheets-authoritative-until-verified-cutover.md`
- `decisions/20260728-api-or-event-only-cross-service-communication.md`
- `decisions/20260728-deployable-service-autonomy.md`

## Закрытие

Инвентаризация, domain extraction, validation и Architecture Review приняты.
Незавершённых работ в scope плана нет. Следующий этап — отдельное
проектирование backend Shape of You в рамках DEV-023.
