---
id: "domain-nutrition-catalog"
kind: domain
title: "Nutrition catalog"
status: draft
tags:
  - "catalog"
  - "nutrition"
  - "ownership"
  - "versioning"
---

# Nutrition catalog

## Кратко

Nutrition catalog хранит переиспользуемые `Brand`, `Ingredient` и `Food`
без копирования одинакового содержания для каждого `Person`. Общие и private
identity имеют immutable versions, а персональные предпочтения хранятся
отдельным overlay.

## Содержание

`Brand`, `Ingredient` и `Food` состоят из stable identity и current immutable
version. Новая редакция добавляет version и переключает root через optimistic
`lockVersion`; прежняя version не обновляется. `FoodVersion` фиксирует
nutrition basis и ordered composition со ссылками на точные
`IngredientVersion`.

Identity имеет visibility:

- `shared` не имеет `ownerPersonId` и доступна разным `Person`;
- `private` имеет обязательного владельца и доступна только ему.

Shared `FoodVersion` может ссылаться только на shared `BrandVersion` и
`IngredientVersion`. Это не позволяет общей definition скрыто зависеть от
private content. Private food может использовать доступные shared definitions
и private definitions того же владельца.

`FoodOverlay` принадлежит `Person` и хранит alias, favorite/hidden и optional
preferred quantity/unit. Overlay не копирует canonical name, composition или
nutrients и не изменяет shared version.

External ingestion подготовлен через `CatalogSource` и
`CatalogSourceRecord`. Пара `(source, externalRecordId)` уникальна, raw
snapshot остаётся private ingestion evidence, а status принимает `staged`,
`matched` или `rejected`. Конкретный adapter, scraper, scheduler и автоматический
merge не реализованы.

## Основания

- Листы `Brands`, `Ingredients`, `Foods` и `Food_Ingredients`.
- [ADR о слоистом Nutrition catalog](../../adr/20260731-use-layered-versioned-nutrition-catalog.md).
- [ADR о shared reference definitions](../../adr/20260731-separate-shared-reference-definitions-from-person-owned-state.md).

## Решения

- Не создавать персональную копию shared catalog content.
- Не менять version скрытым overwrite.
- Не объединять external records только по совпавшему имени.
- Не создавать отдельный catalog service до появления независимого lifecycle
  и измеримого operational driver.

## Открытые вопросы

- Moderation и write authorization shared catalog до multi-user runtime.
- Выбор внешних sources, лицензий, attribution и matching workflow.
- Conversion rules между `g`, `ml`, `serving` и `piece`.

## Связанные материалы

- [Meal](meal.md)
- [API Nutrition catalog](../api/nutrition-catalog.md)
- [Владение данными](../architecture/data-ownership.md)
- [Source of truth и authority](../data/source-of-truth-and-authority.md)
