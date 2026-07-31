---
id: "domain-meal"
kind: domain
title: "Meal"
status: draft
tags:
  - "facts"
  - "meals"
  - "nutrition"
  - "snapshots"
---

# Meal

## Кратко

`Meal` — принадлежащий `Person` immutable fact питания. Он может ссылаться на
точную `FoodVersion`, но всегда хранит собственный nutrient snapshot, поэтому
история не зависит от последующих редакций catalog.

## Содержание

Meal фиксирует `occurredAt`, вычисленную `localDate`, IANA timezone, kind,
optional description/note/photo reference, typed `SourceReference`,
person/source-scoped `dedupeKey` и один или несколько items.

Каждый item хранит label, quantity, unit, calories, protein, fat и carbs.
Ссылка на `FoodVersion` optional: migration или manual intake может сохранить
полный snapshot без catalog identity. Totals вычисляются из item snapshots и
не читают current catalog state.

Correction не обновляет исходный Meal. Она создаёт полный replacement с
`supersedesId` и обязательной причиной. Current list и daily totals исключают
superseded facts, а history возвращает всю цепочку от оригинала до текущей
редакции.

Daily nutrition totals — query projection по `Person` и `localDate`.
Отдельная authority table и широкий `DayRecord` не создаются.

## Основания

- Лист `Meals` хранит calories и macros как значения конкретного intake.
- [ADR о слоистом Nutrition catalog](../../adr/20260731-use-layered-versioned-nutrition-catalog.md).
- [ADR о typed provenance и supersession](../../adr/20260730-use-typed-provenance-and-append-only-supersession.md).

## Решения

- Snapshot является намеренной исторической фиксацией, а не второй catalog
  authority.
- Dedupe действует в scope `(Person, source channel, dedupeKey)`.
- Daily totals суммируют только current facts выбранной локальной даты.
- Correction chain остаётся append-only.

## Открытые вопросы

- Nutrition targets и remaining macros.
- Media ownership и lifecycle для `photoMediaId`.
- Правила закрытого дня после проектирования `DayClosure`.

## Связанные материалы

- [Nutrition catalog](nutrition-catalog.md)
- [API Meal](../api/meals.md)
- [Provenance и identifiers](../data/provenance-and-identifiers.md)
