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
- Границы privacy, consent, retention и deletion для wearable и health evidence.

### Недостаток свидетельств

- Privacy, retention и deletion body photo и notes до real-data import.
- Authoritative exercise catalog и identifiers упражнений.
- Нормализация timezone для timestamps устройств и пользовательского ввода.
- Поведение catalog snapshot при изменении состава продукта.
- Conflict policy для независимых будущих channels за пределами подтверждённого
  зеркала `Weight`/`Daily_Log.Weight`.

После разрешения вопросы удаляются или переформулируются здесь. Архитектурные решения с существенной стоимостью изменения фиксируются в ADR.

## Основания

Пробелы и конфликты обнаружены во всех 26 листах и описаны на страницах inventory, authority, provenance, lifecycle, extraction, aggregates и invariants.

## Решения

Identity владельца и correction semantics разрешены ADR: fitness facts
принадлежат `Person`, доступ предоставляется `User` через grant, correction
создаёт новый immutable fact с `supersedes_id`. Следующий domain review должен
сфокусироваться на Day lifecycle, versioning программы, privacy и policy
boundaries. Cardinality physical measurements, body session aggregate,
versioned physical goals и authority зеркала веса разрешены отдельным ADR.

## Открытые вопросы

Эта страница — канонический список нерешённых вопросов моделирования для DEV-027. Планы должны ссылаться сюда, а не копировать полный список. Для разрешённых вопросов с высокой стоимостью изменения требуется ADR.

## Связанные материалы

- [Кандидаты в агрегаты](candidate-aggregates.md)
- [Карта извлечения домена](domain-extraction-map.md)
- [Инвентаризация Google Sheets](../data/google-sheets-inventory.md)
- [Каталог ADR](../../adr/)
- [User, Person и права доступа](../../adr/20260730-separate-user-access-from-person-data-ownership.md)
- [Typed provenance и supersession](../../adr/20260730-use-typed-provenance-and-append-only-supersession.md)
- [Сеансы замеров тела и физические цели](../../adr/20260730-model-body-measurement-sessions-and-versioned-physical-goals.md)
