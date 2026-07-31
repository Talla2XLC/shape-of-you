---
id: "decisions-20260731-separate-shared-reference-definitions-from-person-owned-state"
kind: adr
title: "Разделение shared reference definitions, персональных overlays и person-owned state"
status: accepted
date: 2026-07-31
supersedes: []
superseded_by: null
tags:
  - "data-ownership"
  - "external-sources"
  - "reference-data"
  - "versioning"
---

# Разделение shared reference definitions, персональных overlays и person-owned state

## Контекст

Решение о `Person` как владельце fitness-данных защищает measurements,
observations, plans и decisions от смешения с authentication identity. Однако
механическое применение `person_id` ко всем сущностям будущих verticals
создало бы копии одинаковых ingredients, exercises, device models и policy
definitions для каждого человека.

Обратная крайность — единое изменяемое глобальное состояние — позволила бы
одному пользователю менять историю, настройки или private content других
людей. Универсальная таблица справочников или JSONB entity store скрыла бы
различия доменных типов и ослабила constraints.

## Решение

Во всех bounded contexts различать четыре ownership-класса:

1. **Shared reference definitions** — переиспользуемые определения продукта,
   упражнения, provider/device model, policy definition и другие общие
   concepts. Они имеют stable identity и immutable typed versions.
2. **Person overlays и private items** — aliases, favorites, preferred
   parameters, availability и private custom definitions. Они принадлежат
   `Person`, ссылаются на shared definition либо имеют private visibility и не
   публикуются автоматически.
3. **Person-owned state** — facts, observations, plans, targets,
   recommendations, decisions, connections, consents и media metadata. Они
   обязательно получают `person_id` и следуют person access rules.
4. **External source records** — source-specific identity, checksum, parser
   version, license/terms и ingestion lifecycle. Они отделены от canonical
   domain identity и от person-scoped provenance фактов.

Правило является cross-context ownership invariant, но не создаёт generic
catalog framework. Nutrition, Training, Recovery и Coaching используют
типизированные module-owned tables, contracts и adapters. Exact entity schema,
version lifecycle и matching policy утверждаются в плане конкретной vertical.

Применение к известным областям:

- Nutrition: shared versioned brands, ingredients и foods; person overlays и
  private recipes; person-owned meals со snapshots.
- Training: shared versioned exercise definitions; person aliases и доступное
  equipment; person-owned program versions, sessions, performed sets, records
  и progression decisions.
- Recovery: shared provider/model/capability definitions; person-owned device
  connection, consent, device instance, observations и retention state.
- Coaching и business policy: shared immutable policy definitions/versions;
  person-owned targets, разрешённые overrides, activation и decisions,
  закреплённые за точной policy version и parameter snapshot.

Media objects и metadata не становятся shared reference data. Глобальная
дедупликация private binary objects между `Person` запрещена до отдельного
privacy/security решения: она связывает authorization, deletion и object
lifecycle разных владельцев.

## Рассмотренные альтернативы

- Определять ownership независимо в каждой vertical без общего правила:
  гибко, но повторяет discovery и допускает несовместимые решения. Отклонено.
- Делать все сущности person-scoped: просто для authorization, но создаёт
  дублирование shared knowledge. Отклонено.
- Делать все definitions глобально изменяемыми: устраняет копии, но ломает
  history и private ownership. Отклонено.
- Создать универсальную catalog/facts/policy platform: единообразно, но
  преждевременно и ослабляет typed constraints. Отклонено.
- Общий ownership invariant с отдельными typed реализациями: устраняет
  повторяющуюся ошибку без generic framework. Выбрано.

## Последствия

- Person ownership применяется к данным человека, но не к переиспользуемому
  reference knowledge.
- Shared revisions нельзя менять скрытым overwrite.
- Personal overlay не копирует canonical content и не меняет shared revision.
- External provider identity не попадает в core domain columns.
- Каждая vertical должна проверять shared/private/access constraints на
  database и application layers.
- Exact schemas остаются отдельными архитектурными решениями, поэтому это ADR
  не разрешает реализацию Training, Recovery или Coaching.

## Проверка

- Architecture Review каждой vertical классифицирует entities по четырём
  ownership-классам.
- Одинаковая shared definition может использоваться несколькими `Person` без
  копирования content.
- Private item и person state недоступны без соответствующего grant.
- Historical fact или decision закреплён за точной reference/policy version.
- Source records идемпотентны внутри source identity и не merge по одному name.
- В schema не появляется универсальная polymorphic entity table.

## Связанные материалы

- [User, Person и права доступа](20260730-separate-user-access-from-person-data-ownership.md)
- [Слоистый Nutrition catalog](20260731-use-layered-versioned-nutrition-catalog.md)
- [Владение данными](../wiki/architecture/data-ownership.md)
- [Bounded contexts](../wiki/domain/bounded-contexts.md)
- [План завершения DEV-023](../../plans/2026/07/2026-07-29-complete-dev-023-backend-domain-capabilities.md)
