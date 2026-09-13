# TASK-0107 — Provider-neutral покрытие профиля и готовность данных

## Статус

Завершено 2026-09-13. Локальный цикл Developer → независимый Quality →
Architecture Review → Wiki пройден. Commit, push, deploy и применение migration
не выполнялись.

## Цель

Дать пользователю на `/progress` понятное представление о глубине, свежести и
регулярности Person-owned evidence по семи направлениям и объяснить, где данных
достаточно для recommendation context без общего health score и без зависимости
от Garmin, Intervals.icu, manual input или будущего provider.

## Объём

1. Добавить versioned `progress-data-coverage` contract и authenticated API.
2. Реализовать provider-neutral coverage для sleep, HRV, resting heart rate,
   Body Battery, training, weight и nutrition.
3. Разделить historical bounds, recent 28/90 regularity и readiness status.
4. Исключить текущий незавершённый Person-local день из denominators.
5. Учитывать current-only corrections/withdrawals, partial Recovery/Nutrition и
   union manual/imported Training facts.
6. Выполнять постоянное число module-owned aggregate reads без persisted
   coverage aggregate и без загрузки всей истории.
7. Добавить доступный UI-блок на Progress без import controls, provider counters
   и медицинских обещаний.

## Не входит

- единый процент здоровья или medical-quality claim;
- изменение Connections/OAuth/import/disconnect/erasure lifecycle;
- новый provider, scheduler, service, deployable, database, cache или coverage
  table;
- восстановление `DayClosure` или вывод о незаписанном поведении пользователя;
- доказательство полной дневной Nutrition записи;
- commit, push, deploy, production access и применение migration.

## Затронутые области

- `packages/contracts/src/progress-data-coverage.ts` и exports;
- `apps/api/src/progress-overview/`;
- module-owned repositories/services Recovery, Training, Nutrition и Weight;
- `apps/web/app/pages/progress.vue` и browser adapter/presentation helpers;
- contract, API unit/integration и Web tests;
- после Quality acceptance — только затронутые canonical Wiki pages.

## Порядок реализации

1. Зафиксировать additive strict contract с `profile-data-coverage-v1`, семью
   keys, history/freshness/windows/gaps/readiness и typed reason codes.
2. Добавить lean module-owned coverage queries, возвращающие bounds и recent
   recorded/usable dates без hydration facts.
3. Реализовать pure coverage policy и Person-local calendar arithmetic.
4. Скомпоновать отдельный authenticated endpoint в существующем Progress module.
5. Добавить Web adapter и cards с независимыми loading/error/empty states.
6. Добавить pin tests на policy thresholds, incomplete current day, absence,
   corrections, withdrawals, partial Nutrition, Body Battery pair, Training
   union, Person isolation и provider-neutral behavior.
7. Проверить query shape и добавить только необходимые bounded indexes; не
   применять migration к staging.
8. Провести Developer handoff и независимый Quality review без исправлений в
   Quality-фазе.
9. Провести Architecture Review по обязательным пяти критериям.
10. После принятия обновить current-state Wiki, перенести план в `completed/` и
    выполнить полную документационную и repository validation.

## Критерии приёмки

1. Progress показывает семь provider-neutral направлений с первой/последней
   датой, freshness, 28/90 recorded и usable coverage, significant gaps,
   `Sparse / Partial / Good` и понятным missing-data explanation.
2. История и recent regularity визуально и контрактно разделены; текущий
   Person-local день не уменьшает denominators.
3. Status policy versioned и объясним: daily, weekly Weight и event-driven
   Training cadence не оцениваются одним denominator rule.
4. Recovery учитывает current non-withdrawn evidence, `poor` как non-usable и
   Body Battery pair semantics; источник данных на результат не влияет.
5. Training объединяет current WorkoutSession и ExternalActivityFact по local
   date без provider count и двойного covered day.
6. Nutrition различает recorded и usable Meal days и не утверждает полноту
   дневного рациона.
7. Empty/stale/partial states не создают synthetic zeros и не обещают medical
   или recommendation quality.
8. API использует constant number module-owned reads, не делает per-day fan-out,
   не создаёт persisted aggregate и сохраняет Person isolation.
9. Connections остаётся местом управления imports; Progress не получает
   connection controls или imported-record counters.
10. Targeted/full checks, docs validator, PostgreSQL identifier guard,
    `git diff --check`, независимые Quality и Architecture Review проходят.

## Проверки

- contracts schema/build tests;
- API lint, typecheck, build, unit и PostgreSQL integration tests;
- Web unit tests и browser E2E для новой секции;
- query-count/current-only/Person-isolation pin tests;
- `node scripts/validate-docs.mjs`;
- PostgreSQL 63-byte identifier guard;
- `git diff --check`;
- `4dt-board validate`.

## Approval gates

- Архитектура, policy thresholds и этот план одобрены сообщением «го».
- Одобрение включает полный локальный цикл через Wiki после Quality acceptance.
- Commit, staging, push, deploy, production/secret access и применение migration
  требуют отдельных подтверждений.

## Результат

- Добавлены versioned contract и authenticated API для семи provider-neutral
  направлений.
- Реализованы bounded module-owned reads, current-day rule и объяснимая policy.
- Progress показывает history, freshness, 28/90 regularity, gaps и readiness без
  provider counters, общего health score или medical claim.
- Независимый Quality принял все десять критериев; Architecture Review не нашёл
  лишней сложности или нарушения domain ownership.
- Canonical ADR и затронутые Wiki-страницы актуализированы.
