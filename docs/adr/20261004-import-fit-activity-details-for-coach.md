---
id: import-fit-activity-details-for-coach
kind: adr
title: "Детали активности из FIT для анализа Coach по участкам"
status: accepted
date: 2026-10-04
supersedes: []
superseded_by: null
tags:
  - training
  - integrations
  - coach
---

# Детали активности из FIT для анализа Coach по участкам

## Context

TASK-0154: оператор хочет разбирать кардио по участкам: пульс, скорость,
пики, паузы и изменение интенсивности. Сейчас ExternalActivity хранит сводку.
Существующий импорт уже скачивает оригинальный FIT через Intervals.icu, но
декодирует только Garmin Recovery Time. Наличие файла у конкретной активности
и полнота записей пока не проверены; сводка не доказывает наличие ряда.

Record, Lap, Session и Event в FIT содержат разные уровни детализации.
Записи могут иметь нерегулярную частоту; elapsed time, timer time и moving
time не взаимозаменяемы. Общий icu_training_load не является нагрузкой каждого
участка. Программа с целевым диапазоном HR не задаёт полный набор HR-зон.

## Decision

Оператор утвердил ADR и план 2026-10-04 и попросил учитывать все доступные
данные Intervals. Расширяем существующий API и импорт без нового сервиса,
OAuth scope или загрузки файла пользователем. Дополнительные измеренные
каналы включаются в закрытую типизированную схему с известными единицами;
произвольные metadata и неизвестные поля не превращаются в медицинские факты.

### Импорт и владение

Один скачанный FIT передаётся существующему Recovery-декодеру и новому
декодеру стандартных сообщений на основе официального `@garmin/fitsdk`.
Эмпирический Recovery Time mapping остаётся отдельным контрактом.
Training владеет деталями ExternalActivity; Integrations отвечает за транспорт,
consent и доставку. Запрос Coach читает локальные данные, не вызывает провайдера.

Сохраняются session boundaries, timer events, laps и записи: timestamp,
elapsed seconds, HR bpm, speed m/s, distance m, cadence rpm, power W,
altitude m, temperature Celsius, respiration breaths/min, vertical oscillation mm,
stance time ms и step length mm при их
наличии. Enhanced speed имеет приоритет над обычной speed; отсутствующие
значения остаются null. GPS, маршруты, серийные номера и raw FIT не сохраняются.
Разные sessions не склеиваются молча; ответ явно разделяет их.

### Новая сущность

`ExternalActivityDetails` — неизменяемая версия нормализованных деталей:
id/personId, connectionId и consent generation, activity lineage root,
source activity version, FIT checksum, normalizationVersion, importedAt,
supersedesId и типизированный payload (sessions, records, laps, timer events).
Payload хранится как закрытая JSONB-схема, а не произвольный provider blob;
одна версия содержит весь ограниченный ряд. Per-sample SQL rows не нужны
для первого scope. Индекс текущей версии и ограничения successor/deduplication
повторяют принятые подходы фактов проекта.

Изменение FIT без изменения сводки создаёт новую версию. Изменение только
сводки сохраняет связь деталей через lineage с явным происхождением, а не
выдаёт старый source activity version за новый. Ответ содержит обе версии.
Проверка checksum и normalizationVersion делает повторы идемпотентными.
Ошибки получения/CRC/декодирования не удаляют прежнюю валидную версию.
Закрытая причина последней попытки хранится в существующем activity receipt
`integration_inbox.activity_details_issue`, под текущим consent fence:
`invalid_fit`, `unsupported_fit`, `limit_exceeded`, `provider_unavailable`,
`source_file_unavailable` или `no_supported_measurements`. Успех сбрасывает
причину; источник измерений и receipt outcome не становятся второй
measurement authority. Чтение возвращает `latestImportIssue` и `importedAt`:
первый сбой — `unavailable`; прошлые валидные данные остаются `available`
с явной причиной неуспешной новой попытки. SDK не поддерживает compressed
timestamp headers; такой файл получает `unsupported_fit`, без выдуманных
измерений и без удаления прежней версии.
Успешное чтение файла без поддерживаемых деталей отмечает их отсутствие;
авторизованное чтение не подменяет его старыми данными.
Удаление личности/связи, revocation и смена consent generation применяют
существующие правила жизненного цикла и исключают доступ к прежнему поколению.

Действующий предел файла 2 MB сохраняется; дополнительно вводятся предел
200000 records и ограниченная валидация остальных сообщений. SDK возвращает
массивы сообщений: listener сам по себе не обеспечивает streaming или предел
памяти. Превышение лимитов возвращает диагностируемую unavailable-причину,
не усечённый ряд под видом полного. Импорт сохраняет бюджет 20 FIT/pass и
обновляет import version, чтобы повторно обработать обычное 14-дневное окно.
Ручной исторический backfill требует отдельного разрешения.

### Чтение Coach

Новый read-only MCP `get_external_activity_details` принимает внутренний
activityId, session, elapsed range, bucketSeconds (по умолчанию 60), режим
buckets или records и cursor. Person scope берётся из авторизации.
Ответ содержит availability, provenance, detailsVersion, coverage, единицы,
границы sessions, реальные laps и ограниченную страницу данных.
Cursor закреплён за detailsVersion; изменение версии требует начать чтение
заново. Лимиты ответа: 200 buckets, 1000 records, 200 laps на страницу.

Buckets сохраняют HR min/max, средний HR с весом по времени, скорость,
дистанцию и покрытие. Паузы исключаются из active time. Значение действует
только до следующей записи, максимум 10 секунд, и не переносится через паузу
или session boundary. Остальное время — unknown; policy version и coverage
явны. Это консервативная аппроксимация между измерениями, а не запись часов
каждую секунду. Вычисленные участки отличаются от записанных laps.

Время в HR-зонах рассчитывается только по явно переданным границам с
происхождением `analysis_supplied`; текущие границы не выдаются за исторические
настройки Garmin. Без границ Coach всё равно анализирует ряд HR/скорости,
но не выдумывает зоны. В этом scope нет новой сущности профиля зон.

«Нагрузка по участкам» означает длительность и наблюдаемую интенсивность
HR/скорости/power и время в известных зонах. Общая provider training load
остаётся сводкой; TRIMP/EPOC и распределение общего числа по участкам
не вводятся. Coach может описать рост HR при сопоставимой скорости с указанием
покрытия, но не устанавливает физиологическую причину по одному ряду.
При наличии деталей он получает их перед ответом на просьбу разобрать участки;
при отсутствии кратко объясняет фактическую причину без технического монолога.

## Considered alternatives

- Скачать FIT при каждом MCP-запросе: меньше хранения, но ответ зависит от
  провайдера, повторяет декодирование и не фиксирует версию анализа.
- Новый provider streams API: потенциально удобнее, но требует проверки нового
  контракта. Уже используемый original-file транспорт достаточен для первого scope.
- Хранить только минутные средние: дешевле, но теряются пики, точные laps и
  возможность пересчитать зоны. Исходные нормализованные records сохраняются.
- SQL row на каждый record: удобные запросы, но больше строк и индексов без
  потребности в межтренировочной аналитике каждого sample на этом этапе.

## Consequences

Coach получает проверяемую детализацию вместо одной средней цифры.
Появляются новая таблица/миграция, зависимость SDK, больше хранения и обработка
неполных файлов. Existing summary и Recovery contracts сохраняются.
Нет изменения программы, профиля зон, новых deployable boundaries или live
записей от MCP-чтения. Доставка и проверка реального Coach — отдельные gates.

## Verification

- FIT fixtures: CRC, нерегулярная запись, enhanced speed, паузы, пропуски,
  отсутствующий HR, несколько sessions, laps и превышенные лимиты.
- Проверка взвешенных средних, пиков, coverage и границ buckets/zones.
- Реальная MCP→PostgreSQL цепочка: импорт, paging/version pinning, исправление
  FIT при прежней сводке, retry, успешное отсутствие, ошибка с сохранением
  прошлой версии, person isolation, consent generation и erasure.
- Static migration identifiers ≤63 UTF-8 bytes; isolated migrations, API
  checks, независимая Quality и Architecture Review, canonical docs validator.
- После разрешённой доставки: реальный Coach разбирает известный участок
  по прочитанным данным. Локальный MCP test не доказывает качество ответа LLM.

## Related material

- [Existing FIT Recovery ADR](20260924-import-garmin-post-activity-recovery-snapshot-from-intervals-fit.md)
- [Recovery Wiki](../wiki/domain/recovery-and-readiness.md)
- [План TASK-0154](../../plans/2026/10/completed/2026-10-04-task-0154-fit-activity-details.md)
- [Garmin activity decoding](https://developer.garmin.com/fit/articles/cookbook/decoding_activity_files.html)
- [Official JavaScript SDK](https://github.com/garmin/fit-javascript-sdk)
