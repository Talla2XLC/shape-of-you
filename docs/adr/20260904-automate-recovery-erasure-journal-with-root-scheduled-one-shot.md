---
id: automate-recovery-erasure-journal-with-root-scheduled-one-shot
kind: adr
title: "Автоматизировать Recovery erasure journal через root-scheduled one-shot"
status: accepted
date: 2026-09-04
supersedes: []
superseded_by: null
tags:
  - architecture
  - privacy
  - recovery
  - deployment
  - systemd
  - sqlite
---

# Автоматизировать Recovery erasure journal через root-scheduled one-shot

## Context

TASK-0096 ввела typed append-only SQLite journal: `accepted` intent становится
restore authority до physical deletion, а PostgreSQL worker может claim request
только после `journal_accepted_at`. TASK-0098 временно разрешила owner-only
same-host storage на PostgreSQL VM. TASK-0099 создала
`/home/talla2xlc/recovery-erasure-journal`, live journal и первый sealed
checkpoint.

Первый checkpoint был безопасно создан во временной файловой системе контейнера
и перенесён на host только потому, что erasure requests отсутствовали и
PostgreSQL acknowledgement не выполнялся. Для непустого request set этот порядок
создаёт окно resurrection: база может подтвердить journal durability до того,
как checkpoint окажется на owner-approved host storage.

Нужен unattended механизм, который использует существующий API image и
существующую database identity, монтирует host journal до запуска sync и
устанавливается обычным staging deployment flow. Общий PostgreSQL cluster, port
`5431`, backup policy, `talking-to-ai`, Garmin integration и Garmin credentials
не входят в решение.

Текущая sync-команда уже записывает PostgreSQL acknowledgement только после
создания и проверки checkpoint, но для unattended использования недостаточна:
она создаёт checkpoint даже без новых markers, создаёт новый live journal при
`ENOENT`, не сериализует независимые invocations и не фиксирует явный durable
flush checkpoint file и parent directory до acknowledgement.

## Decision

Использовать repository-managed root-owned `systemd` oneshot service и timer.
Timer с ограниченным интервалом, не превышающим одну минуту, запускает только
короткоживущий контейнер из текущего immutable API image. Постоянный Compose
worker и journal mount в основном API runtime не создаются.

Root-owned runner:

1. использует active release `API_IMAGE` и `API_DIGEST` из проверенного
   non-secret `current/release.env`;
2. передаёт существующий `/etc/shape-of-you/staging/api.env` напрямую как
   Docker `--env-file`, не читает, не копирует и не выводит его содержимое;
3. проверяет, что fixed host directory и его `checkpoints/` существуют, не
   являются symlink, принадлежат ожидаемому operator account и имеют mode
   `0700`, а `live.sqlite` является owner file mode `0600`;
4. запускает API image как numeric UID/GID владельца journal, с read-only root
   filesystem, private `/tmp`, dropped capabilities и
   `no-new-privileges`;
5. подключает `/home/talla2xlc/recovery-erasure-journal` через Docker
   `--mount type=bind`, который отказывает при отсутствующем source, прямо к
   fixed journal path внутри контейнера до запуска команды;
6. не подключается к `talking-to-ai`, не публикует port и использует только
   существующий database access path API runtime;
7. разделяет staging deployment lock, чтобы sync не пересекался с deploy,
   rollback или другим root-owned staging operation.

API image получает отдельный unattended action. Он:

1. требует уже существующий live journal и никогда не создаёт replacement при
   missing, unreadable, permissive, symlinked или corrupt path;
2. получает singleton PostgreSQL advisory lock до открытия SQLite, чтобы
   исключить параллельный manual или scheduled sync;
3. в одном repeatable-read snapshot находит все applicable erasure rows и
   определяет наличие непроставленных `journal_accepted_at` или
   `journal_completed_at`;
4. при отсутствии pending acknowledgements завершает run без нового
   checkpoint;
5. идемпотентно дописывает accepted/completed events и completeness record;
6. генерирует имя checkpoint внутри trusted command из UTC timestamp и random
   UUID, создаёт файл exclusively и никогда не перезаписывает существующий
   path;
7. завершает SQLite backup, устанавливает mode `0600`, выполняет durable flush
   checkpoint file и parent directory, затем заново проверяет private-file,
   schema, integrity chain и completeness;
8. только после успешного durable publish и verification записывает
   PostgreSQL acknowledgements;
9. при любой ошибке возвращает failure, оставляет отсутствующие
   acknowledgements отсутствующими и тем самым сохраняет quarantine и
   fail-closed worker gate.

Live journal и все ранее созданные checkpoints не удаляются, не ротируются и не
перезаписываются. Повтор после сбоя между checkpoint publish и PostgreSQL
acknowledgement создаёт новый уникальный checkpoint и безопасно повторяет
idempotent acknowledgement.

Repository-owned runner, unit и timer устанавливаются или обновляются verified
deployment controller только после успешного обычного deployment. После
установки controller выполняет `systemd-analyze verify`, `daemon-reload` и
`enable --now`. Stable privileged deployment wrapper и sudoers contract не
редактируются вручную или автоматически. Если deployment не завершился,
последняя успешно установленная версия operational assets сохраняется.

## Considered alternatives

- **Отдельный постоянный Compose worker на API image.** Direct mount и database
  identity выражаются декларативно, но появляется новый deployable lifecycle с
  restart, health, concurrency и shell-loop scheduling. Это непропорционально
  малому journal workload и конфликтует с обязательными workspace boundaries
  для отдельных deployable services.
- **Sync внутри основного API runtime.** Требует меньше operational files и
  может использовать существующий pool, но постоянно даёт internet-facing API
  write access к privacy journal, связывает sync с API restarts/replicas и
  увеличивает blast radius компрометации приложения.
- **Manual one-shot перед каждым deletion.** Сохраняет сильную isolation, но не
  обеспечивает штатное выполнение и оставляет реальные requests заблокированными
  до ручной операции.
- **Продолжить tmpfs-copy bootstrap.** Для непустого request set PostgreSQL может
  получить acknowledgement до durable host copy. Вариант запрещён.

## Consequences

- Journal write capability отсутствует в долгоживущем web-facing API container.
- Не появляются новый image, package, database, credential или network port.
- Удаление начинается с ограниченной timer latency после durable checkpoint.
- Missing/corrupt journal, несовместимый rollback image, failed sync или
  unavailable database блокируют deletion, но не требуют продолжать небезопасно.
- Staging получает небольшую root-owned operational surface, которую нужно
  покрыть installation, systemd hardening, rollback и secret-output tests.
- Same-host VM-loss limitation и бессрочная retention из действующего ADR не
  меняются.

## Verification

- Unit tests доказывают pending/no-op behavior, require-existing journal,
  singleton locking, unique exclusive checkpoint naming и idempotent retry.
- Fault-injection tests доказывают отсутствие PostgreSQL acknowledgement при
  backup, flush, directory sync или verification failure.
- Existing Recovery restore tests продолжают доказывать accepted-before-delete
  и old-backup suppression.
- Deployment contract tests проверяют repository-managed installation только
  после successful deploy, fixed paths, direct bind mount, non-root container,
  runtime hardening и отсутствие secret output/copy.
- `systemd-analyze verify` проверяет unit и timer; shell contracts проверяют
  lock, no-overwrite и failure behavior.
- API lint, typecheck, build, unit/restore tests, documentation validation,
  independent Quality и Architecture Review проходят до completion.
- Реальная установка, timer start, VM inspection и non-empty staging drill
  выполняются только после отдельных operator approvals.

## Related material

- [Temporary same-host Recovery erasure journal](20260904-temporarily-use-same-host-recovery-erasure-journal.md)
- [Independent typed Recovery erasure journal](20260904-use-independent-typed-recovery-erasure-journal.md)
- [Recovery retention and authenticated erasure](20260903-enforce-recovery-retention-and-authenticated-connection-erasure.md)
- [Staging PostgreSQL backup and restore](../wiki/operations/postgresql-backup-and-restore.md)

