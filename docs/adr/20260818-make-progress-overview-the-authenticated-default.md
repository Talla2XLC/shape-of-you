---
id: "decisions-20260818-make-progress-overview-the-authenticated-default"
kind: adr
title: "Сделать bounded progress overview главным authenticated экраном"
status: accepted
date: 2026-08-18
supersedes: ["decisions-20260817-preserve-same-origin-browser-return-routes-through-oauth"]
superseded_by: null
tags:
  - "api"
  - "browser"
  - "progress"
  - "read-model"
  - "routing"
  - "timezones"
  - "web"
---

# Сделать bounded progress overview главным authenticated экраном

## Context

Authenticated `/day` доказал работоспособность browser OAuth, Person
authorization, daily projection и lifecycle `DayClosure` в одном полезном
vertical slice. Однако один день не подходит как долгосрочный главный экран:
он скрывает изменение во времени и заставляет пользователя выбрать дату до
того, как видно, существуют ли данные.

Продукту нужны периоды неделя, месяц и год, график с одним выбираемым
показателем и newest-first переходы к датам с фактами. Отсутствующий факт должен
оставаться отсутствующим. Замена отсутствия числовым нулём создаёт ложные
измерения, вводящие в заблуждение линии графика и небезопасную интерпретацию
трендов.

Существующие API modules владеют current facts физического состояния, питания,
тренировок, восстановления и coaching. Текущий daily composition contract
оптимизирован для одной точной даты. Вызов этого contract для каждого дня
заставит static client выполнить до нескольких сотен requests и ошибочно
представит `DayClosure` владельцем исторического прогресса, хотя это только
per-day coordination artifact.

Accepted browser-return ADR сделал `/day` default OAuth return route. Изменение
authenticated default должно сохранить same-origin validation, привязку к
signed transaction, запрет fragments, session-presence contract и возврат на
явно запрошенный protected route.

## Decision

Сделать `/progress` главным authenticated Web route. Landing active CTA,
sign-in без explicit `returnTo`, invalid или legacy OAuth transaction fallback
и default shared browser-auth adapter используют `/progress`.

Не менять explicit protected-route return. Разрешён только bounded same-origin
absolute-path reference: path и optional query. API отклоняет или заменяет
scheme, origin, authority, protocol-relative path, backslash, fragment, control
characters и oversized values. Validated route остаётся внутри signed,
short-lived, HttpOnly OAuth transaction cookie, а callback перенаправляет
только на восстановленный verified claim. `GET /browser-auth/session` остаётся
credential-free и non-refreshing `204`/`401` session-presence contract с
`Cache-Control: no-store`.

Добавить protected `/progress` с trailing presets неделя, месяц и год. Начальные
presets — inclusive 7, 30 и 365 Person-local dates, заканчивающиеся сегодня в
выбранной browser valid IANA timezone. Client вычисляет explicit inclusive
`from`, `to` и `timezone` и передаёт их API.

Добавить один API application read model:

`GET /v1/progress-overview?from=YYYY-MM-DD&to=YYYY-MM-DD&timezone=Area%2FCity`

API проверяет real calendar dates, valid IANA timezone, `from <= to` и
inclusive range максимум 366 дней. Response содержит:

- принятый context `from`, `to`, `timezone`;
- fixed versioned набор metric definitions и sparse factual points;
- newest-first даты, где существует хотя бы один current fact, с bounded fact
  counts по owning module для отображения и drill-down.

Начальные chart metrics используют данные уже реализованных modules:

- `weight_kg`: последний current WeightMeasurement в local date со stable
  timestamp/id tie-break;
- `calories_kcal`: current Meal total для даты только при наличии хотя бы одного
  current Meal;
- `protein_g`: current Meal total для даты только при наличии хотя бы одного
  current Meal;
- `workout_session_count`: число current WorkoutSession facts только при
  наличии хотя бы одного;
- `readiness_score`: последний RecoveryAssessment в local date со stable
  timestamp/id tie-break.

Metric points sparse. Если owning fact отсутствует, point не возвращается; Web
chart соединяет соседние фактические points одной trend line, сохраняет
пропорциональное расстояние календарных дат и не рисует point/guide для
пропущенного дня. При отсутствии points выбранной metric показывается
**No entries**. Числовой ноль возвращается только как значение существующего
факта или aggregate по существующим фактам. API и Web не создают zero-filled
или interpolated dates.

Overview coordinator использует bounded range read ports, экспортируемые
существующими API-owned modules. Каждый owning module выбирает current,
non-superseded facts для inclusive range и сохраняет свои correction и
ownership rules. Coordinator выполняет bounded число range reads: не проходит
цикл по датам, не вызывает public exact-day HTTP routes и не читает database
другого deployable. Read model вычисляется на request и не имеет новой table,
cache, migration, credential, database или deployable.

Drill-down список дат является union current facts из Physical State,
Nutrition, Training, Recovery и Coaching. Один `DayClosure` без current fact не
делает дату factual. `DayClosure` остаётся владельцем только exact-date
close/reopen artifact и не используется как historical overview authority.

Добавить `/days/:localDate` как canonical protected day-detail route. Route
принимает только real `YYYY-MM-DD` path date и bounded valid IANA `timezone`
query, затем повторно использует существующие exact-day projection и
closure-history contracts. Overview links всегда encode оба значения.

`/day` и `/day?date=...` остаются compatibility routes. Client-side routing
проверяет legacy date и timezone, использует safe browser-local defaults при
отсутствующем или invalid значении и выполняет replace navigation на
`/days/:localDate?timezone=...`. Fragment и arbitrary query target не
копируются.

Не добавлять customizable dashboard, saved layout, arbitrary formula builder,
generic chart query language, persisted progress aggregate, broad `DayRecord`
или frontend fan-out по exact-day endpoints.

## Considered alternatives

- **Сохранить `/day` authenticated default:** минимизирует navigation changes,
  но оставляет продукт сосредоточенным на одной вручную выбранной дате и делает
  тренды вторичными. Отклонено как долгосрочная information architecture.
- **Использовать сфокусированный `/progress` overview:** добавляет один bounded
  read model и понятный history-first entry point, повторно используя module
  authority и exact-day detail. Выбрано.
- **Построить generic customizable dashboard:** даёт arbitrary widgets,
  layouts, metrics и comparisons, но преждевременно вводит product surface,
  persistence choices и generic query contracts без доказанной потребности в
  personalization. Отложено.
- **Вызывать exact-day projection до 366 раз из Web:** повторно использует
  endpoint, но создаёт browser fan-out, дублирует module work и связывает
  progress с `DayClosure`. Отклонено.
- **Хранить historical `DayRecord` или materialized overview:** ускоряет reads,
  но дублирует current fact authority и требует freshness, correction,
  migration и lifecycle policy без измеренной performance-причины. Отклонено.
- **Использовать closed `DayClosure` snapshots как chart history:** даёт
  reproducible closed-day values, но исключает open dates и меняет смысл с
  current facts на historical snapshots. Отклонено; closure остаётся per-day.

## Consequences

- Authenticated пользователь сразу видит trend-oriented surface и переходит к
  точной factual date без ручного поиска.
- Missing data остаются явно missing, поэтому chart не подразумевает
  несуществующие measurements.
- API и shared contracts получают один bounded read contract и module-owned
  range read ports без нового domain owner или deployment boundary.
- Range queries и response size ограничены 366 датами; indexes и query plans
  требуется проверить.
- Static client получает accessible chart и текстовый day list. Chart остаётся
  presentation и не вычисляет domain facts.
- Предыдущий browser-return ADR superseded из-за замены `/day` default; его
  security и explicit-return invariants сохранены этим решением.
- Legacy `/day` bookmarks продолжают работать через safe canonical redirect.

## Verification

- Contract и API unit tests отклоняют invalid dates/timezones, reversed range,
  unknown query properties и range длиннее 366 дней.
- Integration tests создают current и superseded facts разных modules и
  доказывают sparse points, stable metric aggregation, newest-first factual
  dates, Person isolation и отсутствие zero-filled gaps.
- Query-count assertions или repository spies доказывают bounded число range
  reads независимо от числа дат.
- OpenAPI публикует точные overview query и response schemas.
- Web unit tests проверяют period bounds, metric selection, gap segmentation,
  **No entries**, safe dated links и `401` return на точный progress/day-detail
  route без browser storage.
- Browser E2E проверяет `/progress` как landing/OAuth default, все periods,
  factual-day drill-down, legacy `/day` redirects, exact signed protected-route
  restoration, keyboard operation, reduced motion и narrow viewport.
- Existing DayClosure tests продолжают проверять exact-date timezone conflict,
  immutable snapshots, stale status и append-only reopen/reclose.
- Architecture Review подтверждает отсутствие customizable dashboard, broad
  daily aggregate, нового deployable/database/migration, duplicated authority,
  cross-service SQL и per-date frontend fan-out.

## Related material

- [Независимые факты вместо broad DayRecord](20260728-prefer-independent-facts-over-broad-day-record.md)
- [Versioned Person-local day closures](20260811-model-versioned-person-local-day-closures.md)
- [API-owned browser session cookies](20260812-use-api-owned-browser-session-cookies.md)
- [Superseded browser return-route decision](20260817-preserve-same-origin-browser-return-routes-through-oauth.md)
- [Product scope](../wiki/product/scope.md)
- [Integrity and lifecycle](../wiki/data/integrity-and-lifecycle.md)
- [План реализации TASK-0043](../../plans/2026/08/completed/2026-08-18-task-0043-progress-overview.md)
