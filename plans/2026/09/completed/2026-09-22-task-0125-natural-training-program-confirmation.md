# TASK-0125 — Естественное подтверждение TrainingProgram

## Статус

Завершено локально 2026-09-22 после Developer, независимого Quality Review,
Architecture Review и canonical Wiki review. Focused и полный API unit suites,
static checks, build и docs validation прошли. Изолированный Training
integration был environment-blocked до выполнения assertions из-за unhealthy
Testcontainers PostgreSQL и не считается пройденным. Commit, push, публикация
release candidate, `Promote staging`, migrations вне изолированных тестов и
server operations требуют отдельных разрешений.

## Пользовательский результат

Пользователь передаёт полную программу и просит её использовать либо естественно
принимает полностью опубликованную Coach версию. Coach без технических формул в
том же ходе сохраняет и активирует точный snapshot, перечитывает активную
версию и только после совпадения называет её действующей.

## Архитектура

Решение закреплено в ADR
`20260922-bind-natural-training-program-acceptance-to-latest-complete-proposal`.

- user-supplied полная программа с однозначной просьбой используется сразу;
- естественное согласие Coach-предложения привязывается только к последней
  полной опубликованной версии;
- неоднозначность приводит к одному короткому вопросу;
- до совпадающего read-back программа остаётся `Proposed now`;
- stale conflict перечитывается и не приводит к молчаливой перезаписи;
- серверная proposal-сущность или token не добавляются.

## Реализация

1. Усилить model-facing operational contract для двух authority paths,
   контекстной привязки и однозначного короткого вопроса.
2. Обновить описание и presentation существующей команды сохранения, не меняя
   её schema, scope или domain transaction.
3. Добавить TrainingProgram-specific failure recovery: re-read, already-applied
   verification, запрет автоматической перезаписи отличающейся активной версии
   и продолжение без повторного ввода.
4. Зафиксировать `Proposed now` до успешного save и точного read-back.
5. Добавить table-driven natural/ambiguous fixtures и regression coverage
   success, duplicate, stale и read failure.
6. Выполнить Developer checks, независимый Quality Review, Architecture Review
   и только после acceptance обновить затронутые canonical Wiki pages.

## Не входит

- новый parser естественного языка или generic JSON rules;
- LLM self-learning;
- proposal entity/token, database migration или новый persistence lifecycle;
- новый service, queue, scheduler, dependency, OAuth scope или env variable;
- изменение Person ownership, immutable versions, atomic transaction,
  semantic duplicate no-op или HTTP lifecycle;
- додумывание упражнений, порядка, нагрузки или прогрессии;
- commit, push, release-candidate publication или staging promotion.

## Приёмка

1. Полная user-supplied программа плюс просьба использовать её сохраняется без
   дополнительного подтверждения.
2. «да», «го», «подходит», «делаем так» и аналогичное однозначное принятие
   сохраняют последнюю полностью опубликованную Coach версию.
3. Похвала, вопрос, сомнение, альтернатива, partial edit и unrelated yes/no не
   считаются подтверждением.
4. После принятия в одном ходе выполняются save и `get_training_context`; active
   claim появляется только после полного совпадения.
5. Stale/error recovery не заявляет успех, не перезаписывает отличающуюся
   программу автоматически и не требует повторить полный snapshot.
6. Пользователь не видит tool names, schema fields, statuses или transport.
7. Existing domain guarantees и regression suites не нарушены.

## Проверки

- focused MCP unit tests с natural/ambiguous table;
- полный API unit suite и Training integration tests;
- API/root lint, typecheck и build;
- `node scripts/validate-docs.mjs`;
- `git diff --check` и `4dt-board validate`;
- независимый Quality Review и Architecture Review;
- same-conversation staging canary только после отдельных release/promotion
  разрешений.
