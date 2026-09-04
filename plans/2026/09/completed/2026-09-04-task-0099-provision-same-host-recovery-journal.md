# TASK-0099 — Provision same-host Recovery journal и первый checkpoint

## Цель

Создать на staging VM отдельный owner-controlled каталог для typed SQLite
Recovery erasure journal, выполнить первый sync через существующий API image и
database identity и проверить sealed completeness checkpoint без изменения
PostgreSQL configuration, migration, compose files или работающих services.

## Выбранный способ

Использовать одноразовый `docker run --rm` из digest уже работающего API image:

1. Примонтировать только host-каталог Recovery journal.
2. Подключить существующий `/etc/shape-of-you/staging/api.env` через Docker, не
   читая, не копируя и не выводя его содержимое.
3. Разделить network namespace с текущим API container только на время sync,
   чтобы сохранить существующий database route и не публиковать новый port.
4. Запустить существующий
   `dist/commands/manage-recovery-erasure-journal.js --action sync`.
5. Проверить checkpoint отдельным network-disabled `--action inspect` run без
   database credentials.

Этот путь меньше ранее разрешённого изменения: compose/config не меняются, API
не перезапускается, deploy и migration не выполняются.

## Operational paths

- Host root: `/home/talla2xlc/recovery-erasure-journal`, mode `0700`.
- Live journal: `live.sqlite`, mode `0600`.
- Sealed checkpoints: `checkpoints/`, directory mode `0700`; каждый новый файл
  получает уникальное timestamped имя и mode `0600`.
- Manual backups остаются в отдельном backup-каталоге и не смешиваются с
  journal lifecycle.

## Этапы

1. Read-only определить ровно один running API container, его immutable image
   digest и runtime uid; не читать container environment.
2. Проверить отсутствие target paths, затем создать owner-only каталоги.
3. Выполнить один journal sync. Разрешённые PostgreSQL writes ограничены
   `journal_accepted_at`/`journal_completed_at` acknowledgement существующих
   Recovery erasure requests после sealed checkpoint.
4. Проверить CLI output только по counts и completeness cutoff, без IDs и
   application rows.
5. Запустить offline inspect sealed checkpoint с exact cutoff.
6. Проверить file type, ownership и permissions без чтения journal rows.
7. Убедиться, что working API container не перезапускался и остаётся healthy;
   не менять port `5431` или shared cluster configuration.
8. Провести independent Quality и Architecture Review, обновить только
   затронутый operational runbook, затем архивировать план.

## Stop conditions

- Не найден ровно один healthy API container.
- Runtime uid не может безопасно писать в owner-controlled каталог.
- Target checkpoint уже существует.
- Sync/inspect сообщает missing, modified или incomplete journal.
- Операция требует чтения secret, изменения compose/service, migration или
  PostgreSQL configuration.

## Acceptance criteria

1. Live journal и первый sealed checkpoint существуют вне PostgreSQL, release и
   manual-backup directories с mode `0600` внутри directory mode `0700`.
2. Sync завершён через существующий database identity; никакие credentials или
   application rows не прочитаны и не записаны в evidence.
3. Offline inspect подтверждает schema, integrity и completeness exact cutoff.
4. API не перезапущен, не заменён и остаётся healthy; порт `5431`, migrations,
   compose и другие services не изменены.
5. Повторное выполнение не перезаписывает существующий checkpoint и runbook
   требует нового уникального checkpoint path.
6. Targeted checks, docs validation, independent Quality и Architecture Review
   проходят.
