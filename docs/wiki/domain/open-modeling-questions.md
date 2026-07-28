---
id: "domain-open-modeling-questions"
kind: domain
title: "Открытые вопросы моделирования"
status: draft
tags:
  - "domain"
  - "draft"
  - "questions"
---

# Открытые вопросы моделирования

## Кратко

Вопросы, которые необходимо решить до финального проектирования доменной архитектуры, schema, API или migration. Они сгруппированы по стоимости изменения и недостатку свидетельств.

## Содержание

### Высокая стоимость изменения

- Окончательное имя, владение и invariants `DayClosure` или `JournalDay`.
- Versioning и acceptance semantics для тренировочных prescriptions.
- Identity и correction semantics для независимо принадлежащих фактов.
- Границы privacy, consent, retention и deletion для wearable и health evidence.

### Недостаток свидетельств

- Cardinality измерений веса и тела за один день.
- Authoritative exercise catalog и identifiers упражнений.
- Нормализация timezone для timestamps устройств и пользовательского ввода.
- Поведение catalog snapshot при изменении состава продукта.
- Conflict policy для конкурирующих фактов из разных channels.

После разрешения вопросы удаляются или переформулируются здесь. Архитектурные решения с существенной стоимостью изменения фиксируются в ADR.

## Основания

Пробелы и конфликты обнаружены во всех 26 листах и описаны на страницах inventory, authority, provenance, lifecycle, extraction, aggregates и invariants.

## Решения

Ни один открытый вопрос не разрешён предположением. Рекомендуемая следующая архитектурная задача — сфокусированный domain review authority, семантики DayRecord, versioning программы, identity и privacy до работы над ERD или API.

## Открытые вопросы

Эта страница — канонический список нерешённых вопросов моделирования для DEV-027. Планы должны ссылаться сюда, а не копировать полный список. Для разрешённых вопросов с высокой стоимостью изменения требуется ADR.

## Связанные материалы

- [Кандидаты в агрегаты](candidate-aggregates.md)
- [Карта извлечения домена](domain-extraction-map.md)
- [Инвентаризация Google Sheets](../data/google-sheets-inventory.md)
- [Каталог ADR](../../adr/)
