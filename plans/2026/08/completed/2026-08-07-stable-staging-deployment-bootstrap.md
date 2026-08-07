# Стабильный bootstrap для staging-деплоя

## Цель

Убрать необходимость вручную переустанавливать root-owned wrapper при каждом
изменении параметров деплоя, не выдавая GitHub Actions Docker-доступ или общий
root shell.

## Подтверждённое решение

- На ВМ остаётся один минимальный root-owned bootstrap с неизменяемой точкой
  входа из `sudoers`.
- Bootstrap знает только формат ограниченного конверта и `CONTROL_SHA`.
- Полная логика параметров и деплоя живёт в versioned controller из точного
  проверенного commit `origin/main`.
- CI не передаёт команды, пути к скриптам или исполняемые файлы.
- После одной финальной установки bootstrap новые параметры подхватываются
  автоматически вместе с commit.

## Реализация

1. [x] Вынести текущий parser, runtime env, registry login и запуск Compose в
   `deploy/staging/scripts/deployment-controller.sh`.
2. [x] Сократить `/usr/local/sbin/shape-of-you-staging-deploy` до стабильного
   bootstrap: lock, bounded request, exact `CONTROL_SHA`, fixed repository,
   checkout и fixed controller path.
3. [x] Сохранить строгую проверку unknown/duplicate/malformed параметров в
   controller и исключить вывод secrets.
4. [x] Адаптировать installer и deployment contract tests к новой границе.
5. [x] Добавить отдельный contract test стабильности bootstrap.
6. [x] Прогнать shell syntax, Compose contracts, quality pipeline и проверку
   документации.
7. [x] После независимой проверки обновить только затронутые Wiki-страницы.

## Границы

- Без commit, push, изменения GitHub Environment, SSH, установки на ВМ,
  миграций и деплоя без отдельных подтверждений.
- Не менять модель доверия к `main`, пользователя `shape-deploy`, `sudoers`,
  владение Docker или сервисные базы данных.
- Не добавлять self-hosted runner, SCP-доставку скриптов или общий оркестратор.

## Критерии готовности

- Добавление нового поля в controller/workflow не требует изменения bootstrap.
- Bootstrap исполняет controller только из точного текущего `origin/main`.
- Старые проверки безопасности и staging-контракты продолжают проходить.
- Runbook явно описывает единственную финальную установку и штатный полностью
  автоматический процесс после неё.

## Результат

Реализация и независимая проверка завершены. Commit, подготовительная установка
bootstrap на staging, push в `main` и автоматический деплой остаются отдельными
операциями с явными подтверждениями.
