# TASK-0098 — Owner-backed Recovery restore drill и временный same-host journal

## Цель

Подтвердить реальным owner-created PostgreSQL backup, что Recovery restore
выполняется изолированно, а независимо сохранённый журнал удалений подавляет
возврат ранее удалённых device-derived данных. Зафиксировать одобренное
временное ограничение: журнал хранится на той же ВМ вне PostgreSQL, release и
backup-каталогов и защищает от восстановления старого logical dump, но не от
потери всей ВМ.

## Подтверждённые исходные данные

- В PostgreSQL `archive_mode=off`, `wal_keep_size=0`, `wal_level=replica`;
  `pg_stat_archiver` не содержит успешных или неуспешных архивирований.
- Systemd timers, системные cron-каталоги, root/user crontab и `/var/backups` не
  подтвердили автоматическую PostgreSQL backup policy.
- Владелец создал custom-format backup через WebStorm. Архив прошёл проверку
  формата и каталога, был восстановлен в отдельный PostgreSQL 17 на loopback
  port `55432`, после чего временный instance был остановлен.
- Metadata-only проверка восстановленной базы подтвердила 80 public tables и
  оба journal acknowledgement column.
- Recovery restore safety suite прошёл `2/2`: старый backup после journal replay
  не возвращает synthetic device observation и dependent assessment, сохраняя
  unrelated manual observation.
- Проверенный backup сохранён вручную на той же ВМ в закрытом owner-controlled
  backup-каталоге. Локальные временные restore-артефакты удалены после отдельного
  подтверждения оператора.

## Одобренное временное решение

1. Typed append-only SQLite journal и его sealed checkpoints хранятся в
   отдельном owner-controlled каталоге на той же ВМ.
2. Каталог находится вне PostgreSQL data/database boundary, release directories
   и каталога ручных backups; directory mode — `0700`, journal/checkpoint mode —
   `0600`.
3. Пока ручные backups не имеют максимального срока жизни, accepted/completed
   markers и checkpoints не удаляются.
4. Перед открытием любого restore применяется complete-through checkpoint;
   missing, modified, incomplete или unreadable journal оставляет restore
   fail-closed.
5. Решение защищает только от логического восстановления старого PostgreSQL
   dump. Потеря ВМ одновременно уничтожит PostgreSQL и same-host journal; этот
   остаточный риск принят оператором явно.
6. Переход на independent off-host/immutable copy остаётся рекомендуемым
   усилением и потребует отдельного решения владельца инфраструктуры.

## Изменения

1. Создать accepted superseding ADR на русском языке.
2. Пометить прежний ADR независимого журнала как `superseded` и связать решения.
3. Обновить только затронутые current-state Wiki pages:
   `docs/wiki/operations/postgresql-backup-and-restore.md` для operational
   boundary и evidence, `docs/wiki/domain/recovery-and-readiness.md` для Garmin
   readiness gate и одну ADR-ссылку в `docs/wiki/architecture/data-ownership.md`.
4. Не менять application code, database schema/migrations, CI/CD, deployment,
   compose, containers, services, credentials или Garmin integration.

## Проверки

- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- проверка относительных ссылок и ADR frontmatter;
- проверка Git diff на отсутствие source-code и unrelated changes;
- независимая criterion-by-criterion Quality проверка;
- Architecture Review по обязательным пяти пунктам.

## Критерии завершения

1. Реальный owner-backed restore evidence записан без credentials, dump content
   или application rows.
2. Временный same-host boundary и его ограничение однозначно отражены в ADR и
   только затронутой Wiki page.
3. Нигде не заявлена защита от потери ВМ, off-host durability или существование
   автоматической backup policy.
4. Зафиксировано бессрочное хранение journal markers, пока срок жизни ручных
   backups не ограничен.
5. Проверки документации, Quality и Architecture Review проходят.
