---
id: "decisions-20260731-use-layered-versioned-nutrition-catalog"
kind: adr
title: "Слоистый версионируемый каталог Nutrition и неизменяемые snapshots питания"
status: accepted
date: 2026-07-31
supersedes: []
superseded_by: null
tags:
  - "catalog"
  - "external-sources"
  - "nutrition"
  - "snapshots"
  - "versioning"
---

# Слоистый версионируемый каталог Nutrition и неизменяемые snapshots питания

## Контекст

Листы `Foods`, `Ingredients`, `Brands` и `Food_Ingredients` описывают
переиспользуемые справочные сведения, а `Meals` — принадлежащие `Person` факты
питания с зафиксированными calories и macros. Если сделать весь каталог
`Person`-scoped, одинаковые ингредиенты, бренды и продукты будут копироваться
для каждого человека, а подключение внешних справочников потребует повторной
нормализации в каждом персональном наборе.

Полностью глобальный изменяемый каталог создаёт обратную проблему: изменение
одной записи не должно переписывать историю питания всех пользователей,
персональные aliases и portions, а также private recipes не должны
автоматически становиться общими.

## Решение

Nutrition остаётся модулем одного deployable API и использует три разных слоя
владения:

1. Общий canonical catalog содержит стабильные `Brand`, `Ingredient` и `Food`
   identity и их immutable revisions. `FoodVersion` фиксирует nutrition basis,
   состав и ссылки на точные revisions ингредиентов.
2. Персональный слой хранит только ссылки и overlays: сохранение продукта в
   каталоге `Person`, alias, favorite/hidden state и preferred serving.
   Пользовательские продукты и recipes имеют явного владельца и private
   visibility; публикация не происходит автоматически.
3. `Meal` является неизменяемым person-owned fact. Его items могут ссылаться
   на доступную точную `FoodVersion`, но всегда сохраняют собственный typed
   snapshot количества, unit, calories, protein, fat и carbs. Correction
   создаёт новый полный `Meal` с `supersedes_id`.

Дневные nutrition totals строятся как query projection над текущими `Meal`
snapshots по `Person` и `local_date`. Они не становятся широким `DayRecord` и
на первом этапе не сохраняются как отдельная authority table.

Для внешних справочников вводится source-neutral ingestion boundary.
`CatalogSourceRecord` сохраняет provider key, external record id, время
получения, checksum, parser version, provenance, сведения о license/terms и
при необходимости private raw payload. Пара `(source, external_record_id)`
уникальна. Внешняя запись сначала становится staged candidate; связывание или
merge с canonical entity выполняется явно и проверяемо. Совпадение
нормализованного имени само по себе не разрешает автоматический merge.

Конкретный внешний API, dataset или scraper не утверждён. Предпочтение
отдаётся официальным API и открытым либо лицензированным datasets. Scraping
конкретного сайта требует отдельного review условий использования, rate
limits, attribution и качества данных. Создание `Meal` никогда не выполняет
синхронный remote scraping.

Person-scoped `SourceReference`, утверждённый для fitness facts, не
переиспользуется как identity общей catalog record. Fact provenance и catalog
ingestion provenance имеют разные ownership и lifecycle.

## Рассмотренные альтернативы

- Полностью person-scoped каталог: простые permissions, но дублирование
  одинаковых справочников и слабая основа для внешней нормализации. Отклонено.
- Полностью глобальный изменяемый каталог: минимум копий, но изменения
  переписывают смысл исторических ссылок и смешивают private data с общими
  definitions. Отклонено.
- Общий immutable catalog без персонального слоя: сохраняет историю, но не
  выражает aliases, portions, favorites и private recipes. Отклонено.
- Слоистый catalog, personal overlays и immutable meal snapshots: разделяет
  reference knowledge, персональные настройки и факты. Выбрано.

## Последствия

- Одинаковые общие ингредиенты, бренды и продукты не копируются для каждого
  `Person`.
- Изменение canonical catalog создаёт revision и не меняет старые meals.
- Meal snapshot намеренно дублирует небольшой набор nutrient values ради
  воспроизводимости истории.
- Private recipes требуют явной authorization независимо от UUID.
- Matching разных источников становится отдельным проверяемым workflow; полная
  автоматическая дедупликация по названию запрещена.
- Реальный внешний connector, scheduler и network access остаются отдельными
  задачами и не требуют нового deployable service заранее.

## Проверка

- Два `Person` могут ссылаться на одну shared `Ingredient` или `FoodVersion`
  без копирования canonical content.
- Изменение `FoodVersion` не изменяет snapshot существующего `Meal`.
- Private item недоступен другому `Person` без отдельного будущего sharing
  contract.
- Повторный import одного external id идемпотентен внутри `CatalogSource`.
- Два похожих имени из разных sources не объединяются без explicit match.
- Daily totals используют только current meal facts выбранного `Person` и
  `local_date`.

## Связанные материалы

- [Владение данными](../wiki/architecture/data-ownership.md)
- [Source of truth и authority](../wiki/data/source-of-truth-and-authority.md)
- [Карта извлечения домена](../wiki/domain/domain-extraction-map.md)
- [Независимые факты вместо DayRecord](20260728-prefer-independent-facts-over-broad-day-record.md)
- [Typed provenance и supersession](20260730-use-typed-provenance-and-append-only-supersession.md)
- [План Nutrition vertical](../../plans/2026/07/completed/2026-07-31-nutrition-catalog-meals-and-projections.md)
