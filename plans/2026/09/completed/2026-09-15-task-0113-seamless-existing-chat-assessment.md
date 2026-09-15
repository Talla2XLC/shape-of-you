# TASK-0113 — Бесшовная API-owned оценка в существующем обычном чате

## Статус

Завершено 2026-09-15 после Developer, независимого Quality, Architecture
Review и Wiki review. Реализация не требует нового ChatGPT conversation, Work
mode или ручного обновления действий. Post-deploy canary остаётся release
проверкой после отдельного разрешения на commit/push и завершения автодеплоя.

## Цель

Существующий обычный Coach conversation должен продолжать вызывать уже
известный ему `get_daily_projection`, но получать от актуального API готовый
детерминированный `DailyAssessmentResult`. ChatGPT объясняет результат и не
создаёт собственный статус или следующее действие.

## Архитектура

Решение зафиксировано в ADR
`20260915-deliver-daily-assessment-through-stable-mcp-reads`.

- `get_daily_projection` сохраняет прежние имя, input schema, read scope и
  structured `DailyProjection` result;
- API в том же Person context дополнительно читает `DailyAssessmentService`;
- совпадающий current local day assessment дословно включается в динамический
  MCP text content;
- исторический или несовпадающий projection остаётся factual-only;
- ошибка assessment требует fail-closed решения, но не скрывает factual
  projection;
- отдельный `get_daily_assessment` остаётся доступным новым clients.

## Объём изменений

1. Расширить внутренний MCP execution result и отдельно выбрать совместимый
   `structuredContent` для `get_daily_projection`.
2. Сформировать динамический result content с exact serialized assessment и
   sole-authority guidance.
3. Обработать `available`, `timezone_required`, mismatch и unavailable.
4. Добавить regression tests для frozen-client compatibility и неизменности
   старого structured contract.
5. После реализации пройти Developer → независимый Quality → Architecture
   Review → Wiki.

## Не входит

- изменение deterministic policy или action vocabulary;
- новый MCP tool, schema, scope, endpoint или migration;
- Work mode, новый conversation или клиентский refresh;
- LLM в backend, scheduler, queue, новый service или env-переменная;
- commit, push и deployment без отдельного разрешения.

## Критерии приёмки

1. Старый `get_daily_projection` возвращает прежний `structuredContent`.
2. Для current Person-local day text content содержит точный
   `DailyAssessmentResult` и запрещает любое prompt-side решение.
3. `timezone_required` отображается явно и без догадки timezone.
4. Историческая или несовпадающая projection не получает текущую оценку.
5. Ошибка assessment read не ломает factual projection и запрещает выдавать
   daily status/action.
6. Direct `get_daily_assessment`, routine capture и OAuth scopes не меняются.
7. Все focused и полные проверки проходят, Quality принимает решение.

## Проверки

- focused `apps/api/test/mcp-server.unit.test.ts`;
- API unit suite, typecheck и build;
- root lint, typecheck и build;
- `node scripts/validate-docs.mjs`;
- `git diff --check` и `4dt-board validate`;
- независимый Quality, Architecture Review и Wiki review;
- post-deploy canary в том же обычном чате после отдельного разрешения на
  commit/push/deploy.
