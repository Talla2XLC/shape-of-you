# TASK-0111 — Показывать Coach импортированные активности

## Статус

Выполнено 2026-09-13. Implementation, независимые Quality и Architecture
Review, а также обновление только затронутых Wiki-страниц завершены. Commit,
push, deploy, production/VM operations и любые secrets остаются отдельными
gates.

## Цель

Убрать необходимость вручную сообщать Coach о пробежке или другой активности,
которая уже автоматически импортирована из Garmin через Intervals.icu.

## Объём

1. Добавить безопасный shared contract `ExternalActivitySummary`.
2. Расширить `TrainingContext` полем `recentExternalActivities` без изменения
   имени и input существующей MCP-команды.
3. Ограничивать чтение текущих внешних активностей непосредственно в SQL тем же
   `historyLimit`, который ограничивает `recentSessions`.
4. Сформировать проекцию в Training service без доступа MCP adapter к repository.
5. Обновить MCP description и Coach policy: учитывать импортированные активности
   без ручного напоминания, не выдумывать детали и не считать сомнительное
   совпадение двумя тренировками.
6. Добавить contract, repository, service, MCP и fake-provider integration tests.
7. После Quality acceptance обновить только затронутые current-state Wiki
   страницы и выполнить независимый Architecture Review.

## Не входит

- новый import, OAuth flow, webhook или изменение Intervals adapter;
- FIT streams, GPS routes, laps, splits или second-by-second telemetry;
- восстановление упражнений, sets, reps, weight или RIR из activity summary;
- автоматическое создание `WorkoutSession` из внешней активности;
- автоматическое связывание внешней активности и ручной `WorkoutSession`;
- новый микросервис, dependency, migration, secret или frontend change;
- commit, push, deploy, production/VM operations.

## Затронутые области

- `packages/contracts/src/training.ts`;
- `apps/api/src/storage/training-repository.ts`;
- `apps/api/src/training/training.service.ts`;
- `apps/api/src/mcp/server.ts`;
- targeted contracts/API unit and PostgreSQL integration tests;
- после Quality acceptance — `docs/wiki/api/training.md` и
  `docs/wiki/domain/coaching-and-decision-support.md` при подтверждённой
  необходимости.

## Порядок реализации

1. Добавить строгую схему `ExternalActivitySummary` и расширить обе ветви
   `TrainingContext` обязательной bounded collection.
2. Изменить `TrainingStore.listExternalActivities` так, чтобы он принимал limit и
   применял его в SQL после current-only correction filter.
3. Скомпоновать программу, `recentSessions` и `recentExternalActivities`
   параллельно в `TrainingService.getTrainingContext`.
4. Обновить описание MCP read и server-owned Coach instructions.
5. Добавить pin tests на безопасную проекцию, Person isolation, limit,
   corrections, active/absent program, duplicate sync и отсутствие raw/internal
   полей.
6. Провести Developer handoff без промежуточной остановки перед независимой
   Quality-проверкой.
7. После Quality acceptance обновить только затронутую Wiki и провести
   обязательный Architecture Review.

## Критерии приёмки

1. `get_training_context` возвращает bounded `recentExternalActivities` при
   active и absent программе, сохраняя прежние `program` и `recentSessions`.
2. Каждая сводка содержит только утверждённые typed fields и не раскрывает
   Person/connection/consent identifiers, provider identity, checksums,
   credentials, tokens или raw JSON.
3. Запрос изолирован по текущему Person, возвращает только current correction
   revision и ограничивается в SQL значением `historyLimit` от 1 до 50.
4. Повторная выдача одной provider activity не создаёт дубликат в контексте;
   provider correction заменяет текущую сводку через существующий lifecycle.
5. Coach обязан читать общий тренировочный контекст перед советом о тренировке
   или восстановлении и использует импортированную активность без просьбы о
   скриншоте или ручном повторе.
6. Coach не превращает summary в `WorkoutSession`, не выдумывает exercises/sets
   и не считает возможное совпадение внешнего и ручного факта двумя событиями
   без достаточного evidence.
7. Fake provider полностью проверяет import-to-MCP visibility без реального
   Garmin account или credentials.
8. Существующие OAuth scopes, import/disconnect/erasure lifecycle и frontend
   остаются без изменений; migration, dependency, secret и новый deployable не
   появляются.

## Проверки

- contracts build/schema tests;
- API lint, typecheck и build;
- targeted и full unit/integration suites;
- MCP tool schema/result/policy tests;
- fake-provider duplicate/correction visibility tests;
- PostgreSQL current-only, Person isolation и SQL-limit tests;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- PostgreSQL identifier-length guard;
- `4dt-board validate`;
- независимые Quality и Architecture Review.

## Approval gates

- Архитектура варианта с расширением `get_training_context` одобрена оператором
  сообщением «го» 2026-09-13.
- Этот план разрешает только указанную локальную реализацию и проверки.
- Wiki write после Quality acceptance, commit, push, deploy, credentials,
  production и VM operations требуют отдельных подтверждений.
