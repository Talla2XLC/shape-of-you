# TASK-0185 — Кнопка Sync now и понятный статус синхронизации

Статус: локальная реализация принята; доставка ведётся через release timeline TASK-0185.

## Цель

Позволить пользователю запросить текущую синхронизацию без повторного ввода
ключа и видеть очередь, выполнение и результат, в том числе после reconnect.

## Предлагаемые границы

ADR: `docs/adr/20261122-request-garmin-sync-through-existing-worker.md`.
Один защищённый endpoint, вычисляемая sync metadata в direct Garmin projection,
существующие scheduler/lease/fences/backoff. Без новых таблиц и миграций.

## План после согласования

1. Реализовать атомарный запрос текущего импорта и безопасную status projection.
2. Добавить controller/schema и явные eligibility/cooldown/coalescing проверки.
3. Добавить кнопку, состояния и polling без потери результата при stale responses.
4. Проверить PostgreSQL concurrency/security и browser success/failure/reload.
5. Пройти независимые Quality и Architecture Review; обновить affected Wiki.
6. Пройти полный local gate и согласованную CI/staging delivery до smoke.

Production и ручное изменение connection/scheduler в live DB не входят в scope.

## Результаты локального этапа

Endpoint `sync` возвращает `202`, новый safe `sync` status вычисляется из
существующих admission/due/lease. Повторные запросы не создают новую очередь,
не сбрасывают lease/history и не обходят backoff/consent/erasure/cutover guards.
UI показывает ожидание/выполнение, отдельно подтверждает новый результат,
сохраняет status после reload и не доверяет stale polling responses.

Независимо прошли PG/HTTP 36, API unit 26, Web unit 32 и новые browser cases.
Полный Web E2E 38/38, повтор новых основных сценариев 15/15, API/Web typecheck,
scoped lint и docs validator прошли. Снимок running на 320 px просмотрен.
Независимые Quality и Architecture Review приняты; affected Wiki обновлена.
Новых migrations/таблиц нет. Полный exact-HEAD pre-push, CI и staging smoke
обязательны в release этапе до объявления доставки завершённой.
