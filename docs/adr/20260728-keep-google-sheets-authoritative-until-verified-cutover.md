---
id: "decisions-20260728-keep-google-sheets-authoritative-until-verified-cutover"
kind: adr
title: "Google Sheets остаётся authoritative source до проверенного переключения"
status: accepted
date: 2026-07-28
supersedes: []
superseded_by: null
tags:
  - "data-authority"
  - "migration"
---

# Google Sheets остаётся authoritative source до проверенного переключения

## Контекст

Google Sheets уже содержит рабочие данные, правила, аналитику и процессы. Если объявить новый backend авторитетным до проверенной миграции, можно потерять историю, происхождение данных или существующее поведение.

## Решение

Google Sheets остаётся единственным authoritative source рабочих fitness-данных до завершения инвентаризации, mapping, backfill, reconciliation, контролируемого dual-run, отчётности о целостности, определения критериев переключения, получения одобрения и подготовки rollback.

## Рассмотренные альтернативы

- Немедленное переключение: быстрее, но создаёт неприемлемый риск нарушения целостности и непрерывности.
- Постоянно оставить authority в Google Sheets: исключает риск миграции, но блокирует целевую архитектуру платформы и контролируемое владение данными приложением.

## Последствия

Во время миграции представления в PostgreSQL и backend считаются предварительными. Расхождения устраняются через явный reconciliation; отсутствующие данные не выдумываются. Authority изменяется только по утверждённому плану миграции и после переключения, подтверждённого доказательствами.

Пока не определены полный inventory, пороги reconciliation, длительность cutover, окно rollback и владелец разрешения расхождений.

## Проверка

- Правила source of truth и миграции явно заданы оператором 2026-07-28.

## Связанные материалы

- `../wiki/architecture/data-ownership.md`
- `../wiki/architecture/migration-strategy.md`
- `../wiki/roadmap/overview.md`
