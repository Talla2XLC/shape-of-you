# TASK-0106 — Импорт истории Intervals.icu по запросу пользователя

## Цель

Дать пользователю отдельную управляемую кнопку для импорта всей доступной
истории Intervals.icu, не запускать такой импорт при OAuth и ясно разделить
импорт, disconnect и необратимое удаление данных.

## Объём

1. Расширить browser contract состояния подключения полями исторического
   импорта: статус, достигнутая дата, время запроса, последней попытки и
   завершения, безопасный failure code.
2. Добавить аутентифицированный CSRF-protected endpoint запуска истории для
   текущего Person. Запрос должен быть идемпотентным при уже активном импорте и
   отклоняться для неактивного подключения.
3. Расширить `integration_connections` долговременными полями состояния,
   курсора и retry. Создать Drizzle migration и статически проверить все новые
   PostgreSQL identifiers на предел 63 UTF-8 bytes; migration не применять без
   отдельного разрешения.
4. Расширить `IntegrationStore` атомарными операциями запуска, продвижения,
   завершения и безопасной фиксации ошибки исторического импорта.
5. В существующем `IntegrationWorker` обрабатывать не более одного окна до 180
   дней после актуальной синхронизации и только после явного пользовательского
   запуска. Продолжать с сохранённого курсора после рестарта.
6. Пропускать историю через существующие provider validation, normalization,
   inbox, Recovery и Training import paths без отдельной raw JSON модели.
7. Обеспечить duplicate no-op, typed correction/supersession, безопасный retry,
   сохранение старых данных при ошибке и остановку нового импорта после
   disconnect.
8. На Connections добавить compact secondary action
   `Import historical data…`, подтверждение запуска и отдельное состояние
   прогресса.
9. Переименовать destructive action в `Delete imported data…`, вынести её в
   компактную `Danger zone` и показать пояснение о результате и обязательном
   passkey. Не менять fresh-passkey и fail-closed erasure lifecycle.
10. После независимой Quality-проверки обновить только затронутую текущую Wiki
    страницу о Connections и провести Architecture Review.

## Не входит

- автоматический запуск полной истории после подключения или OAuth callback;
- выбор произвольной начальной даты пользователем;
- прямой Garmin API, неофициальный Garmin client или browser scraping;
- новый микросервис, отдельная deployable worker boundary или универсальная
  job queue;
- обещание Body Battery либо другой метрики, отсутствующей в Intervals.icu;
- новые credentials, secrets, зависимости или ручная настройка VM;
- применение миграции, commit, push, deployment и production/VM-операции.

## Затронутые области

- `packages/contracts/src/integration-connection.ts` и generated contract
  artifacts;
- `apps/api/src/database/schema.ts` и новая migration в `apps/api/drizzle/`;
- `apps/api/src/integrations/` repository, service, controller, worker и fake
  provider boundaries;
- `apps/api/src/openapi.ts`;
- `apps/web/app/lib/integration-api.ts`;
- `apps/web/app/pages/connections.vue` и точечные connection/danger styles в
  `apps/web/app/assets/css/main.css`;
- targeted API/Web unit, integration и e2e tests;
- после Quality acceptance — `docs/wiki/api/connections.md`.

## Порядок реализации

1. Обновить shared schema и безопасную browser projection.
2. Добавить schema fields и migration без её применения.
3. Реализовать атомарный persistence lifecycle исторического импорта.
4. Добавить start endpoint и orchestration в service/worker.
5. Повторно использовать общий typed import path для rolling и historical
   ranges; при необходимости выделить только внутренний helper без изменения
   доменной модели.
6. Добавить fake-provider и repository/service/worker tests.
7. Реализовать Connections UX и frontend tests.
8. Выполнить Developer report, затем независимую Quality-проверку без
   промежуточного operator gate.
9. После отдельного разрешения обновить затронутую Wiki, выполнить Architecture
   Review и подготовить release/commit plan.

## Критерии приёмки

1. Подключение и OAuth не запускают полный исторический импорт.
2. Только пользовательская кнопка `Import historical data…` создаёт durable
   historical import для активного подключения.
3. Worker последовательно проходит ограниченные окна назад до `2000-01-01`,
   сохраняет курсор и продолжает после рестарта без дубликатов.
4. Актуальная синхронизация остаётся приоритетной и не ломается из-за ошибки
   исторического импорта.
5. Пользователь видит `not requested`, progress, completion или безопасную
   ошибку; чувствительные provider details не раскрываются.
6. Disconnect прекращает новый импорт, но сохраняет данные.
7. `Delete imported data…` остаётся отдельным passkey-gated действием и удаляет
   также исторически импортированные данные через существующий fail-closed
   journal lifecycle.
8. Destructive control компактен и визуально не выглядит основным действием на
   desktop и узком viewport.
9. Повторный запуск/повторная доставка не создают дубликаты, а изменённые записи
   проходят typed correction/supersession.
10. Новые secrets, ручные VM changes и новый deployable service отсутствуют.

## Проверки

- contracts schema tests и OpenAPI assertions;
- API unit tests для start/status/error mapping;
- PostgreSQL repository/integration tests для cursor/state transitions,
  restart resume, duplicate no-op, correction и disconnect race;
- worker/fake-provider tests для bounded range traversal и retry;
- Web unit/e2e tests для copy, confirmation, progress и narrow viewport;
- API/Web lint, typecheck, build и полные доступные test suites;
- статическая проверка PostgreSQL identifiers;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`.

## Approval gates

- Этот план требует явного одобрения до первого implementation patch.
- Создать migration разрешается после одобрения плана; применять её нельзя без
  отдельного подтверждения.
- Wiki write после Quality acceptance, commit, push, deployment и любые
  production/VM-операции требуют отдельных подтверждений.

