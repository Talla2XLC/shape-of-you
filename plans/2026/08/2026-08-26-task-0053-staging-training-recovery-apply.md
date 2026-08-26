# TASK-0053 — Staging apply Training и Recovery

## Статус и разрешение

- Статус: in progress.
- Оператор разрешил controlled staging apply командой `го` 2026-08-26.
- Разрешены fresh read-only checkpoint, target-aware dry-run, staging database
  apply Training/Recovery, повторная сверка и необходимое исправление importer.
- Не разрешены Google Sheets writes, production access, cutover, commit и push.
- Deployment исправленного API требует отдельного явного разрешения.

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
6. [ ] Развернуть исправленный API после явного разрешения.
7. [ ] Повторить dry-run на том же snapshot и применить Training.
8. [ ] Доказать Training idempotency повторным dry-run.
9. [ ] Применить Recovery и доказать idempotency повторным dry-run.
10. [ ] Проверить staging health, удалить private artifacts и обновить evidence.
11. [ ] Провести independent Quality и Architecture Review.

## Критерии приёмки

1. Перед каждым apply нет conflicts.
2. Историческое изменение имени при стабильном `Exercise_ID` создаёт typed
   version того же private exercise, а не требует ручного source edit.
3. Existing facts не перезаписываются, failed apply полностью откатывается.
4. Repeated dry-run даёт `created=0`, ожидаемый `unchanged` и `conflict=0`.
5. Invalid source rows остаются локальными findings.
6. Google Sheets остаётся неизменённым operational authority; cutover не
   выполняется.

## Текущее evidence

- Fresh dry-run: Training `8/0/0/1`, Recovery `240/0/0/2` в порядке
  `created/unchanged/conflict/invalid`.
- Training apply остановился на исторических именах одного `Exercise_ID` и
  полностью откатился; контрольный dry-run снова показал `8/0/0/1`.
- Найдены три stable `Exercise_ID` с двумя фактическими source labels каждый.
- Focused unit и PostgreSQL integration tests, API lint, typecheck и build
  проходят после исправления.
