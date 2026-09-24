---
id: import-garmin-post-activity-recovery-snapshot-from-intervals-fit
kind: adr
title: "Импортировать исторический снимок Garmin Recovery Time из исходного FIT через Intervals.icu"
status: accepted
date: 2026-09-24
supersedes: []
superseded_by: null
tags:
  - architecture
  - recovery
  - coaching
  - intervals-icu
---

# Импортировать исторический снимок Garmin Recovery Time из исходного FIT через Intervals.icu

## Context

Coach уже не требует скриншоты Garmin. Пользователям нельзя предлагать
создавать custom fields в Intervals.icu. Существующее OAuth-подключение имеет
`ACTIVITY:READ`; документированный `GET /api/v1/activity/{id}/file` вернул
исходный FIT одной активности побайтно идентичный файлу оператора.

Read-only исследование одного согласованного подключения за 30 дней: 10 из
10 доступных активностей имели Garmin Activity FIT, и в каждом был один
global message `140` с field `9` и field `253`. В предоставленном
оператором файле field `9` имеет тип `uint16`; `253` в выборке следовал
через 4–338 секунд после последнего FIT event. Эти агрегаты не доказывают
покрытие других моделей, прошивок и аккаунтов. Официальный Garmin FIT SDK
определяет field `253` как UTC timestamp сообщения, но не определяет
message `140` и его field `9`.

Независимые практические реализации и анализы Garmin FIT трактуют `140.9`
как минуты Recovery Time после активности: fit4ruby декодирует `uint16`
с масштабом 60 в часы; участники Garmin FIT и Intervals.icu форумов пришли
к тем же единицам на своих файлах. Это сильная эмпирическая гипотеза,
**не официальный контракт Garmin**. Garmin может менять оценку в течение дня;
активность не содержит доказанного текущего остатка. На 31 проверенном
wellness-дне числового `readiness` нет. Отдельное поле Garmin Training
Readiness не идентифицировано; его нельзя выводить из generic `readiness`
или случайных FIT-полей.

Руководство Forerunner 970 описывает Recovery Time как оценку времени до
готовности к следующей тяжёлой тренировке; после активности значение
обновляется в течение дня. Поэтому исторический снимок можно объяснять в
этом смысле на момент измерения, не превращая его в текущий таймер или
собственное решение Shape of You о нагрузке. Это описание функции Garmin не
делает частное поле FIT `140.9` официально документированным контрактом.

## Decision

Оператор одобрил архитектуру для TASK-0131 ответом «ок го» 2026-09-24.
Реализация требует отдельно одобренного плана:

1. В существующем API/Intervals worker получать только исходный FIT новых
   либо исторически импортируемых Garmin-активностей. Не создавать сервис,
   новый OAuth scope или пользовательскую настройку Intervals.
2. Разбирать FIT потоково и ограниченно: проверять тип Activity,
   manufacturer Garmin, CRC, допустимые размеры и формат `140.9`/`140.253`.
   Отсутствие или неоднозначность поля означает `unavailable`, а не ноль.
   Ошибка download/разбора не отзывает ранее принятый факт; отзыв возможен
   только после успешного чтения исправленного файла без этого поля.
   Не сохранять сырой FIT, маршрут, серийный номер и другие поля файла.
3. Добавить типизированную метрику `garmin_post_activity_recovery_time` с
   единицей `minute` в существующий `RecoveryObservation`, а не отдельную
   таблицу или универсальный provider blob. Значение — исходный `uint16`
   без масштабирования; ноль допустим. Имя подчёркивает, что это снимок
   после активности, а не текущий таймер Garmin.
4. `observedFrom` и `observedUntil` соответствуют UTC timestamp `140.253`;
   `localDate` вычисляется из него в timezone пользователя, а не копируется
   из даты начала активности.
   `SourceReference` с `channel = account` указывает `externalSystem` =
   `intervals_icu_activity_fit:garmin_140_9_v1`, `externalRecordId` = ID
   активности с locator поля и checksum версии, `occurredAt` = время
   сообщения. `quality = estimated` отражает оценочный характер Garmin
   длительности. Существующие connection,
   consent, source, dedupe, checksum, correction/withdrawal и erasure
   lifecycle сохраняются.
   Интерпретация `140.9` закрепляется версией parser mapping и
   маркируется как эмпирическая в публичной семантике метрики. Время
   получения файла отдельно от `observedAt`.
5. Читать факт в Coach только как привязанный к активности исторический
   снимок с `observedAt` и возрастом, например: «после тренировки Garmin
   оценил восстановление в N часов на момент T». Не выдавать его как
   текущий Recovery Time, не вычислять текущий остаток вычитанием прошедшего
   времени, не включать в `RecoveryAssessment` или автоматическое решение
   о нагрузке. При отсутствии факта Coach не просит скриншот.
6. Garmin Training Readiness остаётся недоступным в этом пути; не добавлять
   для него метрику или эвристический суррогат. Прямая Garmin Connect
   интеграция и недокументированные endpoint-ы — отдельное решение.

## Considered alternatives

### Только исправить Coach и не импортировать показатель

Нулевая техническая стоимость и минимальный риск; не использует уже
доступный файл. Остаётся допустимым выбором, если продукт не хочет
поддерживать эмпирически распознанное поле.

### Читать generic wellness `readiness` или activity JSON

Отклонено: generic название не устанавливает Garmin provenance; у
проверенного пользователя 0/31 числовых значений. Activity summary не
содержит этого снимка.

### Требовать custom field в Intervals.icu

Отклонено: настройка и повторная обработка каждым пользователем —
неприемлемый UX, а единицу всё равно определяет пользователь.

### Хранить raw FIT или универсальный JSON

Отклонено: расширяет объём частных данных и протаскивает transport в
Recovery. Типизированный факт с источником и временем достаточен.

### Добавить Recovery Time как поле Training activity summary

Это проще для чтения рядом с тренировкой, но закрепляет Recovery-семантику
за Training и обходит существующие consent, correction и erasure механизмы
Recovery. Ссылка на activity ID в `SourceReference` сохраняет связь без
нового владельца факта.

### Представлять снимок как текущий Recovery Time

Отклонено: Garmin обновляет таймер после активности; вычитание часов
создаёт ложное текущее значение.

### Подключаться к Garmin Connect напрямую

Отклонено в TASK-0131: новая security/integration boundary и
недокументированный доступ требуют отдельного решения.

## Consequences

- Появится наблюдение без пользовательской настройки Intervals, но только
  для FIT с подтверждённой структурой. Отсутствие на других устройствах
  остаётся явным и не ломает Coaching.
- Внешняя длительность остаётся историческим контекстом. Shape of You
  сохраняет собственную оценку восстановления.
- Бинарный download и parser требуют лимитов размера, времени, частоты,
  изоляции ошибок и bounded backfill. Версия эвристики должна позволять
  исправить или отозвать ранее импортированные факты при обнаружении
  несовместимой прошивки.
- Архитектура одобрена, но код, схема, миграция и provider parser меняются
  только по отдельному плану реализации; запуск миграции и выпуск требуют
  своих разрешений.

## Verification

- Зафиксировать обезличенные FIT fixtures разных активностей, включая
  ноль, отсутствие поля, неверный CRC, не-Garmin и неожиданные типы.
- Проверить извлечение `140.9` и timestamp `140.253` независимо от
  порядка FIT сообщений и без хранения файла.
- Проверить ограниченный OAuth download, rate limit, timeout,
  повторный импорт, исправление и отзыв при смене содержимого файла.
- Проверить Coach wording: исторический снимок не звучит как текущий
  остаток, не меняет `RecoveryAssessment`, не вызывает запрос скриншота.
- Провести независимый Quality и Architecture Review, проверить
  документацию и rollout отдельно от разрешений на миграцию и деплой.

## Related material

- [ADR: Coach без Garmin-скриншотов](./20260924-do-not-require-garmin-screenshots-for-coach-recovery.md)
- [ADR: типизированный Intervals wellness](./20260912-import-supported-intervals-wellness-as-typed-recovery.md)
- [Garmin FIT timestamp documentation](https://developer.garmin.com/fit/articles/cookbook/decoding_activity_files.html)
- [Forerunner 970 Recovery Time owner manual](https://www8.garmin.com/manuals/webhelp/GUID-025D75CF-3445-49E1-8D81-1AA74AB4E00F/RU-RU/GUID-DAC27D10-886A-4EA8-8339-674479E9574A.html)
- [Garmin FIT Profile](https://github.com/garmin/fit-sdk-tools/blob/main/Profile.xlsx)
- [fit4ruby reverse-engineered message 140](https://github.com/scrapper/fit4ruby/blob/master/lib/fit4ruby/GlobalFitMessages.rb)
- [Garmin FIT community analysis](https://forums.garmin.com/developer/fit-sdk/f/discussion/254469/list-of-undocumented-mesg_num)
- [Intervals.icu community field mapping](https://forum.intervals.icu/t/building-a-chart-multiple-activities-per-day/111806)
- [Intervals.icu API Integration Cookbook](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090)
- TASK-0131
