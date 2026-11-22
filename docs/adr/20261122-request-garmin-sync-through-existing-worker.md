---
id: request-garmin-sync-through-existing-worker
kind: adr
title: "Запрашивать ручную синхронизацию Garmin через существующий worker"
status: accepted
date: 2026-11-22
supersedes: []
superseded_by: null
tags:
  - architecture
  - garmin
  - api
---

# Запрашивать ручную синхронизацию Garmin через существующий worker

## Context

Оператор запросил кнопку Sync now. После подключения автоматический импорт
уже планируется, но UI показывает Not yet без понятного состояния ожидания.
Долгие provider requests выполняет существующий IntegrationWorker, с durable
nextAttemptAt, lease и проверками Person/consent/erasure/cutover.

## Decision

Оператор согласовал 2026-11-22. Добавить CSRF-защищённый `POST /v1/integrations/garmin-personal/sync`
без ключа в запросе. Endpoint возвращает `202` с безопасной Garmin projection,
которая подтверждает запрос или уже выполняющуюся синхронизацию, а не успешный
импорт. Действует только на текущего авторизованного Person.

Запрос атомарно приближает существующий nextAttemptAt под Person lock.
Уже ожидающий или выполняющийся импорт объединяется с запросом. Lease не
сбрасывается, параллельный reconcile не запускается. История и её cursor не
перезапускаются; используется обычный rolling import и все действующие fences.
Между завершённой попыткой и новой ручной попыткой выдерживается минимум
60 секунд; действующий provider backoff не сокращается. Повторные запросы
не откладывают уже запланированную работу.

Garmin projection дополняется `sync` с `state` (`scheduled`, `queued`, `running`,
`blocked`) и nullable `nextAttemptAt`. Это вычисляемая metadata существующей
connection, не новая сущность или очередь. `blocked` означает отсутствие
действующего права на импорт, включая необходимость заменить ключ. Future due
time означает scheduled, наступившее время — queued, действующий lease — running.
Принятие запроса и отображение metadata не обходят ограничения доступа.

UI показывает Sync now, состояние ожидания/работы и отдельный результат по
lastAttemptAt/lastSuccessfulSyncAt/failureCode. Queued/running видны и после
обновления страницы, включая первый автоматический импорт. На время ожидания
кнопка защищена от повторного запуска; status polling не обращается к Garmin.
Недоступный endpoint или неопределённый результат не изображается успехом.

Новые tables, migrations, services, credentials и job infrastructure не нужны.
Добавление endpoint и поля публичной схемы требует согласования до реализации.

## Considered alternatives

- Запустить reconcile внутри HTTP request: долгое ожидание и неоднозначный
  результат при разрыве связи; повышает риск дублирования. Отклонено.
- Создать отдельную durable очередь ручных jobs: дублирует существующий
  scheduler/lease и усложняет данные без необходимости. Отклонено.
- Только обновлять страницу или запускать historical import: не выполняет
  запрос ручной текущей синхронизации. Отклонено.
- Использовать существующий worker и вычисляемый статус: предлагаемый вариант.

## Consequences

Кнопка запрашивает приоритетную попытку, но не обещает мгновенного завершения.
Работу подхватывает существующий worker; rate limits, backoff и активный lease
сохраняют силу. Пользователь видит ожидание, факт выполнения и результат раздельно.
Публичное расширение ограничено direct Garmin; legacy contracts не меняются.

## Verification

API/PostgreSQL tests: Person isolation, CSRF, eligibility, повторные запросы,
активный lease, минимальный интервал, provider backoff, отсутствие сброса history
и safety fences при disconnect/consent rotation/erasure. Browser tests: запрос
без ключа, queued/running/success/failure, reload, polling races и mobile layout.
Независимые Quality и Architecture Review, полный local gate и фактическая
CI/staging delivery проверяются перед завершением.

## Related material

- [Connections API](../wiki/api/connections.md)
- [Прямое подключение Garmin](20261118-connect-garmin-personal-api.md)
