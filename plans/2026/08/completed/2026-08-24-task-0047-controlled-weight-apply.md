# TASK-0047 — Контролируемый Weight apply в staging

## Статус и разрешение

- Статус: completed 2026-08-24.
- Оператор явно разрешил один controlled Weight `apply` после принятого
  baseline `created=20 / unchanged=0 / conflict=0 / invalid=0`.
- Разрешение распространяется только на staging PostgreSQL Weight facts,
  relational provenance и import audit существующего importer lifecycle.
- Google Sheets writes, автоматическое исправление конфликтов, другие домены,
  recurring automation и cutover не разрешены.

## Цель

Импортировать в staging PostgreSQL двадцать чисто классифицированных Weight
facts из свежего bounded snapshot `Fitness Tracker`, а затем доказать
идемпотентность повторным read-only dry-run того же snapshot.

## Шаги

1. [x] Проверить committed code и accepted TASK-0046 evidence; сохранить
   отдельно только контролируемый documentation diff.
2. [x] Создать новый private mode-`0600` snapshot через read-only Google
   connector с metadata-capped ranges.
3. [x] Поднять ephemeral SSH tunnel `talla2xlc@2.58.15.24`; получить staging
   database URL из environment API container только в память процесса.
4. [x] Выполнить официальный Weight dry-run того же snapshot и продолжить
   только при `created=20`, остальных категориях `0`.
5. [x] Выполнить один официальный `--mode apply` с тем же snapshot.
6. [x] Повторить официальный `--mode dry-run` с тем же snapshot и принять
   только `unchanged=20`, остальных категориях `0`.
7. [x] Удалить snapshot, закрыть tunnel, проверить safe audit/status и
   зафиксировать только aggregate counts.
8. [x] Провести Quality/Architecture Review, обновить current-state Wiki и
   changelog, переместить план в `completed/`.

## Stop conditions

- Любой `conflict` или `invalid` до apply.
- Baseline отличается от `created=20 / unchanged=0 / conflict=0 / invalid=0`.
- Source manifest меняется между preflight и apply.
- Importer сообщает blocked/failed batch или неполную транзакцию.
- Повторный dry-run не даёт `unchanged=20` при нулевых остальных outcomes.

При stop condition не выполнять дополнительные записи и не запускать
разрушительный rollback. Успешный apply является append-only controlled
migration; дальнейшая коррекция требует отдельного решения.

## Проверка

- Используется command из commit `75f8c23` и существующий unified importer.
- Apply создаёт только отсутствующие facts, source references, batch и typed
  Weight audit в одной transaction.
- Existing facts не перезаписываются; Sheets остаётся authority и read-only.
- Snapshot, secret, database URL, Person id и raw facts не попадают в Git,
  board, Wiki, logs или chat.

## Operational evidence

- Fresh manifest: `c0c31af8fb04f8077ed148c5f43adcbe1d9ee2de94f7d133d11a173a44b09866`.
- Preflight: `created=20`, `unchanged=0`, `conflict=0`, `invalid=0`.
- Apply: `created=20`, `unchanged=0`, `conflict=0`, `invalid=0`.
- Same-manifest post-check: `created=0`, `unchanged=20`, `conflict=0`,
  `invalid=0`.
- Snapshot удалён, SSH tunnel закрыт. Google Sheets не изменялся. Cutover и
  authority transfer не выполнялись.
