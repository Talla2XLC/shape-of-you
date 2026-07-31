---
title: Реализация Training and Performance
status: completed
created: 2026-07-31
updated: 2026-07-31
related_roadmap_items:
  - DEV-023
related_board_items:
  - TASK-0017
---

# Реализация Training and Performance

## Цель

Добавить в существующий NestJS API вертикаль тренировок: общий
версионируемый справочник упражнений, персональные версии программы,
неизменяемые тренировочные сессии с отдельными подходами, личные рекорды и
кандидаты прогрессии как вычисляемые представления.

## Утверждённая архитектура

- Решение зафиксировано в
  `docs/adr/20260731-model-versioned-training-programs-and-immutable-workout-sessions.md`.
- Shared `Exercise` и immutable `ExerciseVersion` не копируются по `Person`.
- Overlays и private exercises имеют явного владельца.
- `TrainingProgramVersion` неизменяема; у `Person` действует не более одной
  явно активированной версии.
- `WorkoutSession`, `PerformedExercise` и `PerformedSet` образуют полный
  неизменяемый факт выполнения.
- Correction заменяет всю сессию и сохраняет цепочку supersession.
- Personal records и progression candidates вычисляются запросом.
- Принятие progression candidate создаёт новую program version.
- Source-neutral staging не подключает внешний provider или scraper.

## Объём

### Входит

- Runtime JSON Schemas и TypeScript contracts в `packages/contracts`.
- Shared/private exercise identity, immutable revisions и person overlays.
- Source-neutral `ExerciseCatalogSource` и `ExerciseCatalogSourceRecord` без
  сетевого адаптера.
- Person-owned training programs, immutable versions, ordered workouts и
  prescriptions.
- Явная активация версии с защитой от двух активных версий.
- Workout session create/read/list/history/correction.
- Performed exercise snapshots и отдельные performed sets.
- Query личного рекорда по упражнению и списка рекордов.
- Query кандидатов прогрессии и команда принятия через новую program version.
- Additive Drizzle migration, OpenAPI, unit и PostgreSQL integration tests.
- Обновление canonical Wiki после принятия реализации.

### Не входит

- Перенос реальных строк Google Sheets и изменение workbook.
- Конкретный внешний API, dataset, scraper или автоматический merge.
- Recovery/readiness, load-risk и coaching policies.
- Natural-language intake, wearable integration и media upload.
- Scheduler, queue, worker, microservice или generic rules engine.
- Сохраняемые таблицы personal records и progression projections до
  подтверждённой необходимости.

## Этапы

1. Зафиксировать точные contracts: units, числовые границы, статусы, endpoint
   paths и форму полной correction.
2. Добавить contracts и чистые доменные проверки.
3. Добавить schema и одну additive migration с ownership, version и activation
   constraints.
4. Реализовать repositories и transactions для справочника и программ.
5. Реализовать сессии, отдельные подходы, идемпотентность и corrections.
6. Реализовать запросы рекордов и кандидатов прогрессии без изменения
   действующей программы.
7. Подключить NestJS module, controllers и OpenAPI.
8. Добавить синтетические unit и integration vectors без персональных данных.
9. Проверить чистую миграцию и обновление от текущей schema.
10. Провести независимый Quality Review и Architecture Review.
11. После принятия обновить current-state Wiki и перенести план в
    `completed/`.

## Критерии приёмки

1. Два `Person` используют одну shared `ExerciseVersion` без копирования её
   содержимого.
2. Private exercise и overlay не раскрываются другому `Person`.
3. Новая версия упражнения не меняет старую программу или тренировку.
4. У `Person` невозможно оставить две активные program versions.
5. Активация выполняется явно и конкурентные команды не теряют изменения.
6. Сессия сохраняет отдельные подходы и точный snapshot упражнения.
7. Повтор create с тем же person/source/dedupe key идемпотентен.
8. Correction создаёт полный replacement, сохраняет историю и исключает старую
   сессию из текущих запросов.
9. Рекорд выбирает только текущие подходы выбранного `Person`: максимальный
   вес, затем повторения, и возвращает ссылку на источник.
10. Расчёт кандидата прогрессии не меняет программу; принятие создаёт новую
    версию.
11. Повторный external source record идемпотентен внутри источника, а
    совпадение названия не выполняет автоматический merge.
12. Существующие Physical State и Nutrition contracts не меняют поведение.
13. Runtime schemas, OpenAPI, migrations, unit, integration и documentation
    checks проходят.

## Проверки

- `pnpm lint`
- `pnpm --filter @shape-of-you/api typecheck`
- `pnpm --filter @shape-of-you/api build`
- `pnpm --filter @shape-of-you/api test:unit`
- `pnpm --filter @shape-of-you/api test:integration`
- clean-database migration и upgrade от текущего snapshot
- `node scripts/validate-docs.mjs`
- audit PostgreSQL identifiers: не более 63 bytes

## Риски и ограничения

- Legacy `Training` агрегирует одинаковые подходы в одной строке; правила
  импорта в отдельные `PerformedSet` потребуют отдельного решения при cutover.
- Точные значения `Feeling`, `Current_status` и progression policy нельзя
  выводить только из заголовков листа.
- Один активный план упрощает текущий продукт; поддержка нескольких параллельно
  активных программ потребует нового доменного решения.
- Query projections следует материализовать только после измерения нагрузки.
- Общий справочник требует отдельной write/moderation policy до multi-user
  production.

## Architecture Review до реализации

1. **Избыточная сложность:** один Training module; нет microservice, event
   store, scheduler или generic rules engine.
2. **DDD:** справочник, план, выполненный факт и рекомендация имеют разные
   ownership и lifecycle.
3. **Дублирование:** shared exercise content не копируется по `Person`;
   snapshot в выполнении сохраняет исторический смысл намеренно.
4. **История:** program versions и whole-session corrections не допускают
   скрытых перезаписей.
5. **Упрощение:** records и progression остаются queries до появления
   измеренной причины для материализации.

## Результат

- Реализация принята независимой проверкой качества по всем 13 критериям.
- Модуль добавлен в существующий API без нового сервиса, очереди или общего
  механизма правил.
- Модели упражнений, программ и выполненных тренировок сохраняют утверждённые
  границы владения и неизменяемую историю.
- Общие определения упражнений не копируются для каждого пользователя;
  исторические снимки в программах и тренировках сохраняются намеренно.
- Личные рекорды и кандидаты прогрессии остаются вычисляемыми представлениями.
- Модульные тесты: 19 из 19; интеграционные тесты: 20 из 20.
- Проверены создание базы с нуля, обновление предыдущей схемы, конкурентная
  активация, OpenAPI, TypeScript, ESLint и каноническая документация.
- Реальный импорт таблиц, подключение внешнего каталога и развёртывание не
  выполнялись: они не входят в объём задачи.

## Итоговая Architecture Review

1. Лишних развёртываемых границ и преждевременных обобщений не добавлено.
2. Справочник, план, выполненный факт и вычисляемая рекомендация разделены по
   владению и жизненному циклу.
3. Дублирование общих упражнений устранено; исторические снимки не являются
   вторым источником истины.
4. Решения не продублированы между ADR, Wiki и планом: ADR хранит решение,
   Wiki — текущее состояние, план — ход и результат реализации.
5. Упрощать решение дальше без потери истории, изоляции пользователей или
   конкурентной целостности нецелесообразно.
