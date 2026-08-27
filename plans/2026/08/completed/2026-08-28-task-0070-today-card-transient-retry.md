# TASK-0070 — Восстановление today-card после transient failure

## Статус

- Узкий hotfix завершён локально 2026-08-28; independent Quality Review дал
  `ACCEPT`.
- Архитектурных изменений нет: Web продолжает читать существующий daily
  projection contract и не использует fallback.
- Production, manual deployment, staging writes, commit и push не входят в
  разрешённый scope.

## Проблема

Во время staging rollout today-card получила кратковременную ошибку projection
request и сохранила общий fail-closed экран до ручной перезагрузки страницы.
Повторный `get_daily_projection` подтвердил, что authoritative state доступен.

## Решение

1. Повторять today projection один раз после короткой задержки только для
   network failure и HTTP `502`, `503`, `504`.
2. Не повторять `401`: сохранять существующий browser OAuth flow.
3. Не повторять deterministic `4xx` и domain conflicts.
4. После terminal failure показывать `Try again`; ручной retry запускает новый
   bounded load и никогда не подменяет projection progress history.
5. Не допускать overlapping/stale today responses.

## Acceptance criteria

1. Один transient `503` автоматически восстанавливается в authoritative card.
2. Persistent failure остаётся fail closed и показывает `Try again`.
3. `Try again` восстанавливает card после следующего успешного projection read.
4. `401`, no-fallback semantics и существующий Coach launcher не меняются.
5. Web unit/typecheck/lint/build и полный browser E2E проходят.
6. Independent Quality Review даёт `ACCEPT`.

## Validation

- focused и full Web browser E2E;
- Web unit, typecheck, lint и build;
- `node scripts/validate-docs.mjs`;
- `git diff --check`;
- `4dt-board validate`.
