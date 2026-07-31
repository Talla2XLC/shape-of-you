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
- Границы privacy, consent, retention и deletion для wearable и health evidence.

### Недостаток свидетельств

- Privacy, retention и deletion body photo и notes до real-data import.
- Выбор внешнего Exercise catalog source, его license/attribution, quality и
  moderation policy.
- Нормализация timezone для timestamps устройств и пользовательского ввода.
- Conflict policy для независимых будущих channels за пределами подтверждённого
  зеркала `Weight`/`Daily_Log.Weight`.
- Выбор внешних Nutrition catalog sources, их license/attribution, quality,
  rate limits и moderation policy.
- Actor roles и write authorization shared Nutrition catalog до multi-user
  runtime; текущий synthetic context не является production moderation model.

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
Shared Nutrition catalog, person overlays, private items, immutable meal
snapshots и external ingestion boundary также разрешены отдельным ADR.
Cross-context ownership shared reference definitions, person overlays,
person-owned state и external source records разрешён отдельным ADR; exact
schema Training, versioning программы, whole-session correction и record
ordering разрешены отдельным ADR. Exact schemas Recovery и Coaching остаются
решениями соответствующих verticals.

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
- [Слоистый Nutrition catalog](../../adr/20260731-use-layered-versioned-nutrition-catalog.md)
- [Shared reference definitions и person-owned state](../../adr/20260731-separate-shared-reference-definitions-from-person-owned-state.md)
- [Версионируемые программы и факты тренировок](../../adr/20260731-model-versioned-training-programs-and-immutable-workout-sessions.md)
