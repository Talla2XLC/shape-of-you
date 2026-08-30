---
id: "decisions-20260830-model-unquantified-meal-amount-evidence-and-natural-coach-language"
kind: adr
title: "Хранить неизвестный объём еды честно и не показывать внутренний контракт в речи Coach"
status: accepted
date: 2026-08-30
supersedes: []
superseded_by: null
tags:
  - architecture
  - coaching
  - nutrition
---

# Хранить неизвестный объём еды честно и не показывать внутренний контракт в речи Coach

## Context

Capture-first Coach принимает обычные сообщения пользователя о еде без
обязательного взвешивания и повторного подтверждения. Live E2E показал два
дефекта текущего контракта:

1. `MealItem.quantity` и `MealItem.unit` обязательны, поэтому при сообщении без
   количества MCP client подставляет `1 serving`. Это технически валидное, но
   выдуманное значение.
2. Machine-readable поля и шаги (`partial`, `null`, `typed read-back`,
   `list_meals(...)`) попадают в пользовательский ответ и превращают Coach в
   отладочный интерфейс.

Пользователь часто не знает массу еды. Если точность действительно влияет на
совет, Coach может после успешной записи необязательно предложить прислать фото
в текущий chat или описать объём бытовыми словами: «полтарелки», «большая
миска», «два куска», «стакан». Это уточнение не должно блокировать исходную
запись.

`nutritionCompleteness = complete|partial` остаётся полезным machine-readable
признаком качества Nutrition evidence: он не позволяет считать неизвестные
калории или макросы нулём. Это не статус дня и не пользовательский workflow.
DayClosure уже удалён отдельным решением.

## Decision

### Amount evidence

Meal item получает явное состояние amount evidence:

- `unknown` — пользователь назвал продукт, но не описал объём;
- `described` — сохранено исходное бытовое описание объёма без искусственной
  числовой нормализации;
- `quantified` — источник явно сообщил числовое количество и unit;
- `estimated` — числовое количество получено как оценка по тексту или фото и
  сопровождается method и confidence.

Persistence и public contract используют согласованные поля:

- `amountKind`;
- nullable `quantity` и `unit`;
- nullable `amountDescription`;
- nullable `estimateMethod = text|photo`;
- nullable item-level `amountConfidence`.

Database checks обязаны фиксировать допустимые комбинации:

- `unknown`: quantity/unit/description/method/confidence отсутствуют;
- `described`: quantity/unit отсутствуют, description присутствует,
  method/confidence отсутствуют;
- `quantified`: quantity и unit присутствуют, method/confidence отсутствуют;
- `estimated`: quantity, unit, method и confidence присутствуют.

Существующие строки backfill-ятся как `quantified`, потому что в источнике уже
была зафиксирована числовая quantity/unit. Это не переоценивает точность
исторического источника и не меняет nutrients.

`unknown` и `described` items не получают sentinel `1 serving`. Неизвестные
nutrients остаются `null`, а `nutritionCompleteness` остаётся machine-readable
состоянием качества evidence. Daily totals не превращают неизвестное в ноль и
не публикуют сумму известного подмножества как полный итог.

### Optional refinement

Прямой релевантный report сначала создаёт или корректирует Meal и проходит
automatic typed read-back. Уточнение количества разрешено только после capture
и только как необязательное предложение, когда дополнительная точность
материально улучшит анализ или совет.

Пользователь может:

- ничего не уточнять;
- позже прислать бытовое текстовое описание;
- позже сообщить число и unit;
- прислать фото в поддерживающем изображения client и явно или контекстно
  разрешить оценку.

Фото остаётся transient client input. Shape of You не добавляет media storage,
новый upload tool или deployable boundary. В PostgreSQL сохраняется только
derived `estimated` amount evidence с method/confidence и существующей
provenance/correction chain. Если client не умеет работать с изображением,
Coach предлагает текстовое описание или оставляет amount неизвестным.

Любое позднее уточнение использует существующий append-only Meal correction и
supersedes current version; destructive overwrite не появляется.

### Coach voice

MCP operational instructions разделяют machine protocol и user-facing voice.
В обычном capture/correction ответе Coach:

- естественно подтверждает, какие продукты учтены и какие исключены;
- не произносит property names, enum values, tool names, arguments, `null`,
  `partial`, `typed`, `read-back`, identifiers или transport details;
- не использует обязательные Daily Coach headings для короткой записи факта;
- не утверждает количество, nutrient value или точность, которых пользователь
  не сообщал и которые не были явно оценены;
- может одной естественной фразой предложить фото или описание объёма, но не
  превращает это в обязательный вопрос или условие успеха.

Структура `Planned / Proposed now / Actually completed` остаётся семантической
границей полного daily-plan ответа, а не шаблоном каждого сообщения.
Платформенный UI может отдельно показывать сам факт tool invocation; Shape of
You контролирует только metadata и текстовый ответ модели.

## Considered alternatives

### Оставить `1 serving` и скрыть технические слова

Отклонено: ответ станет приятнее, но PostgreSQL продолжит хранить выдуманное
количество, а будущая аналитика будет считать его наблюдаемым фактом.

### Сохранять еду без количества как `DailyContextNote`

Отклонено: названные продукты принадлежат Nutrition/Meal. Generic note ухудшает
поиск, коррекции, агрегацию и owning-domain authority.

### Сделать только quantity/unit nullable

Отклонено как недостаточное: nullable values убирают sentinel, но не отличают
неизвестный объём, пользовательское описание и client-generated estimate.
Различие нужно для честной provenance и будущих советов.

### Хранить фото в Shape of You

Отклонено для этой задачи: потребовало бы media lifecycle, storage, privacy,
retention и provider integration. Производной amount estimate достаточно для
текущего Nutrition use case.

## Consequences

- Обычную еду можно записать без весов и без fabricated serving.
- Пользовательская речь становится короткой и естественной, а protocol details
  остаются внутри MCP/API.
- Nutrition analytics явно различает отсутствие количества, бытовое описание,
  recorded quantity и estimate.
- Требуются public contract, database schema, migration, repository и MCP test
  changes; это coordinated breaking contract change для dynamic MCP clients.
- Existing rows сохраняют значения и backfill amount kind без изменения Meal
  authority или nutrients.
- Фото не становится durable evidence; сохраняется только derived estimate и
  его confidence. Отдельное хранение media потребует нового ADR.
- Новых сервисов, баз данных, OAuth clients, tools или chat UI не появляется.

## Verification

- Contract tests проверяют все допустимые и недопустимые amount evidence
  combinations.
- Migration tests проходят для clean install и каждого journal prefix,
  backfill-ят existing rows и статически отклоняют PostgreSQL identifiers
  длиннее 63 UTF-8 bytes.
- Nutrition integration tests покрывают unknown, described, quantified и
  estimated items, nullable amount persistence, totals и append-only
  correction.
- MCP tests запрещают sentinel `1 serving`, обязательное уточнение и
  user-facing internal vocabulary; capture по-прежнему требует typed read-back.
- Conversation fixtures проверяют естественный короткий ответ и необязательное
  предложение фото/описания только после успешной записи.
- Independent Quality и Architecture Reviews проверяют отсутствие fabricated
  precision, generic-note fallback, media boundary и нового deployable scope.
- Live staging E2E выполняется только после отдельных approvals на deployment,
  connector refresh/OAuth при необходимости и конкретный staging write.

## Related material

- [Capture-first Coach ADR](20260829-remove-day-closure-and-use-capture-first-coach.md)
- [Partial Nutrition ADR](20260825-import-partial-nutrition-and-source-day-closures.md)
- [Meal API](../wiki/api/meals.md)
- [Coaching and decision support](../wiki/domain/coaching-and-decision-support.md)
- [TASK-0081 plan](../../plans/2026/08/completed/2026-08-30-task-0081-natural-coach-and-unquantified-meals.md)
