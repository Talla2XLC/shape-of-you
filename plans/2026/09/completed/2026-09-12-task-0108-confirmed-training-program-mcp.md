# TASK-0108 — Подтверждённая тренировочная программа через Coach

## Цель

Дать Coach безопасную возможность сохранить и активировать явно
подтверждённую пользователем тренировочную программу так, чтобы она была
источником истины во всех чатах, а история выполненных тренировок никогда не
выдавалась за утверждённый план.

## Объём

1. Добавить typed contract одной команды сохранения подтверждённой программы с
   ожидаемым active program id/lock version и полным immutable snapshot.
2. Реализовать в существующем Training repository атомарные create-and-activate
   и append-and-activate под Person lock без миграции.
3. Сделать повтор одинакового active snapshot idempotent no-op и отклонять
   устаревшее ожидаемое состояние без частичной записи.
4. Опубликовать `save_confirmed_training_program` через API-owned MCP adapter с
   существующим `workout:write` scope.
5. Опубликовать `get_training_context`: активная программа плюс ограниченная
   история текущих WorkoutSession; при отсутствии программы история является
   только evidence для предложения.
6. Сохранить существующий `get_active_training_program` для обратной
   совместимости и требовать typed read-back после записи.
7. Усилить MCP policy: перед силовым советом использовать training context, не
   менять программу без явного подтверждения, не раскрывать внутренние
   mechanics и не выводить HTML entities.
8. Добавить contract, service/repository и MCP tests на все переходы и ошибки.
9. После независимой Quality-проверки обновить только затронутые Training и
   Coaching Wiki pages и выполнить Architecture Review.

## Не входит

- автоматическое создание программы из истории без подтверждения;
- автоматическое принятие progression candidates;
- новые упражнения или версии Exercise, которых нет в текущих typed facts;
- новый микросервис, база данных, migration, dependency, secret или OAuth scope;
- изменение существующего HTTP draft/version/activate lifecycle;
- commit, push, deployment, production access или VM-операции.

## Затронутые области

- `packages/contracts/src/training.ts`;
- `apps/api/src/storage/training-repository.ts`;
- `apps/api/src/training/training.service.ts`;
- `apps/api/src/mcp/server.ts` и MCP cutover contract;
- Training repository/integration и MCP unit tests;
- после Quality acceptance — `docs/wiki/api/training.md` и
  `docs/wiki/domain/coaching-and-decision-support.md`.

## Порядок реализации

1. Добавить shared typed command/result schemas без изменения существующих
   schemas.
2. Реализовать semantic snapshot comparison и одну атомарную repository
   transaction для create/update/no-op/conflict.
3. Провести команду через TrainingService.
4. Добавить новые MCP tools, scope/cutover declarations, безопасные presentation
   instructions и обязательный read-back flow.
5. Добавить pin tests для active, absent-with-history,
   absent-without-history, confirmed persistence, duplicate retry, stale
   conflict, cross-chat read-back и plain-Markdown policy.
6. Выполнить Developer evidence и немедленно передать независимому Quality.
7. После Quality acceptance обновить две текущие Wiki pages, проверить docs и
   провести независимый Architecture Review.

## Критерии приёмки

1. Явно подтверждённая программа создаётся и активируется одной MCP-командой.
2. Подтверждённая редакция существующей активной программы добавляет новую
   immutable version и активирует её атомарно.
3. Повтор одинакового snapshot является no-op и не создаёт дубликаты.
4. Устаревший expected program/lock завершается конфликтом без изменения
   authority.
5. Любой новый чат читает ту же активную программу из PostgreSQL.
6. При отсутствии программы bounded history доступна как evidence, но не
   обозначается как `Planned` и не активируется автоматически.
7. Coach не меняет упражнения, порядок, веса или прогрессию без явного
   подтверждения и успешного read-back.
8. Пользовательские ответы не раскрывают tool/schema/status/API mechanics и не
   содержат HTML entities.
9. Существующий HTTP и MCP read/write behavior остаётся совместимым.
10. Нет новой migration, dependency, secret, OAuth scope, сервиса или ручной
    operational configuration.

## Проверки

- targeted Training unit/integration tests;
- targeted MCP server and OAuth/cutover tests;
- полный доступный API test suite;
- API lint, typecheck и build;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`;
- независимые Quality и Architecture Review.

## Approval gates

- Архитектура и этот план одобрены сообщением оператора от 2026-09-12:
  «Согласен, давай так и сделаем» в контексте рекомендованной одной безопасной
  команды и полного 4DreamTeam workflow.
- Commit, push, deployment, production access и любые VM-операции требуют
  отдельных подтверждений.
