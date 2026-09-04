# TASK-0100 — Автоматическая безопасная синхронизация Recovery erasure journal

## Проблема

TASK-0099 создала owner-only live journal и первый sealed checkpoint на VM, но
bootstrap через container tmpfs был безопасен только при нулевом количестве
erasure requests. Для непустого request set PostgreSQL acknowledgement нельзя
выполнять до прямого durable сохранения checkpoint в host journal directory.
Ручной запуск также не является штатным механизмом для privacy deletion.

## Цель

Реализовать accepted ADR
`20260904-automate-recovery-erasure-journal-with-root-scheduled-one-shot.md`:
обычный GitHub Actions staging deployment устанавливает root-owned systemd
oneshot/timer, который запускает существующий API image с существующей database
identity и direct host bind mount, создаёт уникальный durable sealed checkpoint
только для pending markers и лишь затем подтверждает их в PostgreSQL.

## Принятое решение

1. Scheduler принадлежит root-owned systemd, а journal command выполняется в
   короткоживущем non-root container из active API image.
2. Long-running Compose worker и journal mount в основном API container не
   создаются.
3. Existing root-owned `api.env` передаётся Docker напрямую; secret content не
   читается, не копируется и не выводится.
4. Host directory монтируется до sync через strict Docker bind mount. Missing,
   symlinked, permissive, wrong-owner, corrupt или unwritable storage приводит
   к failure.
5. Unattended sync требует existing live journal, сериализуется и создаёт новый
   checkpoint только при pending accepted/completed acknowledgements.
6. Checkpoint получает collision-resistant UTC+UUID name, создаётся exclusively,
   durable-flushed и повторно проверяется до PostgreSQL acknowledgement.
7. Deployment controller устанавливает operational assets только после
   successful deploy; stable privileged wrapper не меняется.
8. Shared PostgreSQL configuration, port `5431`, backup policy,
   `talking-to-ai`, Garmin и credentials остаются вне scope.

## Затрагиваемые области

- `apps/api/src/recovery/recovery-erasure-journal.ts` — durable checkpoint
  publish и private directory/file invariants.
- `apps/api/src/recovery/recovery-erasure-journal-sync.ts` — pending detection,
  singleton lock, no-op и acknowledgement ordering.
- `apps/api/src/commands/manage-recovery-erasure-journal.ts` — unattended
  require-existing action и internal unique checkpoint path.
- `apps/api/test/` — unit, fault-injection и restore regression coverage.
- `deploy/staging/system/` — root-owned runner, service и timer.
- `deploy/staging/scripts/deployment-controller.sh` — post-success idempotent
  installation/update of operational assets.
- `deploy/staging/scripts/tests/` и root quality scripts — deployment/systemd
  contract coverage.
- После accepted Quality — только затронутые Recovery backup/restore и
  deployment Wiki pages.

## Этапы реализации

1. **Усилить durable checkpoint publish.** Проверять owner-approved directory и
   existing live journal, создавать checkpoint через exclusive open, завершать
   SQLite backup, выставлять `0600`, flush-ить file и parent directory и
   повторно verify-ить checkpoint до возврата успеха. Existing checkpoint при
   collision не изменять.
2. **Добавить unattended pending sync.** Получать PostgreSQL advisory lock до
   SQLite access, читать repeatable snapshot вместе с acknowledgement fields и
   не создавать checkpoint при отсутствии pending work. Не создавать новый live
   journal при `ENOENT`. После partial failure разрешать только idempotent retry.
3. **Создавать уникальные paths внутри API command.** При pending work строить
   checkpoint name из canonical UTC timestamp и random UUID внутри fixed
   `checkpoints/` directory. Не принимать generated path из env и не создавать
   одноразовые configuration variables.
4. **Добавить root-owned runner.** Валидировать active image digest, fixed host
   paths, owner/modes и required files; разделять staging lock; запускать
   `docker run --rm` с existing `api.env`, direct `--mount type=bind`, numeric
   journal-owner UID/GID, read-only root, private tmpfs, dropped capabilities,
   no-new-privileges и без published ports. Не логировать command arguments,
   environment или database URL.
5. **Добавить systemd oneshot/timer.** Установить bounded interval не более
   одной минуты, no-overlap behavior, finite timeout и security hardening.
   Missing journal должен давать failed service, а не silent success.
6. **Интегрировать с ordinary deployment.** После successful `deploy.sh`
   verified controller атомарно устанавливает runner/unit/timer, выполняет
   `systemd-analyze verify`, `daemon-reload` и `enable --now`. Failed deployment
   не заменяет последнюю successful operational version. Не изменять stable
   `/usr/local/sbin/shape-of-you-staging-deploy` или sudoers contract.
7. **Покрыть automated tests.** Проверить no-op, pending accepted, pending
   completed, retry after checkpoint-before-ack crash, concurrent invocation,
   missing/corrupt/permissive journal, collision, flush failure, direct mount,
   non-root user, deployment ordering, systemd validation и отсутствие secret
   leakage.
8. **Провести delivery gates.** Запустить targeted/full API checks, deployment
   contract tests, docs validator и diff checks; передать реализацию независимой
   Quality; выполнить Architecture Review; после acceptance обновить только
   затронутую canonical documentation и архивировать план.

## Acceptance criteria

1. Обычный успешный GitHub Actions staging deployment устанавливает или
   обновляет repository-owned sync runner, systemd service и timer без ручного
   редактирования VM wrapper scripts.
2. Scheduled run использует active immutable API image и existing API database
   identity без копирования, печати или сохранения `DATABASE_URL` и других
   secrets в новых местах.
3. Existing owner-only host journal подключён direct bind mount до старта sync;
   отсутствующий, неправильный, permissive, symlinked, corrupt или unwritable
   journal завершает run ошибкой.
4. При отсутствии pending acknowledgements run не создаёт checkpoint и не
   выполняет PostgreSQL write.
5. Для pending request создаётся ровно новый collision-resistant checkpoint;
   existing files не перезаписываются и не удаляются.
6. `journal_accepted_at` или `journal_completed_at` изменяется только после
   завершённого backup, durable file/directory flush и successful integrity plus
   completeness verification.
7. Ошибка до durable publish или verification оставляет request quarantined и
   недоступным для physical deletion; retry остаётся idempotent.
8. Parallel scheduled/manual invocations не могут одновременно писать live
   journal или подтверждать один cutoff.
9. Main API container не получает journal mount; новый long-running Compose
   worker, image, package, database, credential или port не появляется.
10. Shared PostgreSQL config, port `5431`, backup policy, `talking-to-ai`, Garmin
    integration и Garmin credentials не изменяются.
11. API/deployment tests, docs validation, independent Quality и Architecture
    Review проходят; documentation update ограничена реально затронутыми
    current-state pages после Quality acceptance.

## Проверки

- `pnpm --filter @shape-of-you/api typecheck`
- `pnpm --filter @shape-of-you/api lint`
- `pnpm --filter @shape-of-you/api build`
- `pnpm --filter @shape-of-you/api test:unit`
- `pnpm --filter @shape-of-you/api test:recovery-restore`
- Targeted deployment contract tests из `deploy/staging/scripts/tests/`
- `systemd-analyze verify` в Linux CI или эквивалентном disposable test context
- Static checks для direct `--mount`, fixed paths, non-root execution,
  no-overwrite и отсутствия secret echo/copy
- PostgreSQL identifier scan остаётся <=63 UTF-8 bytes, если migration files не
  меняются; новая migration в этой задаче не ожидается
- `node scripts/validate-docs.mjs`
- `git diff --check`
- Independent Quality acceptance matrix по всем 11 критериям
- Architecture Review по complexity, deployable boundaries, DDD ownership,
  source-of-truth duplication и simplification

## Отдельные operational approvals

После source acceptance отдельно требуются:

1. staging, commit и push;
2. deployment через GitHub Actions;
3. VM verification установленного unit/timer, owner/modes и direct mount;
4. controlled non-empty staging drill и разрешённые journal acknowledgement
   writes;
5. любой последующий Garmin connection.

## Запрещено без отдельного подтверждения

- начинать source implementation до одобрения этого плана;
- выполнять deployment, restart, systemd/Docker mutation или VM command;
- подключаться к shared PostgreSQL или выполнять database writes;
- менять PostgreSQL configuration, port `5431` или backup policy;
- читать, копировать или выводить runtime env/secrets;
- трогать `talking-to-ai`;
- подключать Garmin или хранить Garmin credentials;
- staging, commit, push, tag или release publication.

## Итог

Реализация и затронутая canonical documentation приняты независимой Quality.
Architecture Review подтвердил выбранную границу без нового deployable service
или доступа long-lived API к journal. Локальные проверки прошли; фактическая
установка, VM verification, non-empty staging drill, commit, push и deployment
остаются отдельными operator-approved действиями.
