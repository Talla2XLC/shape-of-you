---
id: "domain-glossary"
kind: domain
title: "Доменный глоссарий"
status: draft
tags:
  - "domain"
  - "ubiquitous-language"
---

# Доменный глоссарий

## Кратко

Начальный словарь ubiquitous language выведен из подтверждённого baseline. Термины, требующие проверки источника, оставлены явно открытыми.

## Содержание

### Термины

- **User** — authentication identity аккаунта, который входит в систему и
  выполняет действия.
- **Person** — domain identity человека, которому принадлежат fitness-данные.
- **Person access grant** — явное право `User` работать с выбранным `Person` в
  роли `owner`, `editor`, `viewer` или `coach`.
- **Authoritative source** — система, значение которой считается operational truth для определённого набора данных. Сейчас эту роль для рабочих fitness-данных выполняет Google Sheets.
- **Atomic event** — одно нормализованное и независимо валидируемое observation или action, извлечённое из пользовательского ввода.
- **Closed day** — день, защищённый от автоматического неоднозначного изменения; точные правила закрытия пока открыты.
- **Provenance** — типизированные свидетельства происхождения факта, включая
  source channel, source reference, timestamps и confidence.
- **Dedupe key** — стабильная identity повторяемой операции внутри `Person` и
  source channel.
- **Supersession** — append-only замена ошибочного факта новым immutable fact с
  сохранением исходной записи и причины correction.
- **AI Timeline** — append-only chronology событий с источниками; corrections и reversals являются связанными событиями.
- **Readiness** — сведения о текущем восстановлении и способности переносить нагрузку; высокая readiness сама по себе не разрешает progression.
- **Load Risk** — оценка риска за несколько дней, способная ограничить progression.
- **Progression** — минимальное увеличение нагрузки для конкретного упражнения после повторного подтверждения успешного выполнения.
- **Deload** — состояние контролируемого снижения нагрузки.
- **Calibration** — настройка подходящей рабочей нагрузки при недостаточных или устаревших свидетельствах.
- **RIR** — число повторений в запасе, используемое как свидетельство тренировочного усилия.
- **Daily plan** — единый согласованный набор действий по питанию, тренировкам и восстановлению на день.
- **Dual-run** — контролируемый период совместной работы старого и нового путей данных с reconciliation до cutover.
- **Cutover** — утверждённая передача authority от Google Sheets новой платформе после выполнения критериев целостности.

## Основания

- Термины выведены из baseline, предоставленного оператором.

## Решения

- Глоссарий определяет язык, а не схемы данных.
- `User` и `Person` не являются взаимозаменяемыми терминами.

## Открытые вопросы

- Канонические определения workout, exercise, set, meal, ingredient, product, измерения состава тела, recovery observation и wearable sample.
- Точная семантика closed day и успешного выполнения.

## Связанные материалы

- `overview.md`
- `bounded-contexts.md`
- `../architecture/migration-strategy.md`
- `../../adr/20260730-separate-user-access-from-person-data-ownership.md`
- `../../adr/20260730-use-typed-provenance-and-append-only-supersession.md`
