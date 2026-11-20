# TASK-0180 — Подтверждённые показатели Garmin Personal API

Статус: согласованный локальный этап завершён 2026-11-20; независимая
Quality и Architecture Review приняты (`task0180-independent-quality-20261120`,
`task0180-independent-architecture-20261120`). Оператор утвердил этап ответом
«Да, реализуй этот этап» и public delivery уточнение ответом
«Да, продолжай с уточнением». Оставшиеся live/delivery проверки ниже
не входят в завершённый локальный объём.

## Основание

Оператор разрешил проверить фактическое покрытие, учитывать полезные новые
данные и отдельно запросил последнее значение Body Battery. Проектное решение
для реализации: [принятый ADR](../../../../docs/adr/20261120-garmin-observed-wellness-mapping.md).
Результаты анализа и ограничения находятся в timeline TASK-0180.

## Выполненная проверка

- 28 GET methods рассмотрены; 26 HTTP 200, один 204, один метод пропущен
  из-за неуточнённого `todayDate`. HTTP 200 не означает заполненные данные.
- За 14 дней подтверждён заполненный `bodyBattery.latestValue`, отдельно
  от min/max; точный timestamp измерения не подтверждён.
- В sleep record присутствуют средние пульс, SpO2 и дыхание; до mapping
  проверить единицы/контекст по официальным определениям.
- Исходный архив скачивается с корректным `Accept`; заявлен один FIT.
  Реальный payload decoder ещё не проверен. Raw файл не сохранён.
- Ключи не записывались диагностикой; значения здоровья и идентификаторы
  не публиковались. Shape DB, Intervals cutover и delivery не изменялись.

## Утверждённый локальный этап

1. Сверить официальную семантику трёх sleep fields. Не включать
   неоднозначные mappings только по имени поля.
2. Добавить optional nullable `bodyBatteryLatest` во внутренний provider
   contract и отдельный `body_battery` fact с точностью `local_date`.
3. Подключить подтверждённые средние sleep metrics к существующим полям.
   Не добавлять HRV RMSSD/sleep score до устранения семантических пробелов.
4. Проверить actual UI/Coach consumers и исправить формулировки, если они
   выдают дневной snapshot за свежее измерение. Расширить existing delivery
   enum по утверждённому уточнению ADR; новые migrations не нужны.
5. Проверить provider fixtures, correction/idempotency, provenance/erasure,
   совместимость Intervals, unit/typecheck и scoped PostgreSQL integration.
6. Независимые Quality и Architecture Review; после принятия обновить
   только затронутые current-state Wiki, запустить docs validator/diff check.

## Оставшиеся проверки вне реализации этого этапа

- Реальный FIT decoder: использовать обычное согласованное connection flow
  либо один заранее полный diagnostic run. Не запрашивать ключ повторно
  ради каждого отдельного вопроса; не читать существующие секреты самовольно.
- Точный timestamp Body Battery и HRV/sleep-score semantics; новые полезные
  показатели анализировать, но не добавлять domain entities без решения.
- Ключ с известным сроком: базовый renewal UX уже существует; хранение точной
  expiry date и advance warning требуют отдельного проектирования.
- Delivery: 11-key output несовместим с закешированной прежней закрытой
  MCP schema. Перед отдельно согласованной выкладкой обновить tool discovery /
  schema подключения и выполнить smoke-вызов; локальные проверки новой schema
  не доказывают готовность существующего подключённого клиента.

## Критерии приёмки

Уточнение Architecture Review утверждено 2026-11-20 ответом «Да, продолжай
с уточнением»: требуется additive `body_battery` в публичном
delivery enum с consent receipts и `asOf: null`; latest у Intervals остаётся
`unknown`. Legacy DailyAssessment использует только `instant body_battery`,
сохраняя min/max fallback для daily snapshots. Исходный план не предполагал
public schema extension; утверждённое уточнение разрешает это расширение.

- Latest/min/max имеют отдельные факты; пропуск/ноль/старая дата не превращаются
  в текущее измерение. Timestamp не выдуман.
- Повторная синхронизация и исправление latest сохраняют idempotency,
  consent generation, source references и erasure.
- Нет raw responses, secrets и personal identifiers в fixtures/reports.
- Независимая приёмка подтверждена; ограничения FIT/HRV/score явно названы.

Запись реальных фактов, переход с Intervals, migration apply, commit, push
и deployment не входят в этот локальный этап. Их отсутствие не отменяет
ранее предоставленное разрешение на read-only анализ.
