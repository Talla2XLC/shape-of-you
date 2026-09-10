# TASK-0105 — Исправить OAuth-контракт Intervals.icu

## Цель

После успешного consent корректно завершать OAuth, сохранять зашифрованное
подключение пользователя и показывать понятную ошибку при неудаче.

## Объём

1. Читать внешний идентификатор из официального `athlete.id` token response.
2. Обменивать code по документированному form contract Intervals.icu.
3. Отзывать доступ через `DELETE /api/v1/disconnect-app`.
4. Логировать только ограниченную категорию callback failure без code, token и
   state.
5. Показывать безопасное сообщение после `authorization_failed` и удалять
   технический query marker из адреса.
6. Добавить unit tests на официальные transport-примеры и frontend mapping.

## Не входит

- изменение Recovery domain или схемы данных;
- новые зависимости, secrets или миграции;
- commit, push, deployment и VM-операции;
- реальный повторный OAuth до отдельного staging release.

## Проверки

- targeted API и Web unit tests;
- lint, typecheck, build и полный API test suite;
- `node scripts/validate-docs.mjs`;
- `git diff --check` и `4dt-board validate`.

## Release gate

Commit и push требуют отдельных подтверждений. После успешного staging
deployment владелец повторяет OAuth и проверяет первый sync.
