---
id: connect-garmin-personal-api
kind: adr
title: "Подключать личные Garmin-данные через Personal API"
status: accepted
date: 2026-11-18
supersedes: []
superseded_by: null
tags:
  - architecture
  - integrations
  - recovery
  - training
  - privacy
---

# Подключать личные Garmin-данные через Personal API

## Context

Оператор согласовал направление прямого подключения собственного Garmin
аккаунта и аналогичного доступа брата/друзей к своим данным внутри Shape of You.
Продажа доступа не входит в сценарий. TASK-0179 оформляет подробный контракт
и implementation plan; согласие с направлением не означает одобрение всех
уточнений ниже или разрешение на реальные credentials и переключение импорта.

Garmin документирует Personal API с самостоятельно созданным ключом,
обменом на access token сроком до 24 часов и повторным обменом без refresh token.
Срок ключа выбирается владельцем: 30/90/180 дней либо год. Это отдельный
способ авторизации, а не браузерный OAuth authorization-code flow.

FAQ ориентирован на собственные данные и отдельно исключает intended use
для commercial applications serving multiple end users. 2026-11-18 оператор
сообщил, что самостоятельно согласовал Supplemental Terms Garmin, и поручил
продолжить. Для данной задачи проверка условий закрыта решением оператора;
повторное получение текста и независимое юридическое заключение не требуются.
Это не утверждение, что агент самостоятельно проверил текст условий.

Текущие интеграционные port, repository и публичные contracts содержат
OAuth/Intervals-specific assumptions. Recovery и Training уже принимают
типизированные факты, но дедупликация в импорте привязана к connection.
Подключение второго provider само по себе не устраняет дубли одного события.

## Decision

Контракт принят оператором 2026-11-20 сообщением «го» после исправления
empty-account flow. Разрешена локальная реализация этапа B, включая
описанное additive schema изменение; live credentials, cutover и delivery
остаются вне разрешения.

1. Добавить прямой Garmin adapter внутри существующего `apps/api` и его
   worker. Сохранить владельцев Person/Recovery/Training, typed commands,
   corrections, consent fencing и journal-backed erasure. Нового сервиса,
   базы или универсального integration framework не создавать.
2. В существующей странице Connections показать мастер: описание читаемых
   данных → ссылка на Garmin Personal API Key → скрытое поле ключа →
   проверка → явное согласие на подключение и автоматический импорт.
   Пароль Garmin не запрашивать. Настройка не обещает OAuth redirect.
3. Проверка ключа не создаёт доменные факты и не включает worker.
   Проверку повторить при подтверждении; длительное серверное хранение
   начинается только вместе с connection и consent. До этого ключ находится
   только в памяти текущего мастера и очищается при закрытии/отмене.
   Секрет не сохраняется в browser storage, URL, telemetry или логах.
4. Использовать существующую сущность connection с отдельным provider key
   `garmin_personal` и способом авторизации personal key. Разделить
   авторизацию и чтение данных узкими контрактами: не эмулировать OAuth
   callback для ключа. Новые provider metadata и contract extensions
   проектируются до implementation и не меняют смысл старых Intervals URLs.
5. Долгоживущий ключ хранится authenticated-encrypted с привязкой к provider,
   Person и connection. Access token — краткоживущий, server-side; получать
   новый до истечения и сериализовать обновления в пределах connection.
   Публичная projection не содержит credential, fingerprint или внешних IDs.
6. Изоляция основана на authenticated Person, а не на Person ID из формы.
   Переподключение того же аккаунта сохраняет историю и меняет consent
   generation. Доступность внешнего account ID не является условием первого
   подключения: проверенный ключ активирует локальную Person-owned connection
   даже у пустого Garmin аккаунта. Account identity уточняется внутри импорта.
   Отсутствующий внешний ID не заменяется именем или fingerprint ключа.
7. Статус показывает lifecycle, последнюю попытку/успешную синхронизацию,
   фактическое наличие данных и безопасную причину сбоя. Истёкший/отозванный
   ключ требует обновить доступ. Точную дату истечения показывать только при
   подтверждённом источнике; срок access token не считать сроком API key.
   Уточнение оператора 2026-11-20: создан ключ на год; для других пользователей
   срок не предполагается равным году автоматически. При auth failure показать
   действие «Обновить ключ» и короткую инструкцию: открыть Personal API Key
   в Garmin → создать/скопировать новый ключ → вставить в Shape of You.
   Сохранённая история остаётся доступной, а sync не объявляется актуальным.
   Если точная дата окончания достоверно известна, её можно показывать и
   использовать для предварительного предупреждения; отсутствие даты не
   блокирует подключение. `401/403` сами по себе не доказывают, что причина
   именно истечение срока: отзыв и неверный ключ требуют того же безопасного
   восстановления доступа. Успешная проверка нового ключа должна предшествовать
   замене credential; неудача не удаляет рабочую конфигурацию или историю.
8. Первое подключение запускает bounded rolling import последних 14 дней.
   Полная история — отдельное явное действие с прогрессом и возобновлением.
   Окна запросов и pagination определяются документированными ограничениями
   каждого endpoint, а не текущим Intervals history window в 180 дней.
9. Первый этап импортирует только подтверждённые эквиваленты существующих
   метрик и activity/FIT contracts. Не приравнивать Garmin training load
   к Intervals relative training stress. Training Readiness, текущий Recovery
   Time, новые wellness semantics и произвольные raw JSON не добавлять по догадке.
10. Disconnect атомарно выключает импорт, отзывает локальный consent и удаляет
    локальный ключ/кеш token; stale workers не могут записать факты или статус.
    Отзыв ключа в Garmin — отдельное действие владельца, пока remote revoke
    endpoint не подтверждён. Локальное удаление секрета не выдавать за Garmin
    revocation. Сохранённые факты удаляются отдельным существующим erasure flow.
11. Не переключать существующий Intervals import автоматически. До cutover
    необходим отдельный утверждённый контракт cross-provider identity,
    Recovery precedence, сохранения ссылок на history, rollback и erasure.
    До него direct import разрешается только для Person без пересекающихся
    Intervals facts/активного импорта, с проверкой на сервере. Для существующего
    пользователя доступны проектирование и отдельно разрешённое read-only
    сравнение без записи второго набора доменных фактов.
12. Согласование Supplemental Terms подтверждено оператором 2026-11-18.
    Не вводить повторный terms approval gate в UI или delivery workflow.
    Сохраняются обычный consent на импорт данных и отдельные operational gates.

### Уточнённый контракт подключения

Additive API локального этапа B реализован; действующие
`/v1/integrations/garmin-intervals` endpoints сохраняются.

| Endpoint | Назначение и данные |
| --- | --- |
| `GET /v1/integrations/garmin-personal` | Safe connection projection с `provider = garmin_personal`, `displayName = Garmin`, существующими lifecycle/sync/history fields |
| `POST /v1/integrations/garmin-personal/check` | `{ apiKey }`; возвращает только `verified: true` либо bounded error; не сохраняет credential или факты |
| `POST /v1/integrations/garmin-personal/connect` | `{ apiKey, consent: true }`; повторно проверяет доступ и активирует connection атомарно, независимо от наличия health/activity records |
| `POST /v1/integrations/garmin-personal/disconnect` | Существующий `{ reason }`; локально прекращает доступ без ложного remote revoke |
| `POST /v1/integrations/garmin-personal/historical-import` | Явный запуск/возобновление истории; возвращает ту же safe projection |

Все mutations используют существующие authenticated Person и CSRF guards;
responses — `no-store`. `apiKey` — непустая строка без whitespace/control
characters, максимум 4096 символов; точную длину текущего ключа не зашивать.
Не отдавать input в validation errors. `check` и `connect` имеют bounded
request timeout и rate limit на Person; конкретные значения фиксируются
в developer timeline до patch. Произвольный provider URL от клиента запрещён.

Кнопка обновления доступа использует тот же `connect`: сохраняются stable
локальные connection IDs, выдаётся новая consent generation. Если внешняя
account identity уже известна, импорт после ротации подтверждает её до записи
новых фактов. Новый ключ проверяется до замены работающего; провал
проверки не выключает существующее подключение. Concurrent checks не означают
успешного подключения; для activation повторно проверяются текущие version,
consent и erasure state под Person evidence lock.

Официальная Swagger schema `UserSettingsDTO` содержит `displayName`,
`timeZone` и preferences, но не содержит stable account ID. Имя, timezone,
key fingerprint и недокументированные JWT claims не являются account identity.
Стабильный numeric profile ID документирован в `DailyHeartRateDTO.userProfilePK`,
`DailySleepDTO.userProfilePK`, `HrvChartDTO.userProfilePk` и
`UserDailySummaryV2DTO.userProfilePk`. В background import сверяются IDs
полученных записей; первый подтверждённый ID атомарно связывается с локальной
connection под текущей consent generation до записи соответствующих фактов.
Пока данных нет, подключение работает и UI показывает «Подключено, данных пока
нет». Синхронизация часов, история и наличие тренировки не являются
предварительными требованиями. `check` проверяет ключ через token exchange
и документированный authenticated read, а не через наличие activity records.
После ротации несовпадение с ранее установленным ID останавливает запись новых
фактов и предлагает явную смену аккаунта; старые данные не объединяются и не
удаляются. Отсутствие ID в отдельной записи не разрешает приписать её старому
аккаунту. Обновление ключа без данных не выдаётся за доказанное совпадение аккаунтов.
Числовые int64 IDs требуют lossless parsing: округлённый JS number не принимается.

### Provider routing, persistence и import boundary

Существующие `integration_connections.provider_key`, credential envelope
и unique Person/provider допускают новый provider без новой таблицы.
Для подключения до появления данных предлагается nullable `external_user_id`
у `garmin_personal`: null означает «внешний ID пока неизвестен», а не новую
внешнюю identity. Для `intervals_icu` сохраняется обязательный непустой ID.
Изменение nullable/check constraint требует additive API-owned migration;
её создание и применение следуют соответствующим approval gates. Отдельная
таблица account identity и фиктивные sentinel IDs не нужны.

Provider context параметризует текущий repository и transport; claims,
`findActive`, status, authorization identity и erasure lookup фильтруются по
provider. Общий entrypoint выбирает provider явно; transport не определяет
его по форме credential. Recovery delivery evidence маршрутизируется к тому
же provider с сохранением exact receipt/pointer/consent semantics.
Garmin availability зависит от database и encryption configuration,
независимо от Intervals OAuth client configuration.

Защита от пересечения симметрична: Garmin connect и Intervals callback проверяют
чужой active import и retained provider-derived Recovery/Training evidence
под одним Person evidence lock. Disconnect сам по себе не освобождает право
на overlapping import. Автоматическое удаление старой истории ради подключения
запрещено. Отдельный cutover contract остаётся за пределами первого writer.

При завершении старого disconnect/revoke сохраняется expected consent
generation: поздний ответ Intervals не может очистить новый Garmin/Intervals
credential. Garmin disconnect очищает локальный key/cache сразу под тем же
lock, без remote-disconnect retry. Erasure работает и после disconnect,
когда ключа уже нет. Кеш access token ограничен по размеру, находится только
в памяти и связан с connection + consent generation; при ротации инвалидируется.

### Проверенный provider data contract

Первичный источник — OpenAPI `3.0.1`, API version `1.0.0`, встроенный в
официальную Swagger page, прочитан 2026-11-18. Официальный Python client
используется для проверки HTTP формата, а не как runtime dependency.

| Данные | Метод/поле и правило |
| --- | --- |
| Авторизация | `POST /personalapitoken-service/personal-api/personal-api-key/token`, `Authorization: ApiKey …`, `Accept: */*`; response — plain JWT text, не JSON OAuth envelope |
| Профиль | `GET /userprofile-service/userprofile/settings`; валидировать timezone; не выдавать displayName за identity |
| Сон | `GET /sleep-service/sleep/dailySleep?date=…`; `sleepTimeSeconds / 60`, без автоматического добавления `napTimeSeconds`; `sleepScores` — map `SleepScoreItem`, точный overall key/value валидируется до импорта |
| Пульс покоя | `GET /wellness-service/wellness/dailyHeartRate?date=…`, `restingHeartRate`; не брать `minHeartRate`, seven-day average или `HeartRateV2DTO.restingValue`, который документирован с fallback на minimum |
| HRV | `GET /hrv-service/hrv/{calendarDate}` → `hrvSummary.lastNightAvg`; не использовать `weeklyAvg` или status. Единицы и RMSSD semantics требуют подтверждения перед domain mapping |
| Шаги | `GET /usersummary-service/v2/dailysummaries` → `data[].movement.steps.value`; текущий день остаётся partial; свежесть только по документированному `wellnessChronology.endTimestampGmt`, не по времени fetch |
| Body Battery | Тот же daily summary → `bodyBattery.minValue/maxValue`; не заменять ими current/latest value |
| Activity list | `GET /activitylist-service/activities/search/activities`; `start/limit`, inclusive local `startDate/endDate`; возвращает array `SummarizedActivityDTO`, не вложенный `ActivitySummaryDTO` |
| Activity detail | `GET /activity-service/activity/{activityId}` → `ActivitySummaryDTO`, `summaryDTO`, `timeZoneUnitDTO`; UTC timestamps без `Z` обрабатываются по явно документированному GMT contract |
| Исходный файл | `GET /download-service/files/activity/{activityId}` → ZIP; bounded archive parsing до существующего FIT decoder, без записи/распаковки на диск |

HTTP `204` означает отсутствие данных, `401/403` — bounded auth failure,
`429` — backoff; произвольный body не сохраняется и не возвращается.
ZIP parsing ограничивает compressed/uncompressed size, число entries и
поддерживаемые методы compression, проверяет integrity и принимает только
однозначный исходный FIT. Неверный/неоднозначный архив не объявляется
отсутствующей тренировкой и не удаляет старые details.

Range daily summary допускает максимум год, остальные range endpoints
имеют собственные ограничения. История обходит bounded windows, pagination
не продвигает cursor при неполном результате. Пустое окно не означает конец
всей истории. Полноту нового adapter нельзя обещать по списку endpoint names.

## Considered alternatives

- **Оставить Intervals.icu единственным каналом.** Минимальный риск изменений,
  но сохраняет дополнительную настройку и промежуточную потерю wellness coverage.
  Сохраняется рабочим каналом до проверенного перехода.
- **Garmin application authorization через Developer Program.** Предпочтительный
  UX без копирования личного ключа, но требует регистрации и подтверждения
  app access. Не считать слово Business доказательством обязательной продажи
  продукта или недоступности бесплатному проекту.
- **Personal API key в мастере.** Доступный документированный способ для
  собственных данных. Цена выбора — ручная настройка/ротация и server-side
  custody. Согласование условий подтверждено оператором 2026-11-18.
- **Локальный connector у каждого пользователя.** Может держать ключ под
  контролем владельца, но добавляет установку и отдельный runtime. Не выбран
  без необходимости; сам по себе не является подтверждением соблюдения terms.
- **Одновременный импорт двух каналов с эвристическим dedupe.** Отклонён:
  одинаковые время/значения не доказывают identity, а ошибочное объединение
  нарушит provenance, corrections и erasure.

## Consequences

- Потенциально исчезает обязательная зависимость пользователя от Intervals;
  до cutover текущий канал и прежний ADR остаются действующими.
- Копирование ключа остаётся пользовательским шагом; ротацию нельзя обещать
  полностью автоматической. Недоступность Garmin не блокирует чтение локальных фактов.
- Нужны изменения provider/auth contracts, persistence и UX, которые будут
  уточнены в implementation plan. Новые migrations требуют отдельных gates.
- Решение оператора по Supplemental Terms записано как входное подтверждение,
  отдельно от технических доказательств API coverage.

## Verification

- Contract fixtures: token exchange/expiry/revocation, endpoint schemas,
  pagination, timezone, единицы и null/absent semantics. Только synthetic data
  до отдельного разрешения на named live account.
- Unit/PostgreSQL/Web checks: Person isolation, secret redaction, cancel,
  invalid key, concurrent rotation, disconnect races, checksum replay,
  consent generation, retained history и erasure.
- Проверить отказ от пересекающегося импорта и отсутствие ложного account
  matching. Cutover не проходит без отдельно принятого identity контракта.
- Валидный ключ пустого аккаунта успешно подключается без health/activity
  records. Первый поступивший ID привязывается под consent fence; конфликт
  IDs, ротация до/после появления данных и stale response не смешивают аккаунты.
- Independent Quality и Architecture Review перед implementation completion;
  docs validator и PostgreSQL identifier guard до приёмки schema changes.
- Архитектурная проверка проекта решения: adapter остаётся in-process,
  новая предметная сущность не вводится; DDD ownership сохранён; authority
  находится в ADR, план описывает исполнение, Wiki — фактический current state.
  Универсальная aggregator framework и автоматический cross-provider merge
  исключены как лишняя сложность. Это review проекта, не независимая Quality.
- Независимый Architecture Review 2026-11-18 проверил routing, availability,
  account identity, symmetric overlap guard, consent races, erasure без ключа,
  Coach delivery evidence и ZIP boundary. Найденные риски включены выше;
  локальная реализация этапа B принята независимой Quality и Architecture
  Review 2026-11-20, timeline `task0179-independent-quality-20261120` и
  `task0179-independent-architecture-20261120`. Live validation не выполнялась.

## Related material

- [Текущая интеграция](20260907-connect-garmin-through-intervals-icu.md)
- [Connections API](../wiki/api/connections.md)
- [План TASK-0179](../../plans/2026/11/completed/2026-11-18-task-0179-garmin-personal-api.md)
- [Garmin Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/)
- [Garmin Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/)
- [Garmin Personal API Swagger](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
- [Официальный client](https://github.com/garmin/connect-personal-api-python)
