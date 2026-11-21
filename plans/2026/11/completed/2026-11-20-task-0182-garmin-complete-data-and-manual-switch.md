# TASK-0182 — Полные полезные данные Garmin и разовый перенос аккаунта

Статус: выполнено. ADR/план утверждены оператором, implementation и последующие
узкие исправления приняты независимыми Quality/Architecture Review. Commit/push,
полная публикация и staging delivery завершены; фактический разовый перенос
аккаунта выполнен и независимо проверен. Production не затрагивался.

## Цель

Архитектурное предложение:
[полный полезный typed import](../../../../docs/adr/20261120-import-complete-useful-garmin-personal-data.md).

Исправить неполный Garmin importer, затем перевести единственный реальный
аккаунт руками, сохранив историю, provenance и ссылки. Новый мастер сайта,
новые сервисы и универсальная платформа миграций в этот этап не входят.

## Исходное состояние и проверка до implementation

- Единственный реальный Person использует Intervals; historical import completed.
  Garmin connection, сохранённого Garmin credential и cutover не было.
- Один защищённый ввод ключа выполнен. Ключ хранится только как authenticated
  ciphertext, привязанный existing cipher к provider/Person/target connection,
  в owner-only operational candidate. Повторные проверки используют его.
  Личный годовой срок действия известен; дату истечения не выдумывать.
- Официальная OpenAPI содержит 28 GET paths. Выполнены 32 bounded read requests:
  все JSON методы проверены, два periodic-health ответа пустые (204), питание,
  вес, VO₂max и hydration history в проверенных ответах не содержат фактов.
  Пустой endpoint не объявляется отсутствующим в API.
- Ночной `lastNightAvg` и `sleepScores.overall.value` реально заполнены;
  sleep stages, minimum night SpO₂, stress, energy и Body Battery также доступны.
- `activityTrainingLoad` присутствует у обеих проверенных активностей;
  `trainingStressScore` у них отсутствует. Это разные показатели.
- Производитель Garmin подтверждён. Правильный ZIP Accept дал успешный FIT decode;
  прежний HTTP 406 был ошибкой заголовка диагностического запроса, не API gap.
- Body Battery series имеет официальные timestamp/level descriptors и реально
  заполненные упорядоченные millisecond samples: точечное latest возможно.
  Значения здоровья, external IDs, ключи и raw payload не входят в отчёты.

## План исполнения

1. Принять ADR полного typed coverage и точные новые поля до implementation.
2. Заполнить уже существующие Recovery HRV, sleep score, стадии сна и min SpO₂;
   импортировать подтверждённый timestamped Body Battery без fetch-time подмены.
3. Добавить доступные полезные day/activity данные с явными units, temporal
   precision и отдельной семантикой Training load/TSS. Не заменять старую
   Intervals нагрузку числом Garmin без другого basis.
4. Для других доступных health/fitness категорий использовать их владельцев
   Physical State/Nutrition/Training, соблюдать consent, corrections, provenance
   и journal-backed erasure. Не сохранять пустые ответы как измеренные нули.
5. Проверить synthetic fixtures из официальных contracts, API/PostgreSQL tests,
   negative/missing/unit/date cases и фактический bounded повторный read.
6. Независимые Quality и Architecture Review; affected canonical Wiki.
7. Подготовить и проверить разовый operational перенос с backup, точной
   границей, сохранением старых IDs и исправлением только реальных пересечений
   сегодняшних Recovery facts через normal correction chains. Существующие
   activity до момента переноса остаются на месте и не импортируются повторно.
8. После совместимого staging delivery: encrypted pending connection, durable
   policy seal/proof, атомарная активация и проверка typed import/ссылок/истории.

## Ограничения

- Ни одного gap waiver по умолчанию. Не объявлять данные недоступными только
  потому, что текущий adapter их не маппит.
- Не приравнивать разные виды нагрузки, дневной и ночной SpO₂, weekly и
  overnight HRV, настройки/цели и измеренные данные.
- Новые сущности сначала описываются в ADR. Raw JSON dump, переписывание
  provenance и удаление/reimport старой истории не разрешены.
- Предыдущие восемь посторонних dirty files не входят в scope.
- До принятия модели и проверки нового импорта Intervals оставался действующим
  источником. Фактическое переключение выполнено только после этих gates.

## Источники

- [Garmin Swagger](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/)
- [Официальный client](https://github.com/garmin/connect-personal-api-python)
- [Garmin HRV semantics](https://www.garmin.com/en-GB/garmin-technology/health-science/hrv-status/)
- Timeline TASK-0182: результаты metadata-only API проверки и независимого review.

## Результат

- Реализованы согласованные typed categories, consent scopes, precise units,
  partial-group semantics, corrections/erasure и API/MCP/Coach consumers.
- Основной commit `2a14955`; совместимость undated Training read — `39ae1df`;
  legacy synthetic grants — `9bf8f1c`. Последний SHA полностью опубликован и
  выложен в staging: publication `44899869203`, Promote `44900742786`.
- Pipeline применил API migration; exact hash подтверждён SQL-проверкой.
  API/Identity/Web runtime-ready и smoke-verified. Подробные timestamps и
  границы приведены в единственном canonical delivery evidence.
- Разовый перенос использовал сохранённый encrypted key без повторного ввода,
  реальный durable v2 seal до activation и normal typed importer. История,
  ссылки и provenance сохранены; ранние source facts не переимпортированы.
- После resume подтверждён следующий штатный автоматический pass. Connected
  application независимо подтвердило HRV/sleep score/Body Battery с реальным
  временем, а Daily Decision — новые Fitness facts. Пустые Nutrition/weight
  ответы не превращались в нули.
- Независимая приёмка: final core 19 PostgreSQL/HTTP; полный API suite 559 unit;
  broad PostgreSQL 116 и affected legacy scenarios 44; финальный полный CI
  прошёл, MCP discovery 44 tools/44 валидных output schemas.
- Восемь прежних посторонних dirty files не включены в commits.

[Canonical delivery evidence](../../../../docs/wiki/operations/temporary-vm-deployment.md).
