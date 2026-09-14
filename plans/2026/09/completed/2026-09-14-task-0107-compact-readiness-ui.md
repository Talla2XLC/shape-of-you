# TASK-0107 — Компактное представление готовности данных

## Статус

Завершено 2026-09-14. Локальный цикл Developer → независимый Quality →
Architecture Review → Wiki пройден. Commit, push и deploy не выполнялись.

## Цель

Сделать секцию Data readiness на `/progress` быстро сканируемой: на первом
уровне оставить направление, статус, свежесть, покрытие за 28 дней и короткий
вывод, а диагностические детали показывать по запросу.

## Объём

1. Сократить заголовок и убрать постоянно видимый методический текст.
2. Оставить в карточке status, freshness, usable days за 28 дней и короткий
   recommendation-context summary.
3. Перенести history, 90-day coverage, recorded/usable detail и largest gap в
   доступный native `details`.
4. Перенести provider-neutral, completed-day и non-medical пояснения в один
   page-level `details`.
5. Исправить singular/plural для `day/days`.
6. Обновить unit и browser tests и провести полный Web validation cycle.

## Не входит

- изменение API, `profile-data-coverage-v1`, status thresholds или данных;
- общий readiness/health score;
- изменение Connections, backend, migrations или ADR;
- commit, push или deploy.

## Критерии приёмки

1. Семь карточек можно просканировать без чтения диагностических таблиц.
2. Первый уровень каждой карточки содержит status, freshness, 28-day usable
   signal и короткое объяснение результата.
3. Все ранее доступные history/90-day/gap/recorded данные сохранены в раскрытии.
4. Методика, timezone и safety disclaimer доступны, но не конкурируют с
   основным содержанием.
5. Native disclosure работает с клавиатуры и сохраняет semantic HTML.
6. `1 day` и множественные формы отображаются корректно.
7. Web lint, typecheck, unit, build, focused browser test, docs validator и
   `git diff --check` проходят.

## Архитектурное решение

Новый ADR не нужен: меняется только информационная иерархия Web presentation.
Domain semantics, public contracts, ownership, persistence и deployable
boundaries остаются прежними.

## Approval gates

Оператор одобрил этот scoped UX-rework и полный локальный цикл Developer →
независимый Quality → Architecture Review → Wiki. Commit, push и deploy требуют
отдельного разрешения.

## Результат

- Первый уровень семи карточек сокращён до status, freshness, 28-day signal и
  короткого вывода.
- Диагностические показатели и методика сохранены в native disclosures.
- Исправлена форма `day/days`; keyboard behavior закреплён browser test.
- Независимый Quality принял изменение после полного Web и documentation cycle.
