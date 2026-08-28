# TASK-0076 — Typed absence активной TrainingProgram в MCP

## Статус

- Архитектурный вариант B одобрен оператором 2026-08-28.
- Implementation завершён в существующем API-owned MCP adapter.
- Independent Quality и Architecture Reviews дали `ACCEPT`.
- Unit tests, API typecheck/lint, SDK schema validation, canonical docs и diff
  checks прошли.
- Local integration suite не стартовал из-за Docker HTTP 500; 66 tests были
  skipped до выполнения, что зафиксировано как environment limitation.
- Staging, deployment, data writes, OAuth, secrets, commit и push не разрешены.

## Цель

Сделать отсутствие активной TrainingProgram валидным typed MCP read result,
чтобы Daily Coach мог честно показать отсутствие `Planned` training artifact,
не смешивая это состояние с настоящей ошибкой чтения.

## План

1. Зафиксировать MCP-specific presence/absence envelope в canonical ADR.
2. Сохранить имя `get_active_training_program`, scope, annotations и общий
   23-tool surface.
3. Вернуть `{ status: "active", program: TrainingProgram }` при наличии
   программы и `{ status: "absent", program: null }` только для ожидаемого
   `NotFoundError` существующего Training service.
4. Оставить все остальные ошибки fail closed и не менять HTTP `GET /active`
   contract с `404`.
5. Добавить MCP unit tests для schema discovery, active, absent и genuine
   failure paths.
6. Обновить только затронутые current-state Wiki/ADR документы.
7. Запустить tests, canonical docs validation и независимые Quality и
   Architecture Reviews.

## Acceptance criteria

1. `get_active_training_program` возвращает явный discriminator `active` или
   `absent` и обязательное поле `program`.
2. `absent` создаётся только из ожидаемого отсутствия active program.
3. Неожиданная repository/service/MCP ошибка остаётся tool error и не
   маскируется как отсутствие программы.
4. HTTP Training API, доменная модель, database schema и tool count не меняются.
5. Daily Coach instructions разрешают трактовать только typed `absent` как
   отсутствие `Planned` training artifact.
6. Google Sheets и chat history не используются как fallback.

## Проверка

- MCP unit tests;
- API typecheck/build checks в затронутом workspace;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- Independent Quality Review;
- Architecture Review по complexity, boundaries, DDD, duplication и
  simplification.
