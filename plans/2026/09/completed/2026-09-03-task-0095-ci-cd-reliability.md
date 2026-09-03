# TASK-0095 — Надёжная и экономная CI/CD-доставка

## Цель

Не собирать и не доставлять образы для изменений только в документации и
планах, сохранив автоматический staging deployment обычных изменений `main`.
Удерживать длинный SSH-сеанс активным и ограничить время API/Identity
migrations с понятной безопасной диагностикой.

## Одобренное решение

1. Добавить в push-trigger `publish-staging.yml` нативный `paths-ignore` для
   Markdown, `docs/**` и `plans/**`; ручной dispatch и смешанные изменения не
   фильтровать.
2. Добавить в существующий SSH client invocation `ServerAliveInterval=30` и
   `ServerAliveCountMax=6`, не меняя strict host verification.
3. Запускать API и Identity migrations отдельно через фиксированный GNU
   `timeout`: 300 секунд плюс 30 секунд между `TERM` и `KILL`.
4. Назначать one-shot container детерминированное имя; при failure вывести
   только безопасный Compose/container status, force-remove этот container и
   fail-closed проверить его отсутствие.
5. При failure назвать migration и exit status; при timeout явно сообщить
   предел; `137` описывать как неоднозначный `SIGKILL` или timeout escalation.
6. Проверять `timeout` в VM preflight без новых environment variables.
7. Расширить существующие deployment contract tests и обновить только
   затронутые canonical Wiki pages.

## Acceptance criteria

1. Push в `main`, содержащий только Markdown, `docs/**` или `plans/**`, не
   запускает publish/deploy workflow.
2. Любой путь вне ignore-набора сохраняет quality, четыре image publish jobs и
   reusable staging deployment; `workflow_dispatch` сохраняется.
3. SSH использует keepalive и прежние strict trust options.
4. API и Identity migrations имеют независимый предел 300 секунд; их
   детерминированно именованные containers удаляются и проверяются после
   failure.
5. Диагностика различает success, failure и timeout, не печатает secrets или
   database URL.
6. Failed deploy job остаётся пригоден для повторного запуска с исходными
   digest outputs и commit-bound reusable workflow.
7. Все существующие deployment contract tests проходят, включая API/Identity
   timeout, cleanup, обычный failure и неоднозначный `137`.
8. PostgreSQL, порт `5431`, `talking-to-ai`, shared infrastructure, deployment
   protocol и environment contract не меняются.

## Проверки

- все scripts в `deploy/staging/scripts/tests/*.sh`;
- `sh -n` для изменённых shell scripts;
- YAML parse и статические workflow assertions;
- `node scripts/validate-docs.mjs`;
- `git diff --check` и scope review;
- `4dt-board`, `4dt-wiki`, `4dt-sources`, `4dt-memory` validation;
- независимый Quality Review и итоговый Architecture Review.

## Ограничения

- Не выполнять deployment или migrations.
- Не обращаться к secrets или production data.
- Не менять PostgreSQL, порт `5431`, Compose проекта `talking-to-ai` или
  инфраструктуру коллеги.
- Не добавлять одноразовые environment variables.
- Не делать commit, push, tag или release без отдельного подтверждения.
