# TASK-0116 — Надёжное выполнение Identity migration на staging

## Статус и разрешение

План одобрен оператором и завершён 2026-09-17 после двух одинаковых сбоев
deployment для `TASK-0115`. Реализация, независимый Quality, Architecture
Review и обновление canonical Wiki приняты.

План не разрешает commit, push, staging deployment, migration, restart,
production access или чтение персональных данных.

## Наблюдаемый пользовательский результат

После исправления обычное API-изменение должно доставляться на staging без
зависания на уже актуальной Identity schema. Если Identity schema действительно
отстаёт или заблокирована, deployment должен быстро и понятно остановиться,
удалить только свой one-shot container и назвать точную фазу сбоя.

## Проверенные факты

- GitHub Actions run `35212029304` дважды успешно применил API migration, но
  Identity migration превысила 300 секунд.
- После timeout `compose ps` само зависло примерно на 11 минут; named container
  продолжал работать до принудительного удаления.
- Текущий staging остался на предыдущем healthy release
  `f8ca8bba95604dc055b4bc51a5ba2392a74c1501`.
- В Identity journal применены все `8/8` migrations; постоянных blockers нет.
- Изолированная Identity migration внутри текущего runtime-контейнера завершилась
  примерно за 3 секунды.
- Текущий и новый Identity images используют Node `v24.21.0` и одинаковый
  checksum `dist/database/migrate.js`.
- `TASK-0115` не меняет `apps/identity`, root dependency manifests или lockfile.

## Альтернативы

### 1. Оставить только внешний 300-секундный timeout

Отклонено. Реальный инцидент доказал, что timeout Compose client не ограничивает
весь container lifecycle, а неограниченный `compose ps` удлиняет failure ещё на
11 минут.

### 2. Пропускать Identity operations по path filter API-only push

Отклонено как постоянная архитектура. Diff только текущего push не доказывает,
что предыдущий неуспешный release не содержал ожидающее Identity-изменение.
Появляются partial-release semantics, дополнительное состояние и риск ложного
пропуска обязательной migration или OAuth reconciliation.

### 3. Atomic release + быстрый проверяемый no-op + end-to-end bounds

Рекомендуется. Четыре immutable coordinates и существующая privilege boundary
сохраняются. Identity runner сначала проверяет exact local/database journal.
Если он уже совпадает, runner завершает no-op без повторного DDL. Если journal
отстаёт, применяется обычная Drizzle migration. Все DB и Docker failure paths
получают внутренние пределы и безопасную фазовую диагностику.

## Предлагаемая архитектура

1. Сохранить один atomic staging release и обязательное присутствие Identity
   coordinate. Не добавлять `skip identity`, partial release или ручной bypass.
2. В Identity migration runner добавить preflight journal comparison:
   - local authority — committed Drizzle journal и SQL hashes;
   - database authority — только `drizzle.__drizzle_migrations` metadata;
   - exact current journal завершает runner как idempotent no-op;
   - absent/behind journal передаётся существующему Drizzle migrator;
   - ahead, hash mismatch или malformed journal fail closed.
3. Установить session-local `lock_timeout` и `statement_timeout`, вложенные в
   существующий 300-секундный outer limit. Не менять PostgreSQL server settings
   и не добавлять environment-controlled safety limits.
4. Добавить secret-safe фазовые события: readiness, journal check, apply,
   pool close и result. Не печатать SQL, URLs, параметры или user data.
5. В failure path `deploy.sh` отказаться от неограниченного `compose ps`:
   - каждый `inspect`, bounded log tail, force-remove и absence check получает
     собственный короткий timeout;
   - bounded stop и подтверждение остановки выполняются до необязательной
     расширенной диагностики; если остановка не подтверждена, log tail
     пропускается и сразу выполняется force-remove;
   - log tail разрешён только для Identity runner с secret-safe log contract;
   - невозможность подтвердить cleanup остаётся fail-closed;
   - `EXIT/HUP/INT/TERM` cleanup остаётся идемпотентным.
6. Добавить `init: true` one-shot migration services для корректной передачи
   сигналов PID 1 без нового deployable boundary.
7. Не менять API/Identity data ownership, database URLs, shared ingress,
   root bootstrap, `shape-deploy` privilege boundary или secret transport.

## Acceptance criteria

1. Полностью актуальный Identity journal завершается no-op без DDL и без OAuth
   reconciliation bypass для реально изменившейся policy.
2. Behind journal применяет все pending migrations ровно один раз.
3. Ahead, hash mismatch и malformed journal останавливают deployment fail closed.
4. DB lock/query не может пережить внутренний timeout; сообщение называет фазу
   без SQL и секретов.
5. Любая diagnostic/cleanup Docker operation имеет собственный предел времени;
   failure path не может снова зависнуть до общего GitHub job timeout.
6. Named migration container удаляется и его отсутствие проверяется даже после
   timeout, signal escalation или diagnostic failure.
7. Existing atomic four-image release, rollback compatibility declarations,
   OAuth reconciliation order и strict SSH/root-wrapper boundary сохранены.
8. Контрактные тесты воспроизводят current-journal no-op, pending migration,
   journal drift, DB timeout, Docker diagnostic timeout и cleanup failure.
9. После отдельно разрешённых commit/push/deploy release `TASK-0115` проходит
   migrations, runtime readiness и staging smoke.

## Этапы реализации

1. Создать дополняющий Russian ADR для bounded staging delivery.
2. Реализовать exact journal inspection в Identity migration runner и тесты.
3. Добавить session-local DB limits и secret-safe phase diagnostics.
4. Исправить Compose one-shot signal contract и bounded failure cleanup.
5. Расширить staging deployment contract tests.
6. Выполнить lint, typecheck, build, Identity unit/integration tests, все staging
   shell contracts, полный workspace test, docs validation и `git diff --check`.
7. Передать frozen diff независимому Quality.
8. После Quality acceptance выполнить Architecture Review и обновить только
   затронутые current-state Wiki pages.
9. Переместить план в `completed/` только после принятых Quality,
   Architecture Review и Wiki.

## ADR и документация

Новый ADR обязателен: решение уточняет accepted
`decisions-20260903-bound-automatic-staging-delivery`, меняет Identity migration
semantics и end-to-end timeout ownership. После принятия обновляются только:

- `docs/wiki/architecture/deployment.md`;
- `docs/wiki/data/backend-migrations.md`;
- `docs/wiki/operations/temporary-vm-deployment.md`;
- `docs/wiki/changelog.md`.

## Отдельные release gates

После локального acceptance оператор отдельно разрешает:

1. commit;
2. push;
3. автоматический или ручной staging deployment;
4. read-only staging verification;
5. любые restart, infrastructure mutation или production действия.
