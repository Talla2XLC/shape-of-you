# TASK-0043 — Progress overview и переход к конкретному дню

## Статус и граница разрешения

- Статус: завершено; Developer, independent Quality, Architecture Review и canonical Wiki alignment приняты.
- Accepted superseding ADR:
  [`docs/adr/20260818-make-progress-overview-the-authenticated-default.md`](../../../docs/adr/20260818-make-progress-overview-the-authenticated-default.md).
- Утверждение разрешает реализацию только перечисленного scope.
- Оператор подтвердил закрытие TASK-0042; локальный `main` содержит её commit
  `3ee8782`. После утверждения ADR и плана worktree нужно безопасно
  синхронизировать и повторно проверить пересекающиеся landing/CSS/test files.
- Commit, push, deployment, migration execution, production/secret access и
  destructive operations не разрешены.

## Цель

Сделать `/progress` главным authenticated экраном, показать фактическую
динамику за неделю, месяц и год без ложных нулей и дать переход к canonical
деталям `/days/:localDate`, сохранив безопасный OAuth `returnTo`, legacy `/day`
и узкую per-day роль `DayClosure`.

## Product shaping

| Вариант | Пользовательская ценность | Стоимость/риск | Решение |
|---|---|---|---|
| Сохранить `/day` как default | Минимум изменений, сильный exact-day lifecycle | Не показывает изменение во времени и требует заранее выбрать дату | Отклонить как долгосрочный default |
| Сфокусированный `/progress` overview | Сразу показывает тренд и фактические дни, сохраняет простой drill-down | Нужен один bounded range read-model и новый chart UI | Рекомендовать |
| Generic customizable dashboard | Максимальная гибкость widgets/layout/formulas | Преждевременные persistence, query-language и UX decisions без подтверждённой потребности | Отложить |

### Точные non-goals

- Custom widgets, saved layouts, arbitrary formulas, comparisons, forecasts,
  goals overlay и generic dashboard/query language.
- Новый `DayRecord`, исторический owner в `DayClosure`, materialized progress
  table, cache, migration, database, deployable, broker или cross-service SQL.
- Frontend fan-out по exact-day endpoint, Google Sheets cutover/backfill,
  изменение domain facts, auto-close, notifications, mobile UI или ChatGPT tool.
- Изменение OAuth protocol, client scopes, cookie/session format, Person
  mapping, Identity UI или MCP bearer contract.
- Перенос или повторение незакоммиченного scope TASK-0042.

## Утверждаемая архитектура

1. `/progress` становится default для landing active CTA, OAuth sign-in без
   explicit `returnTo`, invalid/legacy transaction fallback и browser-auth
   adapter.
2. Signed same-origin `returnTo` продолжает восстанавливать явно запрошенный
   path+query; fragments, origins, schemes, authorities, backslashes, control
   characters и oversized values запрещены.
3. Web presets — trailing 7/30/365 inclusive local dates, заканчивающиеся
   сегодняшней датой в валидной IANA timezone.
4. Один endpoint
   `GET /v1/progress-overview?from=...&to=...&timezone=...` принимает real
   dates, `from <= to` и максимум 366 inclusive dates.
5. API response содержит fixed metric definitions, sparse factual points и
   newest-first union дней, где есть current facts.
6. Начальные metrics: `weight_kg`, `calories_kcal`, `protein_g`,
   `workout_session_count`, `readiness_score` с точными aggregation rules из
   ADR.
7. Missing fact означает отсутствие point/gap; `0` допустим только при наличии
   факта, фактическое значение которого равно нулю. Пустая series показывает
   **No entries**.
8. Новый application coordinator вызывает bounded range read ports текущих
   API-owned модулей. Количество reads не зависит от числа дат и нет HTTP
   self-calls или per-date composition loop.
9. `DayClosure` не участвует в overview aggregation и остаётся только exact-day
   close/reopen/history artifact.
10. Canonical detail — `/days/:localDate?timezone=...`; он повторно использует
    существующие day projection/history commands. `/day` и `/day?date=...`
    выполняют safe replace redirect с validated/default date и timezone.

## Затрагиваемые области

| Область | Предлагаемое изменение |
|---|---|
| `packages/contracts` | Runtime schemas/types для query, metric points, factual-day summaries и response |
| API module-owned services/stores | Bounded inclusive range read ports с current/non-superseded semantics |
| Новый API progress application module | Coordination, validation, aggregation и HTTP controller без persistence |
| API OpenAPI/bootstrap/tests | Published route, test doubles, query/aggregation/query-count coverage |
| `apps/web/app/lib` | Progress adapter, period/date/timezone и sparse-series presentation helpers |
| `apps/web/app/pages/progress.vue` | Protected overview, metric selector, accessible chart и factual-day list |
| `apps/web/app/pages/days/[localDate].vue` | Canonical exact-day UI на существующем lifecycle contract |
| `apps/web/app/pages/day.vue` | Legacy safe replace redirect only |
| Landing/header/browser auth | `/progress` default и navigation при сохранении exact explicit return |
| Web unit/Playwright/full-auth E2E | Periods, gaps, No entries, drill-down, redirects, OAuth defaults, accessibility/responsive |
| Canonical ADR/Wiki/changelog | Accepted decision и только затронутый current state после Quality |

## Этапы после утверждения

1. [x] После утверждения ADR и плана безопасно синхронизировать worktree с
   локальным `main` на commit `3ee8782`, проверить `git status`, diff и повторно
   прочитать пересекающиеся landing/CSS/test files.
2. [x] Перевести новый ADR в `accepted`, указать его в `superseded_by` старого
   return-route ADR и записать approval в timeline TASK-0043.
3. [x] Добавить и экспортировать runtime contracts с concise English TSDoc для
   exported types/functions; зафиксировать sparse/gap semantics и limit 366.
4. [x] Добавить module-owned range read ports и repository queries, сохранив
   Person isolation, current/non-superseded facts и stable ordering.
5. [x] Реализовать ProgressOverview application coordinator/controller,
   OpenAPI и bounded-query validation без нового persistence.
6. [x] Добавить API unit/integration/contract tests, включая fact-module
   aggregation, zero-versus-gap, stable tie-breaks, oversized ranges и bounded
   range-read count.
7. [x] Реализовать Web adapter/helpers и protected `/progress` с week/month/year,
   metric selection, accessible sparse chart, **No entries** и newest-first
   factual-day links.
8. [x] Перенести exact-day UI на `/days/:localDate`, добавить validated timezone
   query и safe compatibility redirects с `/day`.
9. [x] Изменить landing/header/OAuth defaults на `/progress`, не меняя signed
   explicit `returnTo` и session-presence security contract.
10. [x] Добавить Web unit/static Playwright/full disposable OAuth E2E для
    default, exact return, legacy redirect, chart gaps, drill-down,
    keyboard/reduced-motion и responsive widths.
11. [x] Прогнать service/monorepo checks, integration tests при доступном Docker,
    static artifact checks, `node scripts/validate-docs.mjs` и
    `git diff --check`.
12. [x] Провести independent Quality без паузы после Developer и отдельный
    Architecture Review по checklist ниже.
13. [x] После accepted Quality запросить разрешение на Wiki/changelog alignment;
    commit/push/deploy остаются отдельными gates.

## Критерии приёмки

1. Authenticated landing CTA и sign-in без explicit route открывают
   `/progress`; explicit signed same-origin protected route возвращается точно
   на path+query.
2. `/progress` предлагает week/month/year как trailing 7/30/365 local dates в
   выбранной valid IANA timezone.
3. API принимает только real inclusive date range до 366 дней и отклоняет
   invalid timezone, reversed/oversized range и неизвестные query fields.
4. Chart selector показывает утверждённые factual metrics и строит points по
   точным stable aggregation rules.
5. Отсутствие факта отображается gap, не числовым нулём; пустая selected series
   показывает **No entries**.
6. Под chart перечислены только даты с хотя бы одним current fact, newest-first;
   counts/types совпадают с owning-module evidence.
7. Переход открывает `/days/:localDate?timezone=...`; invalid route date не
   запускает domain request и получает bounded safe UI/redirect behavior.
8. `/day` и `/day?date=...` безопасно заменяются canonical dated URL, не
   сохраняя fragment или arbitrary query.
9. Overview выполняет bounded number of module range reads независимо от 7,
   30 или 365 дат; Web не вызывает exact-day API в цикле.
10. `DayClosure` schema/store/composition ownership не расширены; existing
    close/reopen/history/stale tests проходят без semantic regression.
11. Нет нового deployable/database/credential/migration/cache/broker,
    cross-service SQL, broad `DayRecord` или TASK-0042 diff.
12. API/Web unit, API integration, static browser E2E, disposable OAuth E2E,
    lint/typecheck/build, docs validation и diff checks проходят либо явно
    зафиксированы как недоступные с обоснованием.

## План проверки

- Contracts: runtime-schema valid/invalid matrix и exported-type typecheck.
- API unit: date-span/timezone validation, sparse aggregation, latest stable
  choice, factual-day union/sort и empty response.
- API integration: facts и superseded corrections во всех owning modules,
  Person isolation, zero-versus-gap, no closure-only day, range boundaries и
  OpenAPI response validation.
- Performance shape: repository spies/query instrumentation доказывают bounded
  range reads, а не `N dates × M modules`.
- Web unit: period calculation across month/year/leap boundaries, route/date/
  timezone validation, metric selection, chart segment gaps, **No entries** и
  exact link encoding.
- Static Playwright: authenticated/unauthenticated progress, legacy redirects,
  day detail, keyboard focus, semantic fallback, reduced motion, 320/375/768/
  1440 widths и отсутствие horizontal overflow.
- Full auth E2E: OAuth default `/progress`, active landing CTA, explicit direct
  `/days/:localDate?timezone=...` return и API session expiry recovery.
- Regression: existing browser-auth, DayClosure, CSRF/Origin, Identity OAuth,
  MCP and static artifact tests.
- Commands: affected package lint/typecheck/build/unit/integration, root suites
  where practical, `node scripts/validate-docs.mjs`, PostgreSQL identifier-byte
  static check when identifiers change, `git diff --check`.

## Architecture Review checklist

1. Complexity: fixed metrics и sparse series решают текущую задачу без generic
   dashboard/query language или persisted projection.
2. Deployables: остаются static Nuxt и текущий modular API; новый runtime,
   database и credential boundary отсутствуют.
3. DDD: каждый module владеет range read semantics своих facts; coordinator
   только составляет read model, а `DayClosure` остаётся per-day artifact.
4. Duplication: ADR хранит decision, Wiki — current state после acceptance,
   план — execution; response не становится второй fact authority.
5. Simplification: один bounded API request и fixed metrics проще frontend
   fan-out, broad `DayRecord` и customizable dashboard без потери требуемых
   period/gap/drill-down semantics.

## Решение об утверждении

ADR и план утверждены оператором 2026-08-18. TASK-0042 синхронизирована из
локального `main` commit `3ee8782` безопасным fast-forward до первого
TASK-0043 source-code patch.
