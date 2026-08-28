# TASK-0071 — Runtime DNS для заменяемых staging upstream

## Статус

- Реализация завершена локально 2026-08-28.
- Independent Quality Review и Architecture Review дали `ACCEPT`.
- Deployment, commit и push не выполнялись и не входят в разрешённый scope.

## Проблема

Во время staging deployment Compose пересоздаёт API и Identity раньше edge.
Работающий nginx сохраняет IP удалённого контейнера, поэтому до собственного
перезапуска может возвращать upstream failure, даже когда новый контейнер уже
healthy.

## Решение

1. Описать API и Identity как именованные nginx upstream groups.
2. Использовать Docker embedded DNS `127.0.0.11`, shared zone и `resolve`,
   доступный в open-source nginx начиная с 1.27.3.
3. Сохранить существующие URI, timeout, header, TLS, static fallback и
   fail-closed contracts.
4. В runtime E2E заменить контейнеры API и Identity под теми же network aliases
   без перезапуска edge и дождаться новых маркеров ответа.
5. Не добавлять replicas, blue-green slots, сервисы или новые release
   coordinates.

## Acceptance criteria

1. Edge обновляет адреса `api` и `identity` без собственного restart.
2. Runtime E2E воспроизводит замену обоих upstream containers и подтверждает
   восстановление маршрутов через прежний edge process.
3. Недоступный upstream по-прежнему даёт `502`/`504` и не попадает в Nuxt
   fallback.
4. Все прежние routing, security-header и Referrer-Policy проверки проходят.
5. Edge contract/runtime tests, shell syntax, repository quality и docs
   validation проходят.
6. Independent Quality Review и Architecture Review дают `ACCEPT`.

## Validation

- `sh deploy/staging/scripts/tests/frontend-edge-contract.sh`;
- `sh deploy/staging/scripts/tests/frontend-edge-runtime.sh`;
- релевантные staging deployment contract tests;
- repository lint, typecheck и tests;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`.
