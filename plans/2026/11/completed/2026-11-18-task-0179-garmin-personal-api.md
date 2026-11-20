# TASK-0179 — Прямое подключение Garmin Personal API

Статус: согласованный локальный этап B завершён 2026-11-20, принят независимой
Quality и Architecture Review (`task0179-independent-quality-20261120`,
`task0179-independent-architecture-20261120`). Этап A завершён; Supplemental
Terms согласованы оператором 2026-11-18, empty-account linking исправлен
по его требованию. Локальная реализация утверждена 2026-11-20 сообщением «го».

Этап C, доступ к реальному аккаунту, переход с Intervals и доставка не входят
в выполненный объём и требуют отдельного разрешения. Их отсутствие не является
непринятой локальной реализацией. План перенесён в `completed/` по завершении
утверждённого локального объёма.

## Основание и объём

Архитектурная authority — [принятый ADR](../../../../docs/adr/20261118-connect-garmin-personal-api.md).
Цель: пользователь подключает свой Garmin, видит свои факты в Shape of You
и управляет доступом без обязательного Intervals аккаунта.

План разделён на проверяемые этапы. Утверждение этапа A не разрешает запись
реальных данных, переключение Intervals или этапы B/C. Реальные credentials,
staging, production, migration apply, staging файлов, commit и push требуют
соответствующих отдельных разрешений.

## Этап A — Контракт и готовность к реализации

1. Выполнено решением оператора 2026-11-18: Supplemental Terms согласованы им
   самостоятельно. Зафиксировать как operator confirmation, не как независимую
   проверку текста агентом. Не требовать повторного подтверждения.
2. Сверить Swagger и официальный client: account identity, token exchange,
   activity/FIT, существующие wellness metrics, limits, pagination, даты,
   доступность истории и remote revoke. Отсутствующее отметить явно.
3. Описать точные additive public schemas, auth/persistence extensions,
   маршруты и проверки Person scope. Описать input ключа, transient check,
   encrypted storage, token renewal, rotation, смену аккаунта, disconnect
   и sanitization. Не писать implementation до утверждения этого контракта.
4. Согласовать безопасный cross-provider cutover: сопоставление activities,
   provenance и семантика Recovery по датам/метрикам, retained history,
   ручные факты, ссылки Coach, erasure и rollback. Если нет доказанной identity,
   не объединять записи по похожим значениям и не запускать overlapping import.
5. Уточнить acceptance matrix и список migrations по текущему коду. Представить
   оператору результат и конкретный план этапа B. Обновить ADR после согласования.
   Существующие varchar provider/source и encrypted envelope позволяют обойтись
   без новых таблиц. Исправленный empty-account flow требует спроектированной
   в ADR nullable external identity и provider-specific check; additive migration
   следует отдельным gates. Согласование scope не заменяет operational gates.

## Этап B — Локальная реализация после отдельного утверждения

1. Добавить narrow personal-key auth и Garmin read adapter, существующий
   worker и connection lifecycle; сохранить Intervals compatibility.
2. Реализовать мастер и status/rotation/disconnect/history controls.
   Сначала rolling window; историю запускать только явно.
3. Нормализовать только подтверждённые значения в существующие Recovery и
   Training contracts. Переиспользовать FIT decoder через корректную module
   boundary; не переносить Intervals-specific load semantics в Garmin mapping.
4. Сохранить consent fencing, idempotent corrections, imported fact pointers,
   delivery evidence и erasure. Проверить запрет overlapping imports.
5. Выполнить focused unit, PostgreSQL integration, Web component/E2E,
   typecheck/build, static secret-redaction и identifier checks, docs validation.
6. Провести independent Quality и Architecture Review, обновить только
   затронутые current-state Wiki страницы после приёмки. Этапы A/B не означают
   успешную проверку реального Garmin account.

## Этап C — Реальное сравнение и переход по отдельному разрешению

1. На явно разрешённом аккаунте проверить coverage и историю read-only без
   импорта второго набора фактов. В отчёт передавать агрегированные результаты,
   не secrets, raw payload или персональные детали.
2. Применить отдельно утверждённый cutover контракт. До подтверждения результатов
   сохранять Intervals как рабочий путь; не запускать два конкурирующих writer.
3. Проверить отсутствие дублей, сохранение provenance/history/Coach links и
   восстановление после сбоя. Зафиксировать exact delivery evidence и
   оставшиеся operational gates. Перенести план в `completed/` только после
   завершения его окончательно согласованного объёма.

## Затронутые области

- `apps/api/src/integrations/`: auth/read ports, service, worker, Garmin adapter,
  credential cipher; текущий repository фиксирует `intervals_icu`.
- `apps/api/src/storage/integration-repository.ts` и API-owned schema/migrations.
- Shared contracts, Recovery/Training import и existing erasure boundary.
- `apps/web/app/pages/connections.vue`, `apps/web/app/lib/integration-api.ts`.
- Provider contract/unit/integration tests, Web tests и affected Wiki pages.

## Критерии приёмки

- Каждый пользователь читает только свои Garmin-derived facts; ключи и tokens
  не появляются в projections, URL, logs, telemetry и browser persistence.
- Проверка/отмена не запускает импорт; activation требует consent.
- Истечение и ротация не создают новый аккаунт по догадке, не уничтожают историю
  и не допускают запись stale worker после disconnect.
- Смысл и единицы каждого поля подтверждены; неподдерживаемое не превращается
  в ноль, Garmin Readiness или Intervals training load.
- Повтор rolling/history не создаёт дублей. Переход с Intervals проверяет
  cross-provider identity и сохраняет correction/erasure ownership.
- Успех проверки доступа не выдаётся за успешный импорт; UI сообщает фактическую
  свежесть/coverage и безопасные recoverable failures.
- Согласование Supplemental Terms оператором записано; consent и Person
  isolation сохраняются для каждого подключения.

## Проверки проектного этапа

Исходный docs validator: 54 Wiki pages / 139 ADRs, passed. Прочитаны точные
integration contracts/service/repository и canonical Connections/Recovery docs.
Garmin FAQ перепроверен 2026-11-18. Supplemental Terms закрыты решением
оператора, а не техническим выводом агента. Implementation tests не применимы
к проекту плана. Независимая Quality реализации этапа B выполнена позднее;
результат приведён ниже.

Официальная Swagger page получена напрямую: извлечена опубликованная
OpenAPI `3.0.1`, API `1.0.0`, 28 read endpoints / 112 schemas. Документ находится
во временном исследовательском файле, не является Wiki mirror или runtime
dependency. Endpoint/DTO mappings и новый public API contract записаны только
в ADR. Auth формат сверён с официальными `auth.py`/`constants.py`/`client.py`.

Независимый Architecture Review выявил и внёс в проект: provider-scoped worker
claims и erasure routing, consent-fenced disconnect completion, symmetric
retained-evidence overlap guard, Garmin-only configuration, Coach delivery
evidence routing, ZIP parsing до FIT decoder. Review не является Quality
acceptance отсутствующей реализации.

## Уточнённая последовательность этапа B

С учётом требования бесшовного empty-account linking выполнять минимальную
последовательность после согласования конкретного контракта, без нового framework:

1. Additive Garmin contracts и safe HTTP endpoints из ADR; проверка ключа
   без persistence, activation только с consent. Existing Intervals contracts
   и callback URLs сохраняются.
2. Узкий context для двух providers в repository/service/worker; все claims
   и erasure dispatch однозначны, availability отделена от Intervals config.
3. Под тем же Person lock защищать обе стороны подключения от concurrent
   activation и retained history overlap. Не переносить/удалять факты пользователя.
4. Personal-key auth, connection/consent-bound memory token cache,
   same-account rotation, atomic local disconnect. Старое завершение remote
   disconnect не может удалить credentials новой consent generation.
5. Garmin normalizer только для доказанных DTO semantics; размер/схема/даты/
   int64/integrity проверяются до typed facts. HRV statistic/unit и sleep-score
   map key не устанавливать по названию поля. Неподтверждённые метрики остаются
   явным coverage gap до первичного подтверждения.
6. Подключить existing Recovery delivery receipt/pointer checks к выбранному
   provider, затем Web wizard и lifecycle controls.
7. Проверить matrix: два concurrent providers, late callback после rotation,
   retained-history refusal, reauth с другим account, erasure без key,
   Garmin-only config, pagination resume и bounded ZIP. Затем обычные
   build/typecheck/unit/integration/Web checks, independent Quality и docs.

UX вопрос закрыт ответом оператора: вставка валидного ключа должна подключать
аккаунт без предварительной синхронизации часов. Token exchange/authenticated
read проверяют доступ; account identity уточняется по первым поступившим данным
внутри worker, не через дополнительный шаг пользователя. Добавить проверки
успешного подключения пустого аккаунта, deferred identity binding и conflict
при rotation; до подтверждения новой account identity не смешивать факты.

Восемь исходных dirty files вне объёма TASK-0179 не изменялись и исключены
из предлагаемого commit. После независимой приёмки обновлены Connections,
backend runtime, Recovery, Training и API AGENTS: локально реализованный
контракт отделён от непроверенных live coverage/rollout.


## Результат локального этапа B

- Реализованы additive public schemas/OpenAPI, прямой personal-key flow,
  зашифрованное хранение и внутреннее связывание account ID без барьера для
  пустого аккаунта. В UI — одно подключение с явным consent, обновление ключа,
  история, отключение и existing passkey erasure.
- Provider claims и erasure маршрутизируются явно; старые consent/callback/
  ответы опроса не перезаписывают новое состояние. Проверены симметричный
  отказ от overlapping retained history, запись без дублей и Coach delivery.
- Миграция `20261120120000_garmin_personal_identity.sql` создана и проверена
  только в изолированных synthetic базах; Intervals identity остаётся обязательной.
  Дополнительные deployable, database, domain entity и зависимости не добавлены.
- Первый direct mapping ограничен sleep duration, explicit RHR, BB min/max,
  steps и activity/FIT. HRV, sleep score, night HR, SpO2 и respiration пока
  не импортируются; их delivery status остаётся `unknown`, а не ложным отсутствием.
  Это ограничение не заменяет существующую Intervals-интеграцию автоматически.
- Memory token cache ограничен и привязан к connection/consent; отозванные
  scopes не возобновляются после позднего ответа. Реестр отзыва имеет предел
  10 000 scopes; исчерпание fail-closed до перезапуска процесса.

## Проверки и независимая приёмка

- API unit: 473/473; typecheck, build и scoped ESLint passed.
- Direct Garmin PostgreSQL/HTTP: 13/13, включая пустой аккаунт, invalid key422,
  явную историю, rate limit, identity rotation, Person scope, оба направления
  retained-history guard, current-consent receipts и provider routing.
- Существующие Recovery: 19/19; migration chain: 79/79, включая clean/idempotent
  apply, upgrades всех journal prefixes, 63-byte identifier guard и dump/restore.
- Docker недоступен. Lead использовал собственный временный native PostgreSQL
  на `127.0.0.1:55479` в `/private/tmp/soy-task0179-pg-20261120`, только
  synthetic базы. Existing suites запускались через временный testcontainers
  adapter, без изменения их проверок. UTC приведён к стандартной Docker
  среде после первоначальных timezone-only failures. Legacy error wording
  сохранён после выявленного regression; финальные 98/98 passed.
- Web lint/typecheck/static build и 34 unit passed; полный E2E31 до polling
  rework и final focused Garmin E2E3 после него passed. Начальный неверный
  E2E Identity origin исправлен на localhost до итогового прогона.
- Reviewer самостоятельно повторил direct PostgreSQL13, API scoped unit52,
  Web adapter4, Garmin E2E3, API typecheck, docs и diff checks. Все критерии
  локального этапа приняты. Это независимая проверка отдельным агентом.
- Source-backed current-state Wiki обновлена после quality_acceptance.
  Канонический docs validator и финальный diff check — обязательны перед отчётом.

## Architecture Review

1. Узкий context двух providers переиспользует существующие connection/inbox/
   receipt/typed-fact модели; универсальный integration framework не введён.
2. Новых сервисов и deployable boundaries нет; worker остаётся внутри API.
3. Person ownership, Recovery/Training responsibilities, corrections и
   fail-closed journal erasure сохранены.
4. Authority — принятый ADR; Wiki описывает current state со ссылкой на него;
   план фиксирует исполнение и ограничения. Managed Wiki не использовалась.
5. Worker lease 15 минут покрывает bounded transport/FIT budget без нового
   heartbeat scheduler; произвольные database stalls не объявляются ограниченными
   этим временем. Более простого решения с теми же гарантиями review не выявил.

## Операционный статус

Миграция создана; test harness выполнил её в собственном временном synthetic
PostgreSQL Lead, включая clean/prefix/idempotency checks. Для TASK-0179 не
выполнялись staging файлов, commit, push, CI/CD dispatch, применение миграции
к staging/production или smoke реального Garmin аккаунта.

Проверены текущие delivery workflow и canonical deployment docs: публикация
образов и `Promote staging` — отдельные шаги; promotion выполняет migrations
и smoke. Эта задача pipeline не запускала, поэтому ни application этой миграции,
ни runtime readiness/rollout TASK-0179 в именованных средах не подтверждены.
Существующие окружения не диагностировались. Следующий отдельно разрешаемый
этап — доставка локального изменения и live read-only coverage check; смена
источника с retained Intervals history требует своего cutover контракта.
