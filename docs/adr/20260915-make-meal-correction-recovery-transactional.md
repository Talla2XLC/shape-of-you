---
id: "decisions-20260915-make-meal-correction-recovery-transactional"
kind: adr
title: "Сделать восстановление Meal correction транзакционно однозначным"
status: accepted
date: 2026-09-15
supersedes: []
superseded_by: null
tags:
  - architecture
  - nutrition
  - mcp
  - corrections
---

# Сделать восстановление Meal correction транзакционно однозначным

## Context

Пользователь исправляет питание короткими естественными уточнениями, например
меняет массу одного продукта. Доменный `CorrectMeal` намеренно является полной
append-only заменой Meal: он требует актуальный Meal id, все неизменённые
поля и items, полное nutrition evidence и новый idempotency key. Это защищает
историю и не допускает частично определённую authoritative запись.

MCP flow разрешал модели немедленно собирать full replacement из conversation
context без обязательного чтения текущего Meal. Неполный payload отклонялся до
NutritionService, а id уже superseded Meal приводил к conflict. Все execution
ошибки превращались в одинаковый нетипизированный ответ. После успешной команды
модель отдельно вызывала `list_meals`; сбой этого второго чтения мог быть
представлен пользователю как неподтверждённая запись, хотя transaction уже
вернула сохранённый canonical Meal.

В результате актуальное уточнение пользователя могло не попасть в PostgreSQL,
а conversation обещал использовать его в будущих расчётах. Это нарушает
PostgreSQL authority и делает Nutrition evidence для DailyAssessment устаревшим.
Уже открытый обычный conversation должен восстановиться без нового tool,
refresh, Work mode или нового чата.

## Decision

1. Существующие `list_meals` и `correct_meal` сохраняют имена, schemas и scopes.
2. Перед сборкой Meal correction conversation orchestration обязана вызвать
   `list_meals` для локальной даты, выбрать текущую запись и наложить уточнение
   пользователя на полный canonical snapshot. Неизменённые items и evidence
   сохраняются; модель не должна реконструировать их только по памяти чата.
3. `correct_meal` остаётся полной append-only заменой. NutritionService и
   repository продолжают владеть validation, idempotency, Person isolation,
   concurrency и persistence. Backend не интерпретирует естественный язык и не
   выполняет эвристический item merge.
4. Успешный `correct_meal` возвращает canonical Meal, сериализованный из той же
   database transaction. Этот typed command result является подтверждением
   сохранения. Отдельный `list_meals` не требуется только для доказательства
   success и его последующий сбой не отменяет уже committed correction.
5. Ошибки correction получают стабильные machine-readable recovery states:
   invalid replacement требует current-day re-read и полной пересборки;
   stale/not-found target требует re-read и повторного применения уточнения к
   текущей версии; прочая execution failure допускает один idempotent retry.
6. Recovery instruction остаётся server-owned model-facing metadata. Пользователь
   не видит tool names, ids, schemas или transport details и не должен повторять
   уже однозначное уточнение.
7. Пока typed success не получен, correction не считается current PostgreSQL
   fact и не используется в totals или рекомендациях. Уточнение пользователя
   при этом не игнорируется: orchestration обязана выполнить recovery flow или
   честно сообщить о временно несохранённом изменении.

## Considered alternatives

### Усилить только общий MCP prompt

Минимально, но по-прежнему не различает validation, stale target и временную
ошибку, а также оставляет неоднозначность между committed write и неудачным
дополнительным read-back. Отклонено как недостаточно надёжное.

### Добавить новый partial-correction tool

Мог бы выразить item patch явно, но уже открытые conversations не увидят новое
имя. Потребовалась бы новая модель item identity и merge conflicts. Отклонено
для этого этапа.

### Автоматически сливать неполный payload в backend

Backend не получает исходное естественное уточнение и не может надёжно отличить
намеренное удаление item от случайно потерянного поля. Эвристический merge может
тихо исказить питание. Отклонено.

### Стабильный current-read → full replacement → typed result flow

Использует существующие tools и доменную модель, сохраняет frozen-client
совместимость и делает recovery однозначным. Выбрано.

## Consequences

- Обычное уточнение сохраняется без знания пользователем внутренних контрактов.
- Append-only история, строгая полнота Meal и PostgreSQL authority сохраняются.
- Коррекция требует дополнительного чтения до write, но больше не требует
  отдельного чтения только для подтверждения уже успешной команды.
- Старый conversation получает новые recovery instructions из актуальных tool
  results без metadata refresh.
- Новых таблиц, migrations, scopes, сервисов, dependencies и env variables нет.

## Verification

- MCP tests фиксируют неизменность schemas и scopes `list_meals`/`correct_meal`.
- Success test подтверждает canonical structured Meal и отсутствие требования
  дополнительного verification read.
- Invalid replacement, stale/not-found и retryable failure tests проверяют
  разные typed recovery states и точный permitted retry flow.
- Tests запрещают обещание использовать несохранённое изменение как current
  fact и сохраняют routine `record_meal` behavior.
- После отдельного release approval canary повторяет естественную коррекцию в
  том же обычном conversation и проверяет её через последующий Nutrition read.

## Related material

- [Backward-compatible MCP schemas](20260902-evolve-mcp-tool-schemas-backward-compatibly.md)
- [Meal amount evidence](20260830-model-unquantified-meal-amount-evidence-and-natural-coach-language.md)
- [API-owned daily assessment](20260914-own-daily-assessment-and-next-action-in-api.md)
- TASK-0114
