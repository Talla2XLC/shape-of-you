# TASK-0063 — Synthetic MCP canary matrix на staging

## Статус и разрешение

- Статус: completed; operator approved schema fixes,
  commit/push, staging deployment и повторный canary без cutover.
- Оператор явно разрешил `synthetic canary writes в staging, без cutover`
  2026-08-27.
- Разрешены только deployed MCP discovery, synthetic append-only canary writes,
  corrections, read-back, DayClosure close/reopen и zero-write rollback rehearsal.
- Не разрешены cutover, отключение Sheets writer, Google Sheets writes,
  изменение permissions, authority transfer, production и secret disclosure.

## Цель

Проверить через единственный подключённый Shape of You Staging connector всю
утверждённую MCP matrix из 23 tools и получить воспроизводимое writer evidence
для будущего cutover, не выполняя сам cutover.

## Изоляция canary

- Все synthetic facts относятся к локальной дате `2000-01-01` и явно помечены
  namespace `TASK-0063` в idempotency/dedupe/provenance полях.
- Записи append-only и остаются только в staging; исходные факты не изменяются.
- Read-back evidence содержит только статусы, количества и технические IDs без
  пользовательских значений.
- Private evidence хранится вне репозитория с mode `0600`.

## План выполнения

1. [x] Восстановить workspace, проверить board/docs/Git и deployed read surface.
2. [x] Зафиксировать отдельную operational task и границы разрешения.
3. [x] Проверить discovery и exact scope для всех 23 tools.
4. [x] Выполнить record/correct/read-back для Weight, Body, Meal,
   WorkoutSession, RecoveryObservation и DailyContextNote.
5. [x] Выполнить close/read-back/reopen/read-back для synthetic day.
6. [x] Сформировать private writer evidence и пройти `verify-writer`.
7. [x] Выполнить Person-isolated zero-write `rehearse-rollback` либо зафиксировать
   технически проверяемый blocker без расширения разрешения.
8. [x] Провести independent Quality и Architecture Review, обновить task
   timeline и перенести план в `completed`.

## Критерии приёмки

1. Discovery содержит ровно утверждённые 23 tool/scope пары.
2. Каждый обязательный writer canary имеет `success=true` и `readBack=true`.
3. Corrections создают новые append-only facts и становятся текущими при чтении.
4. Synthetic day явно закрывается и затем явно открывается; lifecycle виден в
   history/projection.
5. `verify-writer` принимает private evidence.
6. Rollback rehearsal ничего не пишет и перечисляет только post-checkpoint
   staging facts текущего Person либо возвращает документированный blocker.
7. Sheets writer, workbook, permissions, authority и production не изменены.
8. Git source diff ограничен approved MCP compatibility rework и operational
   plan; commit/push выполняются только после explicit operator approval.

## Architecture Review checklist

- Новые сервисы, базы, сущности и runtime boundaries не создаются.
- Approved append-only correction и Person ownership invariants сохраняются.
- Canary evidence не становится новой domain authority или постоянным state.
- Cutover остаётся отдельным операторским решением после Quality acceptance.

## Результат первоначального запуска

- Deployed discovery содержит все 23 ожидаемых tools; OAuth read/write scopes
  доступны через единственный подключённый connector.
- Успешны 10 record/correct canaries для пяти типов фактов и 2 lifecycle
  canaries (`close_day`, `reopen_day`), каждый с read-back.
- Synthetic date после проверки снова находится в состоянии `open`.
- Zero-write rollback rehearsal перечислил 10 post-checkpoint facts: по два для
  Weight, Body, Meal, RecoveryObservation и DailyContextNote; Workout — 0.
- `verify-writer` fail-closed с ошибкой
  `Writer canary is incomplete: record_workout_session`.
- Root cause: опубликованная connector schema для performed Workout set требует
  `weightKg` и `rir`, когда они отсутствуют, но запрещает их как
  `additionalProperties`, когда они переданы. Корректный Workout request через
  connector сейчас невыразим.
- Для продолжения нужен отдельно разрешённый source fix, tests, commit/push и
  staging deployment; cutover после такого исправления всё равно остаётся
  отдельным решением.

## Rework после первого Quality rejection

1. [x] Получить отдельное operator approval на source fix, tests, commit/push,
   staging deployment и повторный Workout canary без cutover.
2. [x] Переписать performed-set schema как три полных connector-safe варианта,
   сохранив исходную server-side validation semantics.
3. [x] Добавить regression pin на фактически публикуемый `tools/list`
   `record_workout_session.inputSchema`.
4. [x] Пройти root lint, typecheck, build, unit и focused MCP/preflight tests.
5. [x] Получить independent Quality acceptance.
6. [x] Выполнить approved minimal commit/push и дождаться успешного staging
   deployment.
7. [ ] Повторить Workout record/correct/read-back, обновить writer evidence и
   пройти `verify-writer`.
8. [ ] Провести terminal Quality/Architecture Review; cutover оставить за
   отдельным operator decision.

## Compatibility rework в текущей задаче Codex

После успешного первого deploy staging начал публиковать полную строгую схему,
но текущая задача Codex сохранила старый tool snapshot. Платформа применяет оба
ограничения одновременно: snapshot запрещает `weightKg` и `rir`, а актуальная
схема требует их. Оператор отдельно потребовал завершить canary в текущей
задаче без перехода в новый чат.

1. [x] Оставить REST/domain `CreateWorkoutSessionSchema` и
   `CorrectWorkoutSessionSchema` строгими и неизменными.
2. [x] Публиковать для MCP плоский connector-compatible performed-set schema,
   допускающий старую минимальную форму `{ reps }`.
3. [x] Нормализовать отсутствующие nullable set-поля в `null` внутри MCP
   adapter и повторно валидировать полный объект исходной строгой схемой до
   вызова domain service.
4. [x] Покрыть record, correction и fail-closed invalid-set сценарии unit-тестом.
5. [x] Пройти lint, typecheck, build, root unit и docs validation.
6. [x] Получить независимый Quality acceptance, commit/push и успешный staging
   deployment.
7. [x] В этой же задаче повторить Workout record/correct/read-back и завершить
   writer evidence без cutover.

## Итог compatibility rework

- Commit `82c12e6` (`fix(mcp): support cached workout tool schemas`) отправлен в
  `main`; GitHub Actions run `33062276745` полностью прошёл quality, image
  publishing и staging deployment.
- Единственный установленный `Shape of You Staging` connector обновил каталог
  действий без создания новой версии и без повторного OAuth подключения.
- `record_workout_session` и `correct_workout_session` выполнены idempotently
  для synthetic date `2000-01-01`; read-back возвращает corrected current fact
  со ссылкой `supersedesId` на исходный synthetic fact.
- Все 14 обязательных writer/lifecycle canaries имеют `success=true` и
  `readBack=true`; `verify-writer` вернул `verified=true`.
- Append-only rollback scope содержит исходные 10 synthetic facts и 2 Workout
  facts; повторный rollback plan остаётся zero-write и не требуется для
  подтверждения уже проверенной Person isolation.
- Cutover, Sheets writer, Google Sheets, permissions, authority, production и
  secrets не изменялись.
