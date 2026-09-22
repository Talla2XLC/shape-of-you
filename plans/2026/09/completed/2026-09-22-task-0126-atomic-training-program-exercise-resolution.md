# TASK-0126 — Атомарное разрешение упражнений при сохранении TrainingProgram

## Статус

Завершено локально 2026-09-22 после Developer, независимого Quality Review,
Architecture Review и canonical Wiki review. Contracts/API typecheck, focused
lint, API unit tests, direct API build, docs и board validation прошли.
Изолированный Training integration не достиг assertions из-за unhealthy
Testcontainers PostgreSQL и не считается пройденным. Commit, push,
release-candidate publication, `Promote staging`, внешние migrations и server
operations не выполнялись.

## Пользовательский результат

Coach принимает полную программу на естественном языке, точно разрешает
доступные упражнения либо создаёт недостающие Person-private упражнения и
атомарно активирует программу. Пользователь не знает UUID, не повторяет
программу и отвечает только на один короткий вопрос при реальной
неоднозначности.

## Архитектура

Решение закреплено в ADR
`20260922-resolve-training-program-exercises-atomically`.

- confirmed save принимает существующий UUID или строгий inline descriptor;
- exact resolution, private creation и program activation выполняются в одной
  Person-locked транзакции;
- fuzzy substitution и shared publication запрещены;
- ambiguity возвращается без writes;
- успех требует совпадающего PostgreSQL read-back.

## Реализация

1. Расширить typed contracts confirmed save и результата ambiguity, сохранив
   UUID-only backward compatibility обычных Training API writes.
2. Добавить exact normalized resolution доступных current versions и enabled
   aliases в Training repository.
3. До inserts собрать ambiguity; для missing descriptors создать private
   Exercise/version 1 и сохранить программу в той же транзакции.
4. Сохранить semantic duplicate no-op, stale rollback, Person isolation и
   идемпотентность повторов под advisory lock.
5. Обновить MCP orchestration presentation: один человеческий clarification,
   retained snapshot, никакого UUID/tool/schema disclosure, обязательный
   read-back.
6. Добавить contract, repository integration и MCP regression tests.
7. Провести Developer checks, независимый Quality Review и Architecture Review.
8. После Quality acceptance обновить только затронутые canonical English Wiki
   pages и переместить этот план в `completed/`.

## Не входит

- Garmin и Intervals.icu;
- fuzzy search, shared-catalog moderation или catalog import;
- новый service, queue, scheduler, generic JSON model, dependency или env;
- durable proposal token или новая DB entity/index без отдельного ADR;
- commit, push, release, promotion, deploy или внешние migrations.

## Приёмка

1. Exact accessible exercise переиспользуется; похожее не подставляется.
2. Missing exercise создаётся только private и вместе с program transaction.
3. Ambiguity даёт один короткий вопрос и ноль writes.
4. Stale/validation/persistence failure не оставляет orphan exercises.
5. Повтор и concurrent identical request не создают дубликаты.
6. Existing UUID input, immutable versions, Person ownership и semantic no-op
   сохранены.
7. Coach сообщает успех только после совпадающего active read-back.

## Проверки

- focused contract/MCP unit tests;
- Training repository integration tests в изолированном PostgreSQL;
- API/root lint, typecheck, build и test suites;
- PostgreSQL identifier-length gate;
- `node scripts/validate-docs.mjs`, `git diff --check`, `4dt-board validate`;
- независимые Quality Review и Architecture Review.
