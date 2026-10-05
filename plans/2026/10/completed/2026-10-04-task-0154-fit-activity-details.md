# TASK-0154 — детали кардио из FIT для Coach

## Согласование

Оператор утвердил архитектуру и план 2026-10-04 сообщением «да, конечно!»
и расширил запрос на доступные измерения Intervals. Authority:
[ADR](../../../../docs/adr/20261004-import-fit-activity-details-for-coach.md).
Реализация разрешена; live операции и delivery approvals остаются отдельными.

## Scope и порядок

1. Утвердить ADR: типизированные versioned details существующей ExternalActivity,
   стандартный FIT decoder, read-only MCP, ограничения и lifecycle.
2. Добавить schema/migration и runtime validators без raw FIT/GPS.
3. Расширить текущий импорт одной загрузкой файла, идемпотентностью,
   correction/absence/error/consent handling и bounded decoding.
4. Реализовать MCP: sessions/laps, records или минутные buckets, paging,
   coverage, time-weighted HR, pause/gap handling и явные границы зон.
5. Обновить Coach instructions: прочитать детали для анализа участков,
   различать измерения и расчёты, отвечать естественно и кратко.
6. Проверить FIT fixtures и реальный MCP→PostgreSQL путь; независимая Quality,
   Architecture Review по пяти пунктам AGENTS.md, затем affected Wiki и validator.
7. После отдельно разрешённых commit/push/deploy проверить точный workflow
   migrations/readiness/smoke и реальный ответ Coach по доступной активности.

## Критерий результата

На запрос «когда какой пульс и нагрузка» Coach использует реальные участки,
пики, скорость, паузы и покрытие. Он не выводит поминутные факты из среднего HR,
не делит общий training load по времени и не выдумывает зоны. Отсутствие
каналов не блокирует разбор имеющихся измерений. Импорт не создаёт дубли,
не смешивает sessions/persons/consent generations; чтение не пишет live facts.

## Границы

Новый сервис, GPS/маршруты/raw FIT, профиль HR-зон, численная модель TRIMP/EPOC,
изменение программы, ручной backfill, connector refresh, live writes,
commit/push и deployment не разрешены этим предложением.

## Статус

Реализация завершена и независимо принята Quality 2026-10-05:
`task-0154-quality-acceptance-20261005`. Architecture Review по пяти пунктам
пройдена; affected canonical Wiki согласованы с кодом.

Полный API suite: 479/479, 61 файл. После последнего исправления attemptedAt:
MCP/PostgreSQL 5/5 и migration chain 19/19; typecheck всех consumers, API
build/lint и docs validator пройдены. Две миграции созданы и проверены только
в изолированных PostgreSQL; агент не применял их к staging или production.
Commit/push/deploy и реальный Coach gate остаются открытыми. Измерения
конкретного кардио ещё не прочитаны через новый контракт.

SDK не поддерживает compressed timestamp headers; этот случай честно
возвращает unsupported_fit. Все данные Intervals не заявляются импортированными:
scope ограничен согласованными типизированными измерениями без raw/GPS.
