# TASK-0053 — Staging apply Training и Recovery

## Статус и разрешение

- Статус: completed.
- Оператор разрешил controlled staging apply командой `го` 2026-08-26.
- Разрешены fresh read-only checkpoint, target-aware dry-run, staging database
  apply Training/Recovery, повторная сверка и необходимое исправление importer.
- Не разрешены Google Sheets writes, production access, cutover, commit и push.
- Исправленный API развёрнут операторским push и зелёным staging workflow.

## Цель

Применить уже сверенные Training и Recovery facts к staging PostgreSQL и
доказать идемпотентность повторным dry-run без ручного исправления source data.

## План

1. [x] Получить bounded read-only snapshot из exact Fitness Tracker workbook.
2. [x] Выполнить fresh target-aware dry-run и остановиться при conflict.
3. [x] Начать Training apply; проверить transactional rollback при ошибке.
4. [x] Исправить обнаруженную обработку исторических названий одного
   `Exercise_ID` через typed exercise versions.
5. [x] Добавить unit и PostgreSQL integration regression coverage.
6. [x] Развернуть исправленный API после операторского push.
7. [x] Повторить dry-run на том же snapshot и применить Training.
8. [x] Доказать Training idempotency повторным dry-run.
9. [x] Применить Recovery и доказать idempotency повторным dry-run.
10. [x] Проверить staging health, удалить private artifacts и обновить evidence.
11. [x] Провести Quality и Architecture Review.

## Критерии приёмки

1. Перед каждым apply нет conflicts.
2. Историческое изменение имени при стабильном `Exercise_ID` создаёт typed
   version того же private exercise, а не требует ручного source edit.
3. Existing facts не перезаписываются, failed apply полностью откатывается.
4. Repeated dry-run даёт `created=0`, ожидаемый `unchanged` и `conflict=0`.
5. Invalid source rows остаются локальными findings.
6. Google Sheets остаётся неизменённым operational authority; cutover не
   выполняется.

## Результат

- Fresh dry-run: Training `8/0/0/1`, Recovery `240/0/0/2` в порядке
  `created/unchanged/conflict/invalid`.
- Training apply остановился на исторических именах одного `Exercise_ID` и
  полностью откатился; контрольный dry-run снова показал `8/0/0/1`.
- Найдены три stable `Exercise_ID` с двумя фактическими source labels каждый.
- Focused unit и PostgreSQL integration tests, API lint, typecheck и build
  проходят после исправления.
- GitHub Actions run `32953756518` завершил quality, image publication и
  staging deployment успешно.
- Final same-snapshot Training apply: `8/0/0/1`; repeated dry-run:
  `0/8/0/1`.
- Final same-snapshot Recovery apply: `240/0/0/2`; repeated dry-run:
  `0/240/0/2`.
- После apply API и Identity readiness остались зелёными. Private snapshots и
  одноразовые runners удалены локально и из staging container.
- Sheets не изменялась, source authority и writer workflow не переключались.

## Architecture Review — итог

- Сохранены один modular API, одна database, одна команда и общий importer
  lifecycle; новых deployable boundaries нет.
- Stable `Exercise_ID` остаётся external identity, а исторические labels
  моделируются уже существующими typed versions без новой таблицы или JSON.
- Failed apply подтвердил atomic rollback; повторные dry-run подтвердили
  отсутствие duplicates и overwrite.
- Source facts, provenance и derived projections остаются разделёнными.
- Решение не требует ручной правки исторических строк и не усложняет будущий
  recurring reconciliation.
